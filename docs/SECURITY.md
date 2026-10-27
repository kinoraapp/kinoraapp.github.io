# Security model

The browser is never trusted. Buttons are hidden for convenience only; every rule below is enforced on the server and is
covered by the automated tests in `tests/`.

## Where each rule is enforced

| Concern | Enforced by |
|---|---|
| Who can see a video row, its comments, its thumbnail | `public.can_view_video()` used by RLS policies, RPCs and storage policies |
| Who can **play** a video | `playback` Edge Function: calls `playable_videos()` with the viewer's own JWT, then signs Mux tokens only for allowed videos |
| Who can upload | `public.can_upload()` in the `videos` insert policy and in the `upload-url` function |
| Which columns users may change | Column-level `GRANT`s (e.g. users cannot set their own `role`, `can_upload`, `is_suspended`, a video's `moderation_status`, counters or Mux IDs) |
| Admin actions | `SECURITY DEFINER` functions that start with `assert_admin()` |
| Deleting a video (file, thumbnails, row) | `delete-video` function, owner or admin only; there is no client `DELETE` grant on `videos` |
| Suspension | `is_suspended` checked by RLS (no posting, liking, commenting, uploading; their videos hidden) plus an Auth ban from `admin-users` so they cannot sign in |
| Mux webhooks | HMAC signature check with `MUX_WEBHOOK_SECRET` and a 5-minute timestamp window |
| Secrets | Mux keys and the service-role key exist only as Edge Function secrets |

## Video visibility

`can_view_video(video, share_key)` decides, in this order:

1. Owner or active administrator → **yes** (including drafts, scheduled and removed videos)
2. Removed by moderators, or the owner is suspended → **no**
3. Draft, or scheduled with a future `publish_at` → **no**
4. Public → **yes**
5. Unlisted → **yes** with the correct share key, or for a signed-in user who opened a valid link earlier
6. Selected users → **yes** only for signed-in, non-suspended users with an explicit grant
7. Private → **no** (grants are ignored)

### Unlisted links

The link looks like `/v/<video id>?k=<share key>`. The share key is a 244-bit random value stored in `video_secrets`,
which only the owner and administrators can read, so unlisted videos cannot be found by listing the `videos` table.
When a signed-in person opens a valid link, `redeem_share_link()` records a "link" grant so they can like, comment and
save. **New link** (`rotate_share_key()`) changes the key and deletes every link grant.

### Signed playback

All Mux assets are created with a `signed` playback policy. The stream URL is
`https://stream.mux.com/<playback id>.m3u8?token=<JWT>`; the JWT (RS256, signed with your Mux signing key) is bound to
one playback ID and expires after `PLAYBACK_TOKEN_TTL_SECONDS` (default 1 hour). Thumbnails use separate thumbnail
tokens. Knowing a playback ID or an old URL is not enough to watch a video.

Custom thumbnails live in the private `thumbnails` bucket and are served through signed Storage URLs with the same
lifetime.

### Known limits (true of any streaming site)

- A signed link that was issued before access was revoked keeps working until it expires (at most the token lifetime).
  Lower `PLAYBACK_TOKEN_TTL_SECONDS` if that matters to you.
- Anyone allowed to watch a video can screen-record it. Signed playback stops unauthorised access, not copying by
  authorised viewers.
- View counts are approximate: signed-in viewers count once per 30 minutes per video; signed-out views are counted per
  page session.
- Suspended users' existing access tokens stay valid for up to an hour, but RLS already blocks everything they could
  change.

## Data on the device (PWA)

The service worker precaches only the app shell (HTML, JS, CSS, icons). It has **no runtime caching rules**, so Supabase
responses, signed video links, thumbnails and avatars are never stored in the Cache Storage. Signed playback links are
kept in memory only and cleared on sign-in and sign-out. Supabase keeps the session in `localStorage`, which signing out
removes. A shared device therefore keeps no private videos or account data after sign-out.

## Reporting a problem

Email the address in `src/config/brand.ts` (`supportEmail`).
