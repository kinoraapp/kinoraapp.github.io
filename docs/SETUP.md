# Setting up Supabase and Mux

This connects Kinora to its backend. Allow about 30 minutes. You need:

- a [Supabase](https://supabase.com) account (the free plan works for testing)
- a [Mux](https://www.mux.com) account
- Node.js 20.19+ for the Supabase CLI commands (run through `npx`, nothing to install globally)

Values you'll collect, and where each one goes:

| Value | From | Goes to |
|---|---|---|
| Project URL, anon/publishable key | Supabase → Project Settings → API | `.env.local` and GitHub Actions variables (public) |
| Project ref | the `abcd1234` in `https://abcd1234.supabase.co` | CLI commands, `SUPABASE_PROJECT_REF` variable |
| Database password | chosen when creating the project | CLI only (never in the frontend) |
| Mux token ID + secret | Mux → Settings → Access Tokens | Edge Function secrets |
| Mux signing key ID + private key | Mux → Settings → Signing Keys | Edge Function secrets |
| Mux webhook signing secret | Mux → Settings → Webhooks | Edge Function secrets |

> Never put the service-role key, database password or any Mux value in `.env.local`, in a `VITE_` variable or in the
> repository. Only the project URL and the anon/publishable key belong in the browser.

## 1. Create the Supabase project

1. In the Supabase dashboard, create a new project. Note the **database password**.
2. Open **Project Settings → API** and copy the **Project URL** and the **anon** (or **publishable**) key.
3. Put them in `.env.local`:

   ```
   VITE_SUPABASE_URL=https://abcd1234.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...   (or sb_publishable_...)
   ```

## 2. Configure authentication

**Authentication → URL Configuration**

- **Site URL**: your live site, for example `https://your-name.github.io/kinora/` (use `http://localhost:5173` until you deploy)
- **Redirect URLs**: add every address the app runs on, with `/**` at the end:
  - `http://localhost:5173/**`
  - `https://your-name.github.io/kinora/**`
  - your custom domain later, e.g. `https://kinora.example.com/**`

These are used by the confirmation and password-reset emails (the app sends people to `/login?confirmed=1` and
`/reset-password`).

**Authentication → Providers → Email**: keep *Confirm email* on. Minimum password length 8 is recommended.

**Emails in production**: Supabase's built-in email sender is rate-limited and meant for testing. Before launch, set up
custom SMTP under **Authentication → Emails → SMTP settings** (any provider such as Resend, Postmark, Amazon SES).

## 3. Create the database

Option A, with the Supabase CLI (recommended):

```bash
npx supabase login
```

```bash
npx supabase link --project-ref abcd1234
```

```bash
npx supabase db push
```

Option B, without the CLI: open **SQL Editor**, and run each file in `supabase/migrations/` **in order** (copy, paste, Run):

1. `20261026000001_core_schema.sql`: tables, triggers, Row Level Security policies
2. `20261026000002_api_functions.sql`: feed/search/stats/admin functions
3. `20261026000003_storage.sql`: `avatars` (public) and `thumbnails` (private) buckets and their policies
4. `20261026000004_scheduled_publishing.sql`: the every-minute job that publishes scheduled videos

If step 4 prints "pg_cron is not available", enable **Integrations → Cron** in the dashboard and run that file again.
Scheduled videos still go live on time without it; the job only updates their status and notifies followers.

Check: **Table Editor** should list `profiles`, `videos`, `video_access`, `likes`, `comments`, `follows`,
`saved_videos`, `notifications`, `reports`, `categories`, `playlists`, `playlist_videos`, `video_secrets`,
`video_views`, each marked "RLS enabled".

## 4. Set up Mux

1. Create a Mux account and an **environment** (e.g. "Production"; use a separate "Development" one for testing).
2. **Access token**: Settings → Access Tokens → *Generate new token*, environment as above, permissions **Mux Video:
   Read and Write**. Save the **Token ID** and **Token Secret**.
3. **Signing key** (for private playback): Settings → Signing Keys → *Generate new key* for **Video**. Save the
   **Key ID** and the **Private Key** exactly as shown (it is base64 text; paste it as is).
4. **Webhook**: Settings → Webhooks → *Create new webhook* for the same environment:
   - URL: `https://abcd1234.supabase.co/functions/v1/mux-webhook`
   - Save the **Signing Secret** it shows.
   - Mux sends all video events; the function uses `video.upload.asset_created`, `video.asset.ready`,
     `video.asset.errored`, `video.upload.errored`, `video.upload.cancelled` and ignores the rest.

Every upload is created with a **signed** playback policy, so nothing can be watched without a token from the
`playback` function.

Trying it for free: set `MUX_TEST_MODE=true` below. Mux then creates test assets that are free, watermarked, limited to
10 seconds and deleted after 24 hours. Set it back to `false` for real use.

## 5. Add the Edge Function secrets

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

Fill in `supabase/functions/.env` (it's git-ignored):

```
MUX_TOKEN_ID=...
MUX_TOKEN_SECRET=...
MUX_SIGNING_KEY_ID=...
MUX_SIGNING_KEY_PRIVATE=...
MUX_WEBHOOK_SECRET=...
ALLOWED_ORIGINS=http://localhost:5173,https://your-name.github.io
MUX_TEST_MODE=false
MUX_VIDEO_QUALITY=basic
PLAYBACK_TOKEN_TTL_SECONDS=3600
```

`ALLOWED_ORIGINS` lists the **origins** (scheme + host, no path) the site runs on. It controls CORS for the functions and
which origin Mux accepts browser uploads from. Add your custom domain when you have one.

Upload them:

```bash
npx supabase secrets set --env-file supabase/functions/.env
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically. (If your
project only has the new key types, also set `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` as secrets.)

## 6. Deploy the Edge Functions

```bash
npx supabase functions deploy
```

This deploys `playback`, `upload-url`, `video-status`, `delete-video`, `admin-users` and `mux-webhook`. JWT checking at
the gateway is turned off in `supabase/config.toml` because each function authenticates the caller itself (signed-out
visitors may call `playback`, and Mux calls `mux-webhook` with a signature instead of a token).

You can also run both steps 3 and 6 from GitHub: see the *Deploy Supabase backend* workflow in
[DEPLOYMENT.md](DEPLOYMENT.md#backend-from-github-actions-optional).

## 7. Create the first administrator

1. Start the app (`npm run dev`), register with your email and confirm it from the email link.
2. In the Supabase **SQL Editor** run:

   ```sql
   select public.bootstrap_admin('you@example.com');
   ```

3. Reload the app. You now see **Admin** and **Creator studio** in the menu.

`bootstrap_admin` can only be run from the SQL editor (it is not exposed through the API). Afterwards, promote other
people from **Admin → Users**, and approve creator requests under **Admin → Creators**.

## 8. Check it works

Follow the checklist in [TESTING.md](TESTING.md). The quickest smoke test: upload a short video as the administrator,
wait for "Your video is live", and watch it in the feed from a private browser window while signed out.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Almost there" setup screen | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing; restart `npm run dev` after editing `.env.local` |
| "Could not reach the upload-url service" | Functions not deployed, or the project ref is wrong |
| "Server is missing the MUX_… setting" | Run `npx supabase secrets set --env-file supabase/functions/.env` again |
| "Origin not allowed" | Add the site's origin to `ALLOWED_ORIGINS` and set secrets again |
| Upload reaches 100% but stays "Processing" | Webhook URL/secret wrong. The upload page polls `video-status` as a fallback, so it should still finish |
| Video shows "couldn't be played" | Signing key ID/private key mismatch, or the key belongs to a different Mux environment |
| Confirmation link opens the wrong site | Fix Site URL and Redirect URLs (step 2) |
| Password reset says "Link expired" | Open the email link in the same browser you requested it from (PKCE), and within an hour |
