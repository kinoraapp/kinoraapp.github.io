-- Kinora core schema: profiles, videos, access control, social features, moderation.
-- Every table has Row Level Security enabled. Privileged changes go through
-- SECURITY DEFINER functions that check the caller's role, or through Edge Functions
-- that use the service role key on the server.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('viewer', 'creator', 'admin');
create type public.creator_status as enum ('none', 'pending', 'approved', 'rejected');
create type public.video_visibility as enum ('public', 'unlisted', 'private', 'selected');
create type public.video_status as enum ('draft', 'scheduled', 'published');
create type public.processing_status as enum ('awaiting_upload', 'processing', 'ready', 'errored');
create type public.moderation_status as enum ('active', 'removed');
create type public.report_status as enum ('open', 'resolved', 'dismissed');
create type public.report_reason as enum (
  'spam', 'harassment', 'hate', 'violence', 'sexual', 'self_harm', 'misinformation', 'copyright', 'other'
);
create type public.notification_type as enum (
  'like', 'comment', 'reply', 'follow', 'new_video', 'access_granted',
  'creator_request', 'creator_approved', 'creator_rejected', 'video_ready', 'video_failed',
  'video_removed', 'video_restored', 'report_update', 'account'
);

-- Unguessable random token (two v4 UUIDs = 244 random bits) without needing pgcrypto.
create function public.random_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

-- Casts text to uuid, returning null instead of raising on bad input (used by storage policies).
create function public.try_uuid(p_value text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  bio text not null default '' check (char_length(bio) <= 300),
  website text check (website is null or website ~* '^https?://[^\s]+$'),
  avatar_url text check (avatar_url is null or avatar_url ~* '^https?://[^\s]+$'),
  role public.user_role not null default 'viewer',
  creator_status public.creator_status not null default 'none',
  creator_request_note text check (char_length(creator_request_note) <= 500),
  can_upload boolean not null default false,
  is_suspended boolean not null default false,
  suspended_reason text,
  follower_count integer not null default 0,
  following_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  sort_order integer not null default 0
);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  caption text not null default '' check (char_length(caption) <= 2200),
  hashtags text[] not null default '{}' check (cardinality(hashtags) <= 30),
  category_slug text references public.categories (slug) on delete set null,
  visibility public.video_visibility not null default 'public',
  status public.video_status not null default 'draft',
  publish_at timestamptz,
  published_at timestamptz,
  allow_comments boolean not null default true,
  processing_status public.processing_status not null default 'awaiting_upload',
  processing_error text,
  mux_playback_id text,
  duration_seconds numeric(10, 3),
  aspect_ratio text,
  original_filename text check (char_length(original_filename) <= 255),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  thumbnail_path text,
  thumbnail_time numeric(10, 3) not null default 1 check (thumbnail_time >= 0),
  moderation_status public.moderation_status not null default 'active',
  moderation_reason text,
  followers_notified_at timestamptz,
  view_count bigint not null default 0,
  like_count integer not null default 0,
  comment_count integer not null default 0,
  save_count integer not null default 0,
  share_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_needs_time check (status <> 'scheduled' or publish_at is not null)
);
create index videos_feed_idx on public.videos (visibility, status, published_at desc);
create index videos_owner_idx on public.videos (owner_id, created_at desc);
create index videos_hashtags_idx on public.videos using gin (hashtags);
create index videos_scheduled_idx on public.videos (publish_at) where status = 'scheduled';

-- Values only the owner and administrators may see: the unlisted share key and Mux asset ids.
create table public.video_secrets (
  video_id uuid primary key references public.videos (id) on delete cascade,
  share_key text not null default public.random_token(),
  mux_upload_id text,
  mux_asset_id text,
  updated_at timestamptz not null default now()
);
create index video_secrets_upload_idx on public.video_secrets (mux_upload_id);
create index video_secrets_asset_idx on public.video_secrets (mux_asset_id);

-- Who may watch a "selected users" video. source = 'link' rows are created when a signed-in
-- user opens a valid unlisted share link; they only count for unlisted videos.
create table public.video_access (
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  source text not null default 'grant' check (source in ('grant', 'link')),
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);
create index video_access_user_idx on public.video_access (user_id);

create table public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index likes_video_idx on public.likes (video_id);

