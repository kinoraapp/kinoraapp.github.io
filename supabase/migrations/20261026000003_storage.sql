-- Storage buckets for images. Video files never go to Supabase Storage or GitHub:
-- they are uploaded straight from the browser to Mux with a one-time upload URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Profile pictures are public profile information.
  ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  -- Custom thumbnails are private: they are served through short-lived signed URLs only to
  -- people allowed to watch the video, so a private video's thumbnail does not leak.
  ('thumbnails', 'thumbnails', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Avatars: <user id>/<file name>
create policy "avatars are readable by everyone" on storage.objects for select
  using (bucket_id = 'avatars');
create policy "users upload their own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user());
create policy "users update their own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete their own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Thumbnails: <owner id>/<video id>/<file name>
create policy "thumbnails follow video access" on storage.objects for select
  using (
    bucket_id = 'thumbnails'
    and public.can_view_video(public.try_uuid((storage.foldername(name))[2]))
  );
create policy "owners upload thumbnails" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'thumbnails'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_video_owner(public.try_uuid((storage.foldername(name))[2]))
    and public.is_active_user()
  );
create policy "owners and admins delete thumbnails" on storage.objects for delete to authenticated
  using (
    bucket_id = 'thumbnails'
    and (
      ((storage.foldername(name))[1] = auth.uid()::text
        and public.is_video_owner(public.try_uuid((storage.foldername(name))[2])))
      or public.is_admin()
    )
  );
