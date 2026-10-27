-- Scheduled publishing.
-- Scheduled videos become watchable at publish_at even without this job, because
-- can_view_video() and video_cards.is_live compare publish_at with now(). This job flips their
-- status to 'published' every minute so dashboards show the right state and followers get notified.

create function public.publish_due_videos() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.videos
     set status = 'published'
   where status = 'scheduled' and publish_at <= now();
  get diagnostics n = row_count;
  return n;
end
$$;
revoke execute on function public.publish_due_videos() from public, anon, authenticated;

-- pg_cron is available on every Supabase project. If it cannot be enabled here (for example
-- in a local test database), the migration still succeeds; see docs/SETUP.md.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('kinora-publish-scheduled-videos', '* * * * *', 'select public.publish_due_videos()');
  else
    raise notice 'pg_cron is not available: scheduled videos still go live on time, but their status is not updated automatically';
  end if;
exception when others then
  raise notice 'Could not schedule publish_due_videos(): %', sqlerrm;
end
$$;