create table public.saved_videos (
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index saved_videos_video_idx on public.saved_videos (video_id);

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint no_self_follow check (follower_id <> following_id)
);
create index follows_following_idx on public.follows (following_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index comments_video_idx on public.comments (video_id, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  video_id uuid references public.videos (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  reported_user_id uuid references public.profiles (id) on delete cascade,
  reason public.report_reason not null,
  details text not null default '' check (char_length(details) <= 1000),
  status public.report_status not null default 'open',
  resolution_note text,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint report_has_target check (num_nonnulls(video_id, comment_id, reported_user_id) >= 1)
);
create index reports_status_idx on public.reports (status, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  type public.notification_type not null,
  video_id uuid references public.videos (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  message text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 300),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index playlists_owner_idx on public.playlists (owner_id);

create table public.playlist_videos (
  playlist_id uuid not null references public.playlists (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  primary key (playlist_id, video_id)
);

create table public.video_views (
  id bigint generated always as identity primary key,
  video_id uuid not null references public.videos (id) on delete cascade,
  viewer_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index video_views_video_idx on public.video_views (video_id, created_at desc);
create index video_views_created_idx on public.video_views (created_at);

insert into public.categories (slug, name, sort_order) values
  ('comedy', 'Comedy', 1), ('music', 'Music', 2), ('dance', 'Dance', 3), ('education', 'Education', 4),
  ('sports', 'Sports', 5), ('food', 'Food', 6), ('travel', 'Travel', 7), ('gaming', 'Gaming', 8),
  ('tech', 'Tech', 9), ('beauty', 'Beauty & Style', 10), ('pets', 'Pets & Animals', 11), ('art', 'Art & DIY', 12),
  ('news', 'News', 13), ('lifestyle', 'Lifestyle', 14);

-- ---------------------------------------------------------------------------
-- Role and access helpers (SECURITY DEFINER so they can read rows RLS would hide)
-- ---------------------------------------------------------------------------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and not is_suspended
  )
$$;

-- Signed in and not suspended.
create function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and not is_suspended)
$$;

-- Administrators always may upload; creators only while an administrator allows it.
create function public.can_upload() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and not is_suspended
      and (role = 'admin' or (role = 'creator' and can_upload))
  )
$$;

-- True when the video is published, or scheduled and its time has come.
create function public.video_is_live(p_status public.video_status, p_publish_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select p_status = 'published' or (p_status = 'scheduled' and p_publish_at <= now())
$$;

-- The single source of truth for "may the current caller watch this video?".
-- Used by RLS policies, RPCs, storage policies and the playback Edge Function.
create function public.can_view_video(p_video_id uuid, p_share_key text default null) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
  uid uuid := auth.uid();
begin
  select vi.owner_id, vi.visibility, vi.status, vi.publish_at, vi.moderation_status,
         pr.is_suspended as owner_suspended
    into v
    from public.videos vi
    join public.profiles pr on pr.id = vi.owner_id
   where vi.id = p_video_id;
  if not found then
    return false;
  end if;

  -- Owners and administrators can always see the video, including drafts and removed videos.
  if uid is not null and (uid = v.owner_id or public.is_admin()) then
    return true;
  end if;

  if v.moderation_status <> 'active' or v.owner_suspended then
    return false;
  end if;
  if not public.video_is_live(v.status, v.publish_at) then
    return false; -- drafts and future scheduled videos
  end if;

  case v.visibility
    when 'public' then
      return true;
    when 'unlisted' then
      if p_share_key is not null and exists (
        select 1 from public.video_secrets s where s.video_id = p_video_id and s.share_key = p_share_key
      ) then
        return true;
      end if;
      return uid is not null and exists (
        select 1 from public.video_access a where a.video_id = p_video_id and a.user_id = uid
      );
    when 'selected' then
      return uid is not null and public.is_active_user() and exists (
        select 1 from public.video_access a
        where a.video_id = p_video_id and a.user_id = uid and a.source = 'grant'
      );
    else
      return false; -- private: owner and administrators only
  end case;
end
$$;

-- Like can_view_video, and the caller is an active (not suspended) signed-in user.
create function public.can_interact_with_video(p_video_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and public.can_view_video(p_video_id)
$$;

create function public.is_video_owner(p_video_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.videos where id = p_video_id and owner_id = auth.uid())
$$;

-- Internal helper for triggers and RPCs.
create function public.notify(
  p_user_id uuid, p_type public.notification_type, p_actor_id uuid default null,
  p_video_id uuid default null, p_comment_id uuid default null, p_message text default ''
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, actor_id, type, video_id, comment_id, message)
  select p_user_id, p_actor_id, p_type, p_video_id, p_comment_id, coalesce(p_message, '')
  where p_user_id is not null and p_user_id is distinct from p_actor_id
$$;
revoke execute on function public.notify(uuid, public.notification_type, uuid, uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- New users get a profile
-- ---------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  wanted text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  final_username text;
begin
  wanted := regexp_replace(wanted, '[^a-z0-9_.]', '', 'g');
  if char_length(wanted) between 3 and 30
     and not exists (select 1 from public.profiles where username = wanted) then
    final_username := wanted;
  else
    final_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    final_username,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), final_username), 60)
  );
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Video triggers: normalisation, publishing state, secrets, notifications
-- ---------------------------------------------------------------------------
create function public.videos_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tag text;
  tags text[] := '{}';
  follower record;
  became_visible boolean;
begin
  new.title := btrim(new.title);

  -- Hashtags: merge explicit tags with #tags found in the caption, lower-case, de-duplicate.
  for tag in
    select lower(regexp_replace(t, '^#+', '')) from unnest(coalesce(new.hashtags, '{}')) t
    union all
    select lower(m[1]) from regexp_matches(coalesce(new.caption, ''), '#([[:alnum:]_]{1,50})', 'g') m
  loop
    if tag ~ '^[[:alnum:]_]{1,50}$' and not tag = any (tags) and cardinality(tags) < 30 then
      tags := tags || tag;
    end if;
  end loop;
  new.hashtags := tags;

  -- A custom thumbnail must live in the owner's folder for this video.
  if new.thumbnail_path is not null
     and new.thumbnail_path not like new.owner_id::text || '/' || new.id::text || '/%' then
    raise exception 'Invalid thumbnail path' using errcode = '22023';
  end if;

  -- Publishing state.
  if new.status = 'scheduled' and new.publish_at <= now() then
    new.status := 'published';
  end if;
  if new.status = 'published' then
    if tg_op = 'INSERT' or old.status <> 'published' then
      new.published_at := case
        when tg_op = 'UPDATE' and old.status = 'scheduled' and old.publish_at <= now() then old.publish_at
        else now()
      end;
    end if;
  elsif new.status = 'draft' then
    new.published_at := null;
  elsif new.status = 'scheduled' then
    new.published_at := null;
  end if;

  if tg_op = 'UPDATE' then
    if (new.title, new.caption, new.hashtags, new.category_slug, new.visibility, new.status, new.publish_at,
        new.allow_comments, new.thumbnail_path, new.thumbnail_time)
       is distinct from
       (old.title, old.caption, old.hashtags, old.category_slug, old.visibility, old.status, old.publish_at,
        old.allow_comments, old.thumbnail_path, old.thumbnail_time) then
      new.updated_at := now();
    end if;

    if new.processing_status = 'ready' and old.processing_status <> 'ready' then
      perform public.notify(new.owner_id, 'video_ready', null, new.id, null, new.title);
    elsif new.processing_status = 'errored' and old.processing_status <> 'errored' then
      perform public.notify(new.owner_id, 'video_failed', null, new.id, null, new.title);
    end if;
  end if;

  -- Tell followers once, the first time a public video is live and playable.
  became_visible := new.visibility = 'public' and new.status = 'published'
    and new.processing_status = 'ready' and new.moderation_status = 'active';
  if became_visible and new.followers_notified_at is null then
    new.followers_notified_at := now();
    for follower in select follower_id from public.follows where following_id = new.owner_id loop
      perform public.notify(follower.follower_id, 'new_video', new.owner_id, new.id, null, new.title);
    end loop;
  end if;

  return new;
end
$$;

create trigger videos_before_write
  before insert or update on public.videos
  for each row execute function public.videos_before_write();

create function public.videos_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.video_secrets (video_id) values (new.id);
  return new;
end
$$;

create trigger videos_after_insert
  after insert on public.videos
  for each row execute function public.videos_after_insert();

-- When an unlisted video changes visibility, link-based access no longer applies.
create function public.videos_after_visibility_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.visibility = 'unlisted' and new.visibility <> 'unlisted' then
    delete from public.video_access where video_id = new.id and source = 'link';
  end if;
  return new;
end
$$;

create trigger videos_after_visibility_change
  after update of visibility on public.videos
  for each row execute function public.videos_after_visibility_change();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger playlists_touch before update on public.playlists
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Counter and notification triggers
-- ---------------------------------------------------------------------------
create function public.likes_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
begin
  if tg_op = 'INSERT' then
    update public.videos set like_count = like_count + 1 where id = new.video_id returning owner_id into owner;
    -- One like notification per person per video per day, so like/unlike toggling does not spam.
    if not exists (
      select 1 from public.notifications
      where user_id = owner and actor_id = new.user_id and video_id = new.video_id and type = 'like'
        and created_at > now() - interval '1 day'
    ) then
      perform public.notify(owner, 'like', new.user_id, new.video_id);
    end if;
    return new;
  else
    update public.videos set like_count = greatest(like_count - 1, 0) where id = old.video_id;
    return old;
  end if;
end
$$;
create trigger likes_after_change after insert or delete on public.likes
  for each row execute function public.likes_after_change();

create function public.saves_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.videos set save_count = save_count + 1 where id = new.video_id;
    return new;
  else
    update public.videos set save_count = greatest(save_count - 1, 0) where id = old.video_id;
    return old;
  end if;
end
$$;
create trigger saves_after_change after insert or delete on public.saved_videos
  for each row execute function public.saves_after_change();

create function public.comments_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
  parent_author uuid;
begin
  if tg_op = 'INSERT' then
    update public.videos set comment_count = comment_count + 1 where id = new.video_id returning owner_id into owner;
    if new.parent_id is not null then
      select user_id into parent_author from public.comments where id = new.parent_id;
      perform public.notify(parent_author, 'reply', new.user_id, new.video_id, new.id, left(new.body, 140));
    end if;
    if owner is distinct from parent_author then
      perform public.notify(owner, 'comment', new.user_id, new.video_id, new.id, left(new.body, 140));
    end if;
    return new;
  else
    update public.videos set comment_count = greatest(comment_count - 1, 0) where id = old.video_id;
    return old;
  end if;
end
$$;
create trigger comments_after_change after insert or delete on public.comments
  for each row execute function public.comments_after_change();

-- Replies must belong to the same video.
create function public.comments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.body := btrim(new.body);
  if new.parent_id is not null and not exists (
    select 1 from public.comments where id = new.parent_id and video_id = new.video_id
  ) then
    raise exception 'Reply must belong to the same video' using errcode = '22023';
  end if;
  return new;
end
$$;
create trigger comments_before_insert before insert on public.comments
  for each row execute function public.comments_before_insert();

create function public.follows_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set follower_count = follower_count + 1 where id = new.following_id;
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
    if not exists (
      select 1 from public.notifications
      where user_id = new.following_id and actor_id = new.follower_id and type = 'follow'
        and created_at > now() - interval '1 day'
    ) then
      perform public.notify(new.following_id, 'follow', new.follower_id);
    end if;
    return new;
  else
    update public.profiles set follower_count = greatest(follower_count - 1, 0) where id = old.following_id;
    update public.profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    return old;
  end if;
end
$$;
create trigger follows_after_change after insert or delete on public.follows
  for each row execute function public.follows_after_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.videos enable row level security;
alter table public.video_secrets enable row level security;
alter table public.video_access enable row level security;
alter table public.likes enable row level security;
alter table public.saved_videos enable row level security;
alter table public.follows enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_videos enable row level security;
alter table public.video_views enable row level security;

-- Supabase grants every privilege on new tables to anon and authenticated by default.
-- Take write access away and hand back only the columns each role may change.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;

-- profiles: public directory (suspended accounts hidden); users edit only their own public fields.
create policy profiles_select on public.profiles for select
  using (not is_suspended or id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
grant update (username, display_name, bio, website, avatar_url) on public.profiles to authenticated;

-- categories: readable by everyone, managed in SQL by administrators.
create policy categories_select on public.categories for select using (true);
create policy categories_admin on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant insert, update, delete on public.categories to authenticated;

-- videos: watching is decided by can_view_video. The owner_id check comes first so that
-- INSERT ... RETURNING works before the new row is visible to the helper function.
create policy videos_select on public.videos for select
  using (owner_id = auth.uid() or public.can_view_video(id));
create policy videos_insert on public.videos for insert to authenticated
  with check (owner_id = auth.uid() and public.can_upload());
create policy videos_update on public.videos for update to authenticated
  using ((owner_id = auth.uid() and public.is_active_user()) or public.is_admin())
  with check ((owner_id = auth.uid() and public.is_active_user()) or public.is_admin());
-- No DELETE policy: deleting goes through the delete-video Edge Function, which also removes the Mux asset.
grant insert (title, caption, hashtags, category_slug, visibility, status, publish_at, allow_comments,
              original_filename, size_bytes, thumbnail_time)
  on public.videos to authenticated;
grant update (title, caption, hashtags, category_slug, visibility, status, publish_at, allow_comments,
              thumbnail_path, thumbnail_time)
  on public.videos to authenticated;

-- video_secrets: owner and administrators may read; changes only through RPCs and Edge Functions.
create policy video_secrets_select on public.video_secrets for select to authenticated
  using (public.is_video_owner(video_id) or public.is_admin());

-- video_access: a person can see their own grants; owners and administrators see all for their videos.
create policy video_access_select on public.video_access for select to authenticated
  using (user_id = auth.uid() or public.is_video_owner(video_id) or public.is_admin());

-- likes and saves: private to each user; you can only like or save what you can watch.
create policy likes_select on public.likes for select to authenticated using (user_id = auth.uid());
create policy likes_insert on public.likes for insert to authenticated
  with check (user_id = auth.uid() and public.can_interact_with_video(video_id));
create policy likes_delete on public.likes for delete to authenticated using (user_id = auth.uid());
grant insert (user_id, video_id), delete on public.likes to authenticated;

create policy saves_select on public.saved_videos for select to authenticated using (user_id = auth.uid());
create policy saves_insert on public.saved_videos for insert to authenticated
  with check (user_id = auth.uid() and public.can_interact_with_video(video_id));
create policy saves_delete on public.saved_videos for delete to authenticated using (user_id = auth.uid());
grant insert (user_id, video_id), delete on public.saved_videos to authenticated;

-- follows: the social graph is public; you can only follow or unfollow as yourself.
create policy follows_select on public.follows for select using (true);
create policy follows_insert on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and public.is_active_user());
create policy follows_delete on public.follows for delete to authenticated using (follower_id = auth.uid());
grant insert (follower_id, following_id), delete on public.follows to authenticated;

-- comments: visible with the video; hidden comments only to their author, the video owner and admins.
create policy comments_select on public.comments for select
  using (
    public.can_view_video(video_id)
    and (not is_hidden or user_id = auth.uid() or public.is_video_owner(video_id) or public.is_admin())
  );
create policy comments_insert on public.comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.can_interact_with_video(video_id)
    and exists (select 1 from public.videos v where v.id = video_id and v.allow_comments)
  );
