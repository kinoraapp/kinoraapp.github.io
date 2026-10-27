# Testing

## Automated tests

```bash
npm test
```

| Suite | What it proves |
|---|---|
| `tests/db/migrations.test.ts` | All migrations apply to an empty Postgres; every public table has RLS enabled |
| `tests/db/access.test.ts` | 34 checks of the access rules, run as real `anon` / `authenticated` roles against a real Postgres (PGlite) with a stand-in for Supabase's `auth` and `storage` schemas |
| `tests/edge/mux-security.test.ts` | Mux playback tokens verify with RSA-SHA256 and carry the right claims; webhook signatures reject tampering, wrong secrets and old timestamps |

Highlights of `access.test.ts`:

- Viewers cannot upload; creators can only after an administrator approves them
- Users cannot change their own role, upload permission or suspension, or edit anyone else's profile or video
- **An unauthorised user cannot watch a private video**: not via the table, `get_video`, `playable_videos` (what the
  playback function uses), comments or the thumbnail in storage; even an explicit grant does not open a private video
- Selected-user videos open only for granted accounts, and close again when access is revoked
- Unlisted videos need the share key, the key is unreadable by others, and rotating it revokes link access
- Drafts and future scheduled videos are hidden; scheduled videos go live at their time and the cron job publishes them
- Removed videos and suspended creators' videos disappear for viewers
- Likes, saves and comments only work on watchable videos, update counters and notify the creator
- Reports are readable only by administrators; admin functions refuse non-admins

The GitHub Actions workflow runs these on every push and pull request.

## Manual end-to-end checklist

Run this once Supabase and Mux are configured (locally or on the deployed site). Use two browsers, or one normal and one
private window, so you can be two people at once.

**A** = your administrator account, **B** = a second account.

1. **Register and log in**: In window 2, register B. Confirm the email, log in, log out, log in again. Try "Forgot
   password" and set a new password from the email.
2. **Become a creator**: As B, Settings → *Request creator access*. As A, Admin → Creators → *Approve*. B gets a
   notification and an Upload button that works.
3. **Upload and publish**: As B, upload a short MP4 with a caption containing `#test`, a custom thumbnail, visibility
   Public, *Publish now*. Watch the progress bar reach 100% and "Your video is live". It appears in the For You feed and
   on B's profile; searching `#test` in Explore finds it.
4. **Like, comment, save**: As A, like the video (or double-tap), comment, reply to the comment, save it and add it to a
   new playlist. Counts update; B's Inbox shows the like and comment; A's Library shows it under Saved.
5. **Change visibility**: As B, Studio → Edit → *Private* → Save. In a signed-out private window, open the video's link:
   "Video unavailable". The feed no longer shows it.
6. **Unauthorised user cannot watch a private video**: As A (admin) you can still open it; as any other signed-in
   account you cannot. Copy the `stream.mux.com` URL from A's browser dev tools (Network tab), wait for the token to
   expire (or change `PLAYBACK_TOKEN_TTL_SECONDS` to 300 for this test) and it stops working; a URL without `?token=`
   never works.
7. **Grant access to a selected user**: As B, set visibility to *Selected users*, add A's username under Access → Give
   access, Save. Create a third account C: C cannot watch; A can. Remove A's access: A can no longer play it.
8. **Unlisted link**: Set *Unlisted*, copy the secret link, open it signed out: it plays. Click *New link*: the old link
   stops working.
9. **Schedule**: Upload a video scheduled 5 minutes ahead. Before the time it's hidden from others; after it, it appears
   in the feed.
10. **Admin dashboard**: As A, Admin → Overview shows totals, public/private counts, views, storage and charts. As B, the
    `/admin` URL shows "Administrators only" and the admin RPCs return permission errors.
11. **Moderation**: As C, report B's video. As A, Admin → Reports → *Remove video* then *Resolve*. The video disappears
    for everyone but B and A; B is notified. Restore it from Admin → Videos.
12. **Suspension**: As A, suspend C with a reason. C sees the suspension banner and can no longer like, comment, follow
    or upload; after logging out, C cannot log back in. Reinstate C and C can log in again.
13. **PWA**: On Android Chrome use "Install app"; on iPhone Safari use Share → Add to Home Screen. The app opens full
    screen. Turn on airplane mode and reopen it: the app shell loads and shows the offline banner. Log out and confirm no
    videos play offline.
14. **Deployment**: Push to `main` and check **Actions → Build and deploy** goes green and the Pages URL loads. Open a deep
    link such as `/kinora/v/<id>` directly: it loads (served via `404.html`).
