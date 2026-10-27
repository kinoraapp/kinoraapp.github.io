# Kinora

*Short videos, your way.*

Kinora is a TikTok-style short-video web app. It is a **website first**: it opens from a URL on Android, iPhone, Windows,
Mac and tablets, with no app-store download, and can optionally be installed as a Progressive Web App (PWA). Creators
upload vertical videos; viewers swipe through a full-screen feed, like, comment, save, follow and share. Every video has
its own access setting, enforced on the server.

> **Status:** the code is complete and tested locally, but the app is **not connected to live services yet**. Until you add
> your own Supabase project and Mux account (about 30 minutes, see [docs/SETUP.md](docs/SETUP.md)), the site shows a
> "finish setup" screen. The [credentials table](#what-needs-credentials) lists exactly what each feature needs.

## Features

**Watching**
- Vertical, snap-scrolling feed ("For You" and "Following") that autoplays the visible video and pauses the rest
- Play/pause (tap), double-tap to like, mute/unmute, progress bar with seeking, full-screen, keyboard shortcuts
  (↑/↓ or J/K, Space, M) on desktop
- Data saving: only the visible video and its two neighbours load; adaptive HLS streaming sized to the player
- Like, comment (with replies), save, playlists, share (native share sheet or copy link), report
- Explore: search videos, #hashtags and @creators, categories, trending hashtags
- Creator profiles with follow, public videos and public playlists
- Library (saved, liked, playlists), Inbox with live notifications

**Creating** (approved creators)
- Upload MP4, WebM or MOV straight from the device to Mux with resumable, chunked uploads and a progress bar
- Preview before publishing, title, caption, hashtags, category, comments on/off
- Custom thumbnail: upload an image or grab the current frame
- Publish now, schedule for later, or save as a draft; edit, unpublish or delete any time
- Creator studio: views/likes/comments/saves/followers, 14-day views chart, top videos, video library with filters

**Access control** (per video)

| Setting | Who can watch |
|---|---|
| Public | Everyone; shown in feeds, search and the profile |
| Unlisted | Anyone with the secret link; hidden from feeds and search. "New link" revokes the old one |
| Selected users | Only signed-in accounts the owner or an administrator has granted |
| Private | Only the owner and administrators |
| Draft | Only the owner and administrators |
| Scheduled | Nobody but the owner and administrators until the publish time, then its visibility setting applies |

Checks run in the **database** (Row Level Security + one `can_view_video()` function) and in the **playback Edge
Function**, which only signs short-lived Mux playback tokens for videos the caller may watch. Mux playback IDs are
useless without a token, so copying or guessing a stream URL does not work. Details: [docs/SECURITY.md](docs/SECURITY.md).

**Roles**
- **Viewer**: watch, like, comment, follow, save, share, report, request creator access
- **Creator**: everything above, plus upload and manage their own videos, visibility and statistics
- **Administrator**: dashboard with platform analytics and storage usage; manage users and roles; approve creators;
  pause uploads; suspend accounts; moderate videos, comments and reports; grant and revoke video access

**App**
- Installable PWA (manifest, icons, theme colour, standalone mode, install prompt / iOS instructions, update prompt)
- Offline-safe: the service worker caches only the app shell, never videos, API responses or account data
- 15 pages: feed, explore, login, register (+ password reset), profile, upload, video details, library, inbox/notifications,
  settings, creator studio (+ editor), admin dashboard, privacy policy, terms, 404

## Tech stack

| Part | Choice | Why |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, React Router | Fast static build that GitHub Pages can host |
| PWA | vite-plugin-pwa (Workbox) | Manifest + service worker with a precise caching policy |
| Auth + database | Supabase (Postgres, Auth, Row Level Security, Realtime, Storage for images) | Security rules live next to the data |
| Server-side logic | Supabase Edge Functions (Deno) | Keeps Mux credentials and the service-role key off the browser |
| Video | [Mux Video](https://www.mux.com) | Direct browser uploads, HLS adaptive streaming, **signed playback** for private videos, thumbnails, webhooks |
| Hosting | GitHub Pages via GitHub Actions | Free static hosting with HTTPS and custom domains |

Why Mux: it supports signed (JWT) playback per video, which is what makes private, unlisted and selected-user videos
genuinely private, plus direct uploads from the browser with a one-time URL, so no secret ever reaches the client.

```
Browser (React PWA on GitHub Pages)
 ├── Supabase Auth ─────────────── sign up / log in / reset password
 ├── Supabase Postgres (RLS) ───── profiles, videos, likes, comments, follows, ... (anon key + user JWT)
 ├── Supabase Storage ──────────── avatars (public), custom thumbnails (private, signed URLs)
 ├── Edge Function upload-url ──── checks permission → one-time Mux upload URL
 │      └─ browser uploads the file straight to Mux (chunked, resumable)
 ├── Edge Function playback ────── checks access in Postgres → signed Mux stream + poster URLs (1 h)
 ├── Edge Functions video-status, delete-video, admin-users
 └── Mux ── webhook ──> Edge Function mux-webhook (signature-verified) → marks videos ready
```

## What needs credentials

| Feature | Needs |
|---|---|
| Opening the site, PWA install, legal pages | Nothing |
| Accounts, feed, likes, comments, follows, admin dashboard | Supabase URL + anon key (`VITE_SUPABASE_*`) and the migrations applied |
| Password-reset and confirmation emails | Supabase Auth email (built-in for testing; add SMTP for production) |
| Uploading videos | Edge Functions deployed + `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` |
| Playing videos and thumbnails | Edge Functions + `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_KEY_PRIVATE` |
| Videos becoming "ready" automatically | `MUX_WEBHOOK_SECRET` + webhook URL in Mux (without it, the upload page polls `video-status` instead) |
| Account bans at sign-in (suspension) | Edge Functions (uses the service role, set automatically by Supabase) |
| Scheduled videos flipping to "published" + follower notifications | `pg_cron` (enabled by the migration on Supabase); scheduled videos go live on time even without it |
| Deployment | A GitHub repository with Pages enabled |

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` go into the frontend; both are designed to be public. Every other
secret lives in Supabase Edge Function secrets. `.env.local` and `supabase/functions/.env` are git-ignored.

## Getting started (local)

Requirements: Node.js 20.19+ (22 recommended) and npm.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see [docs/SETUP.md](docs/SETUP.md)), then:

```bash
npm run dev
```

Open http://localhost:5173. Without Supabase settings you'll see the setup screen.

| Script | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and build to `dist/` (also writes `404.html` for client-side routing on GitHub Pages) |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript checks for the app, the tests and the Edge Functions (with a small Deno type shim) |
| `npm test` | Runs the database security tests (real Postgres via PGlite, all migrations) and Mux token/webhook tests |
| `npm run icons` | Regenerates the PNG app icons and favicon from the logo |

## Building it in stages

1. **Frontend**: `npm install && npm run dev` shows the setup screen; `npm test` proves the database rules work.
2. **Supabase**: create a project, apply `supabase/migrations`, add the URL and anon key: accounts, profiles, feed,
   social features and the admin dashboard work. Make yourself administrator with `bootstrap_admin`.
3. **Mux**: add the Mux secrets and deploy the Edge Functions: uploading and playback work.
4. **GitHub Pages**: push to GitHub, set the repository variables, and the workflow publishes the site.
5. **Custom domain** (optional): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#custom-domain).

## Project structure

```
src/
  config/        brand.ts (name, colours), env.ts (environment settings)
  lib/           api.ts (every Supabase call), playback.ts (signed-URL cache), upload.ts, types, formatting
  auth/          session/profile context and route guards
  components/    feed, video player, comments, forms, access manager, charts, layout, modals
  pages/         one file per screen
  styles/        theme.css (tokens), app.css
supabase/
  migrations/    schema, RLS policies, RPC functions, storage buckets, scheduled publishing
  functions/     playback, upload-url, video-status, delete-video, admin-users, mux-webhook (+ _shared)
tests/           db/ (access-control tests on PGlite), edge/ (Mux token + webhook signature tests)
scripts/         icon generator, post-build step for GitHub Pages
.github/workflows/  deploy.yml (check + GitHub Pages), supabase.yml (manual backend deploy)
docs/            SETUP.md, DEPLOYMENT.md, SECURITY.md, TESTING.md
```

## Customising the brand

- Name: `VITE_APP_NAME` (or `brand.name` in `src/config/brand.ts`)
- Colours: `--brand-1` / `--brand-2` and the surface colours in `src/styles/theme.css`, plus `primary`/`secondary` in
  `src/config/brand.ts` (used by the manifest and logo)
- Logo: `LogoMark` in `src/components/Brand.tsx` and the same artwork in `scripts/generate-icons.mjs`; run `npm run icons`
- Legal pages: `src/pages/StaticPages.tsx`; set `supportEmail` in `brand.ts`

## Documentation

- [docs/SETUP.md](docs/SETUP.md): Supabase, Mux, Edge Functions, first administrator
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): GitHub Pages, repository settings, custom domain
- [docs/SECURITY.md](docs/SECURITY.md): how access control works and what protects what
- [docs/TESTING.md](docs/TESTING.md): automated tests and the manual end-to-end checklist