create policy comments_update on public.comments for update to authenticated
  using (public.is_video_owner(video_id) or public.is_admin())
  with check (public.is_video_owner(video_id) or public.is_admin());
create policy comments_delete on public.comments for delete to authenticated
  using (user_id = auth.uid() or public.is_video_owner(video_id) or public.is_admin());
grant insert (video_id, parent_id, body), delete on public.comments to authenticated;
grant update (is_hidden) on public.comments to authenticated;

-- reports: anyone signed in may report what they can see; only the reporter and admins can read them.
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());
create policy reports_insert on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid() and public.is_active_user()
    and (video_id is null or public.can_view_video(video_id))
  );
grant insert (video_id, comment_id, reported_user_id, reason, details) on public.reports to authenticated;

-- notifications: private to the recipient, who may mark them read or delete them.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());
grant update (read_at), delete on public.notifications to authenticated;

-- playlists: owners manage; public playlists are readable by everyone.
create policy playlists_select on public.playlists for select
  using (is_public or owner_id = auth.uid() or public.is_admin());
create policy playlists_insert on public.playlists for insert to authenticated
  with check (owner_id = auth.uid() and public.is_active_user());
create policy playlists_update on public.playlists for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy playlists_delete on public.playlists for delete to authenticated using (owner_id = auth.uid());
grant insert (title, description, is_public), update (title, description, is_public), delete
  on public.playlists to authenticated;

