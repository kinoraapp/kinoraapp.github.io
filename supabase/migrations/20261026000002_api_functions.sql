-- Kinora RPC functions. Each SECURITY DEFINER function checks the caller's rights itself;
-- SECURITY INVOKER functions run under the caller's Row Level Security.

-- ---------------------------------------------------------------------------
-- Watching
-- ---------------------------------------------------------------------------

-- One video for the details page. Unlisted videos need their share key (or a link grant).
create function public.get_video(p_video_id uuid, p_share_key text default null)
returns setof public.video_cards
language sql stable security definer set search_path = '' as $$
  select c.* from public.video_cards c
  where c.id = p_video_id and public.can_view_video(p_video_id, p_share_key)
$$;

-- Used by the playback Edge Function (called with the viewer's own JWT) to decide which
-- videos it may sign playback tokens for.
create function public.playable_videos(p_ids uuid[], p_share_key text default null)
returns table (
  id uuid, mux_playback_id text, thumbnail_path text, thumbnail_time numeric,
  processing_status public.processing_status
)
language sql stable security definer set search_path = '' as $$
  select v.id, v.mux_playback_id, v.thumbnail_path, v.thumbnail_time, v.processing_status
  from public.videos v
  where v.id = any (p_ids[1:60]) and public.can_view_video(v.id, p_share_key)
$$;

create function public.get_comments(
  p_video_id uuid, p_share_key text default null, p_limit integer default 100, p_offset integer default 0
)
returns table (
  id uuid, video_id uuid, user_id uuid, parent_id uuid, body text, is_hidden boolean, created_at timestamptz,
  username text, display_name text, avatar_url text
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  moderator boolean;
begin
  if not public.can_view_video(p_video_id, p_share_key) then
    return;
  end if;
  moderator := public.is_admin() or public.is_video_owner(p_video_id);
  return query
    select c.id, c.video_id, c.user_id, c.parent_id, c.body, c.is_hidden, c.created_at,
           p.username, p.display_name, p.avatar_url
    from public.comments c
    join public.profiles p on p.id = c.user_id
    where c.video_id = p_video_id
      and (not c.is_hidden or moderator or c.user_id = auth.uid())
      and (not p.is_suspended or moderator)
    order by c.created_at desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end
$$;

-- A signed-in user who opens a valid unlisted share link keeps access, so they can like,
-- comment on and save the video. Rotating the share key revokes these link grants.
create function public.redeem_share_link(p_video_id uuid, p_share_key text)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_share_key is null then
    return false;
  end if;
  if not exists (
    select 1 from public.videos v join public.video_secrets s on s.video_id = v.id
    where v.id = p_video_id and v.visibility = 'unlisted' and s.share_key = p_share_key
  ) or not public.can_view_video(p_video_id, p_share_key) then
    return false;
  end if;
  insert into public.video_access (video_id, user_id, source)
  values (p_video_id, auth.uid(), 'link')
  on conflict (video_id, user_id) do nothing;
  return true;
end
$$;

-- Counts a view. Signed-in viewers count at most once per video per 30 minutes.
create function public.record_view(p_video_id uuid, p_share_key text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_view_video(p_video_id, p_share_key) then
    return;
  end if;
  if auth.uid() is not null and exists (
    select 1 from public.video_views
    where video_id = p_video_id and viewer_id = auth.uid() and created_at > now() - interval '30 minutes'
  ) then
    return;
  end if;
  insert into public.video_views (video_id, viewer_id) values (p_video_id, auth.uid());
  update public.videos set view_count = view_count + 1 where id = p_video_id;
end
$$;

create function public.record_share(p_video_id uuid, p_share_key text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.can_view_video(p_video_id, p_share_key) then
    update public.videos set share_count = share_count + 1 where id = p_video_id;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Discovery (SECURITY INVOKER: the caller's RLS decides what is returned)
-- ---------------------------------------------------------------------------
create function public.escape_like(p_text text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;

create function public.search_videos(
  p_query text default '', p_category text default null, p_limit integer default 24, p_offset integer default 0
)
returns setof public.video_cards
language sql stable security invoker set search_path = '' as $$
  with q as (select btrim(coalesce(p_query, '')) as raw)
  select c.* from public.video_cards c, q
  where c.visibility = 'public' and c.is_live and c.processing_status = 'ready' and c.moderation_status = 'active'
    and (p_category is null or c.category_slug = p_category)
    and (
      q.raw = ''
      or c.title ilike '%' || public.escape_like(q.raw) || '%'
      or c.caption ilike '%' || public.escape_like(q.raw) || '%'
      or c.username ilike '%' || public.escape_like(ltrim(q.raw, '@')) || '%'
      or lower(ltrim(q.raw, '#')) = any (c.hashtags)
    )
  order by c.live_at desc nulls last
  limit least(greatest(p_limit, 1), 60) offset greatest(p_offset, 0)
$$;

create function public.search_profiles(p_query text, p_limit integer default 20)
returns setof public.profiles
language sql stable security invoker set search_path = '' as $$
  select p.* from public.profiles p
  where btrim(coalesce(p_query, '')) <> ''
    and (p.username ilike '%' || public.escape_like(ltrim(btrim(p_query), '@')) || '%'
         or p.display_name ilike '%' || public.escape_like(btrim(p_query)) || '%')
  order by p.follower_count desc, p.username
  limit least(greatest(p_limit, 1), 50)
$$;

create function public.trending_hashtags(p_limit integer default 20)
returns table (tag text, video_count bigint)
language sql stable security invoker set search_path = '' as $$
  select t.tag, count(*) as video_count
  from public.video_cards c, unnest(c.hashtags) as t(tag)
  where c.visibility = 'public' and c.is_live and c.processing_status = 'ready'
    and c.moderation_status = 'active' and c.live_at > now() - interval '60 days'
  group by t.tag
  order by count(*) desc, t.tag
  limit least(greatest(p_limit, 1), 50)
$$;

-- ---------------------------------------------------------------------------
-- Creators
-- ---------------------------------------------------------------------------
create function public.request_creator_access(p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  admin_row record;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.is_suspended then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if me.role in ('creator', 'admin') and me.can_upload then
    return;
  end if;
  update public.profiles
     set creator_status = 'pending', creator_request_note = left(btrim(coalesce(p_note, '')), 500)
   where id = me.id;
  for admin_row in select id from public.profiles where role = 'admin' and not is_suspended loop
    perform public.notify(admin_row.id, 'creator_request', me.id, null, null, '@' || me.username || ' asked to become a creator');
  end loop;
end
$$;

create function public.assert_can_manage_video(p_video_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ((public.is_video_owner(p_video_id) and public.is_active_user()) or public.is_admin()) then
    raise exception 'Only the video owner or an administrator can do this' using errcode = '42501';
  end if;
end
$$;

create function public.list_video_access(p_video_id uuid)
returns table (
  user_id uuid, username text, display_name text, avatar_url text, source text,
  granted_by_username text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.assert_can_manage_video(p_video_id);
  return query
    select a.user_id, p.username, p.display_name, p.avatar_url, a.source, g.username, a.created_at
    from public.video_access a
    join public.profiles p on p.id = a.user_id
    left join public.profiles g on g.id = a.granted_by
    where a.video_id = p_video_id
    order by a.created_at desc;
end
$$;

create function public.grant_video_access(p_video_id uuid, p_username text)
returns table (user_id uuid, username text, display_name text, avatar_url text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  target public.profiles;
  video_row public.videos;
begin
  perform public.assert_can_manage_video(p_video_id);
  select * into video_row from public.videos where id = p_video_id;
  select * into target from public.profiles where username = lower(ltrim(btrim(p_username), '@'));
  if target.id is null then
    raise exception 'No account with that username' using errcode = 'P0002';
  end if;
  if target.id = video_row.owner_id then
    raise exception 'The owner can already watch this video' using errcode = '22023';
  end if;
  insert into public.video_access (video_id, user_id, source, granted_by)
  values (p_video_id, target.id, 'grant', auth.uid())
  on conflict on constraint video_access_pkey
  do update set source = 'grant', granted_by = excluded.granted_by, created_at = now();
  perform public.notify(target.id, 'access_granted', auth.uid(), p_video_id, null, video_row.title);
  return query select target.id, target.username, target.display_name, target.avatar_url;
end
$$;

create function public.revoke_video_access(p_video_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_can_manage_video(p_video_id);
  delete from public.video_access where video_id = p_video_id and user_id = p_user_id;
end
$$;

-- New share link for an unlisted video; old links and the access they gave stop working.
create function public.rotate_share_key(p_video_id uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  new_key text := public.random_token();
begin
  perform public.assert_can_manage_video(p_video_id);
  update public.video_secrets set share_key = new_key, updated_at = now() where video_id = p_video_id;
  delete from public.video_access where video_id = p_video_id and source = 'link';
  return new_key;
end
$$;

create function public.creator_stats(p_days integer default 14)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  days integer := least(greatest(p_days, 7), 90);
  result jsonb;
begin
  if uid is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'videos', count(*),
    'published', count(*) filter (where public.video_is_live(status, publish_at)),
    'scheduled', count(*) filter (where status = 'scheduled' and publish_at > now()),
    'drafts', count(*) filter (where status = 'draft'),
    'views', coalesce(sum(view_count), 0),
    'likes', coalesce(sum(like_count), 0),
    'comments', coalesce(sum(comment_count), 0),
    'saves', coalesce(sum(save_count), 0),
    'shares', coalesce(sum(share_count), 0),
    'followers', (select follower_count from public.profiles where id = uid)
  ) into result
  from public.videos where owner_id = uid;

  result := result || jsonb_build_object(
    'views_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day::date, 'views', coalesce(x.views, 0)) order by d.day), '[]')
      from generate_series((current_date - (days - 1))::timestamp, current_date::timestamp, interval '1 day') as d(day)
      left join (
        select date_trunc('day', vv.created_at)::date as day, count(*) as views
        from public.video_views vv join public.videos v on v.id = vv.video_id
        where v.owner_id = uid and vv.created_at >= current_date - (days - 1)
        group by 1
      ) x on x.day = d.day::date
    ),
    'top_videos', (
      select coalesce(jsonb_agg(t), '[]') from (
        select id, title, view_count, like_count, comment_count
        from public.videos where owner_id = uid
        order by view_count desc, like_count desc limit 5
      ) t
    )
  );
  return result;
end
$$;

-- ---------------------------------------------------------------------------
-- Administration (every function starts by checking is_admin())
-- ---------------------------------------------------------------------------
create function public.assert_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
end
$$;

create function public.admin_stats()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  perform public.assert_admin();
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'creators', (select count(*) from public.profiles where role = 'creator'),
    'admins', (select count(*) from public.profiles where role = 'admin'),
    'suspended', (select count(*) from public.profiles where is_suspended),
    'pending_creators', (select count(*) from public.profiles where creator_status = 'pending'),
    'videos', (select count(*) from public.videos),
    'public_videos', (select count(*) from public.videos where visibility = 'public'),
    'unlisted_videos', (select count(*) from public.videos where visibility = 'unlisted'),
    'private_videos', (select count(*) from public.videos where visibility = 'private'),
    'selected_videos', (select count(*) from public.videos where visibility = 'selected'),
    'live_videos', (select count(*) from public.videos where public.video_is_live(status, publish_at)),
    'draft_videos', (select count(*) from public.videos where status = 'draft'),
    'scheduled_videos', (select count(*) from public.videos where status = 'scheduled' and publish_at > now()),
    'processing_videos', (select count(*) from public.videos where processing_status in ('awaiting_upload', 'processing')),
    'failed_videos', (select count(*) from public.videos where processing_status = 'errored'),
    'removed_videos', (select count(*) from public.videos where moderation_status = 'removed'),
    'views', (select coalesce(sum(view_count), 0) from public.videos),
    'likes', (select coalesce(sum(like_count), 0) from public.videos),
    'comments', (select count(*) from public.comments),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'storage', jsonb_build_object(
      'video_bytes', (select coalesce(sum(size_bytes), 0) from public.videos),
      'video_seconds', (select coalesce(sum(duration_seconds), 0) from public.videos),
      'thumbnail_bytes', (
        select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
        from storage.objects o where o.bucket_id = 'thumbnails'
      ),
      'avatar_bytes', (
        select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
        from storage.objects o where o.bucket_id = 'avatars'
      )
    ),
    'views_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day::date, 'views', coalesce(x.n, 0)) order by d.day), '[]')
      from generate_series((current_date - 13)::timestamp, current_date::timestamp, interval '1 day') as d(day)
      left join (
        select date_trunc('day', created_at)::date as day, count(*) as n
        from public.video_views where created_at >= current_date - 13 group by 1
      ) x on x.day = d.day::date
    ),
    'signups_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day::date, 'users', coalesce(x.n, 0)) order by d.day), '[]')
      from generate_series((current_date - 13)::timestamp, current_date::timestamp, interval '1 day') as d(day)
      left join (
        select date_trunc('day', created_at)::date as day, count(*) as n
        from public.profiles where created_at >= current_date - 13 group by 1
      ) x on x.day = d.day::date
    )
  ) into result;
  return result;
end
$$;

create function public.admin_list_users(
  p_query text default '', p_filter text default 'all', p_limit integer default 50, p_offset integer default 0
)
returns table (
  id uuid, username text, display_name text, avatar_url text, email text, role public.user_role,
  creator_status public.creator_status, creator_request_note text, can_upload boolean,
  is_suspended boolean, suspended_reason text, follower_count integer, video_count bigint,
  created_at timestamptz, last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query
    select p.id, p.username, p.display_name, p.avatar_url, u.email::text, p.role, p.creator_status,
           p.creator_request_note, p.can_upload, p.is_suspended, p.suspended_reason, p.follower_count,
           (select count(*) from public.videos v where v.owner_id = p.id), p.created_at, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where (btrim(coalesce(p_query, '')) = ''
           or p.username ilike '%' || public.escape_like(btrim(p_query)) || '%'
           or p.display_name ilike '%' || public.escape_like(btrim(p_query)) || '%'
           or u.email ilike '%' || public.escape_like(btrim(p_query)) || '%')
      and case coalesce(p_filter, 'all')
            when 'admins' then p.role = 'admin'
            when 'creators' then p.role = 'creator'
            when 'viewers' then p.role = 'viewer'
            when 'pending' then p.creator_status = 'pending'
            when 'suspended' then p.is_suspended
            else true
          end
    order by (p.creator_status = 'pending') desc, p.created_at desc
    limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end
$$;

create function public.admin_set_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'You cannot remove your own administrator role' using errcode = '22023';
  end if;
  update public.profiles
     set role = p_role,
         can_upload = case when p_role = 'viewer' then false when p_role = 'admin' then true else can_upload end,
         creator_status = case when p_role in ('creator', 'admin') then 'approved'::public.creator_status
                               else case when creator_status = 'approved' then 'none'::public.creator_status else creator_status end end
   where id = p_user_id;
end
$$;

create function public.admin_set_upload_permission(p_user_id uuid, p_allowed boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  update public.profiles set can_upload = p_allowed where id = p_user_id;
end
$$;

create function public.admin_review_creator(p_user_id uuid, p_approve boolean, p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  if p_approve then
    update public.profiles
       set role = case when role = 'admin' then role else 'creator'::public.user_role end,
           creator_status = 'approved', can_upload = true
     where id = p_user_id;
    perform public.notify(p_user_id, 'creator_approved', auth.uid(), null, null, coalesce(p_note, ''));
  else
    update public.profiles set creator_status = 'rejected' where id = p_user_id;
    perform public.notify(p_user_id, 'creator_rejected', auth.uid(), null, null, coalesce(p_note, ''));
  end if;
end
$$;

-- Database side of suspension. The admin-users Edge Function calls this and also bans the
-- account in Supabase Auth so the person cannot sign in again.
create function public.admin_set_suspension(p_user_id uuid, p_suspended boolean, p_reason text default '')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  if p_user_id = auth.uid() then
    raise exception 'You cannot suspend your own account' using errcode = '22023';
  end if;
  update public.profiles
     set is_suspended = p_suspended,
         suspended_reason = case when p_suspended then nullif(btrim(coalesce(p_reason, '')), '') else null end
   where id = p_user_id;
  if not p_suspended then
    perform public.notify(p_user_id, 'account', auth.uid(), null, null, 'Your account has been reinstated.');
  end if;
end
$$;

create function public.admin_set_video_moderation(
  p_video_id uuid, p_status public.moderation_status, p_reason text default ''
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  video_row public.videos;
begin
  perform public.assert_admin();
  update public.videos
     set moderation_status = p_status,
         moderation_reason = case when p_status = 'removed' then nullif(btrim(coalesce(p_reason, '')), '') else null end
   where id = p_video_id
  returning * into video_row;
  if video_row.id is null then
    raise exception 'Video not found' using errcode = 'P0002';
  end if;
  perform public.notify(
    video_row.owner_id,
    case when p_status = 'removed' then 'video_removed'::public.notification_type else 'video_restored'::public.notification_type end,
    auth.uid(), video_row.id, null,
    case when p_status = 'removed' then coalesce(nullif(btrim(p_reason), ''), video_row.title) else video_row.title end
  );
end
$$;

create function public.admin_set_comment_hidden(p_comment_id uuid, p_hidden boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  update public.comments set is_hidden = p_hidden where id = p_comment_id;
end
$$;

create function public.admin_list_reports(p_status public.report_status default 'open', p_limit integer default 100)
returns table (
  id uuid, reason public.report_reason, details text, status public.report_status, resolution_note text,
  created_at timestamptz, resolved_at timestamptz,
  reporter_username text, video_id uuid, video_title text, video_moderation public.moderation_status,
  comment_id uuid, comment_body text, comment_hidden boolean,
  reported_user_id uuid, reported_username text, reported_suspended boolean
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query
    select r.id, r.reason, r.details, r.status, r.resolution_note, r.created_at, r.resolved_at,
           rp.username, v.id, v.title, v.moderation_status,
           c.id, c.body, c.is_hidden,
           coalesce(r.reported_user_id, c.user_id, v.owner_id), tu.username, tu.is_suspended
    from public.reports r
    join public.profiles rp on rp.id = r.reporter_id
    left join public.comments c on c.id = r.comment_id
    left join public.videos v on v.id = coalesce(r.video_id, c.video_id)
    left join public.profiles tu on tu.id = coalesce(r.reported_user_id, c.user_id, v.owner_id)
    where p_status is null or r.status = p_status
    order by r.created_at desc
    limit least(greatest(p_limit, 1), 500);
end
$$;

create function public.admin_resolve_report(p_report_id uuid, p_status public.report_status, p_note text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  report_row public.reports;
begin
  perform public.assert_admin();
  update public.reports
     set status = p_status,
         resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
         resolved_by = case when p_status = 'open' then null else auth.uid() end,
         resolved_at = case when p_status = 'open' then null else now() end
   where id = p_report_id
  returning * into report_row;
  if report_row.id is not null and p_status <> 'open' then
    perform public.notify(report_row.reporter_id, 'report_update', null, report_row.video_id, null,
      case when p_status = 'resolved' then 'Thanks: we reviewed your report and took action.'
           else 'Thanks: we reviewed your report and found no violation.' end);
  end if;
end
$$;

-- Promote the first administrator from the SQL editor:  select public.bootstrap_admin('you@example.com');
-- Not callable through the API.
create function public.bootstrap_admin(p_email text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then
    raise exception 'No user with email %; register in the app first', p_email;
  end if;
  update public.profiles
     set role = 'admin', can_upload = true, creator_status = 'approved', is_suspended = false
   where id = uid;
  return 'Administrator: ' || p_email;
end
$$;
revoke execute on function public.bootstrap_admin(text) from public, anon, authenticated;

-- Internal helpers are not part of the API.
revoke execute on function public.assert_admin() from public, anon;
revoke execute on function public.assert_can_manage_video(uuid) from public, anon;