create policy playlist_videos_select on public.playlist_videos for select
  using (exists (
    select 1 from public.playlists p
    where p.id = playlist_id and (p.is_public or p.owner_id = auth.uid() or public.is_admin())
  ));
create policy playlist_videos_insert on public.playlist_videos for insert to authenticated
  with check (
    exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = auth.uid())
    and public.can_interact_with_video(video_id)
  );
create policy playlist_videos_delete on public.playlist_videos for delete to authenticated
  using (exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = auth.uid()));
grant insert (playlist_id, video_id, position), delete on public.playlist_videos to authenticated;

-- video_views: written only by record_view(); readable by administrators.
create policy video_views_admin on public.video_views for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Feed view (respects the caller's RLS because of security_invoker)
-- ---------------------------------------------------------------------------
create view public.video_cards with (security_invoker = true) as
select
  v.id, v.owner_id, v.title, v.caption, v.hashtags, v.category_slug, v.visibility, v.status,
  v.publish_at, v.published_at, coalesce(v.published_at, v.publish_at) as live_at,
  public.video_is_live(v.status, v.publish_at) as is_live,
  v.allow_comments, v.processing_status, v.processing_error, v.mux_playback_id, v.duration_seconds,
  v.aspect_ratio, v.thumbnail_path, v.moderation_status, v.moderation_reason,
  v.view_count, v.like_count, v.comment_count, v.save_count, v.share_count,
  v.created_at, v.updated_at,
  p.username, p.display_name, p.avatar_url
from public.videos v
join public.profiles p on p.id = v.owner_id;

-- Realtime notifications (only if the Supabase realtime publication exists).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
