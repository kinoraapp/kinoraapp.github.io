# Deploying with GitHub

GitHub Pages hosts the **static website** only. The database, authentication, server-side functions and video storage
run on Supabase and Mux ([SETUP.md](SETUP.md)). Video files never go into the repository.

## 1. Put the code on GitHub

Create an empty repository on GitHub (for example `kinora`), then from this folder:

```bash
git init -b main
```

```bash
git add .
```

```bash
git commit -m "Initial commit"
```

```bash
git remote add origin https://github.com/YOUR-NAME/kinora.git
```

```bash
git push -u origin main
```

Before the first push, check that `git status` does not list `.env.local` or `supabase/functions/.env`. Both are in
`.gitignore`.

## 2. Configure the repository

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

**Settings → Secrets and variables → Actions → Variables** (these values are public, so variables are fine; secrets with
the same names also work):

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://abcd1234.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your anon or publishable key |
| `VITE_APP_NAME` | optional, e.g. `Kinora` |
| `CUSTOM_DOMAIN` | optional, e.g. `kinora.example.com` (see below) |
| `VITE_MAX_UPLOAD_MB`, `VITE_MAX_VIDEO_MINUTES` | optional upload limits |

## 3. Deploy

Every push to `main` runs `.github/workflows/deploy.yml`:

1. **check**: `npm ci`, type check, and `npm test` (the database access-control tests run on an in-process Postgres)
2. **build**: builds with the right base path (`/<repository>/`, or `/` for a custom domain or a
   `<name>.github.io` repository) and copies `index.html` to `404.html` so deep links like `/kinora/v/<id>` work
3. **deploy**: publishes `dist/` to GitHub Pages

Pull requests run only the check job. You can also start it by hand under **Actions → Build and deploy → Run workflow**.

Your site appears at `https://YOUR-NAME.github.io/kinora/`. Then:

- add that address to Supabase **Redirect URLs** (`https://YOUR-NAME.github.io/kinora/**`) and set it as the **Site URL**
- add the origin `https://YOUR-NAME.github.io` to the `ALLOWED_ORIGINS` Edge Function secret and run
  `npx supabase secrets set --env-file supabase/functions/.env`

## Custom domain

1. At your DNS provider:
   - **Subdomain** (e.g. `kinora.example.com`): a `CNAME` record pointing to `YOUR-NAME.github.io`
   - **Apex domain** (e.g. `example.com`): `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
     `185.199.111.153` (and optionally `AAAA` records to `2606:50c0:8000::153`, `2606:50c0:8001::153`,
     `2606:50c0:8002::153`, `2606:50c0:8003::153`)
2. Set the repository variable `CUSTOM_DOMAIN` to the domain. The workflow then builds with base path `/` and writes a
   `CNAME` file.
3. Re-run the workflow, then in **Settings → Pages** enter the custom domain and tick **Enforce HTTPS** once the
   certificate is ready (it can take a while after DNS changes).
4. Update Supabase **Site URL** and **Redirect URLs**, and add `https://kinora.example.com` to `ALLOWED_ORIGINS`.

Tip: verify the domain under your GitHub account settings (**Settings → Pages → Verified domains**) to stop anyone else
from claiming it.

## Backend from GitHub Actions (optional)

`.github/workflows/supabase.yml` applies the migrations and deploys the Edge Functions when you run it by hand
(**Actions → Deploy Supabase backend → Run workflow**). It needs:

| Kind | Name | Value |
|---|---|---|
| Secret | `SUPABASE_ACCESS_TOKEN` | a personal access token from supabase.com/dashboard/account/tokens |
| Secret | `SUPABASE_DB_PASSWORD` | the database password |
| Variable | `SUPABASE_PROJECT_REF` | e.g. `abcd1234` |

Mux secrets are still set once with `npx supabase secrets set` (they live in Supabase, not GitHub).

## Updating the app

Push to `main`. Installed PWAs download the new version in the background and show "A new version is available →
Update". Database changes go in a new, later-dated file in `supabase/migrations/` (never edit one that has been applied),
then run `npx supabase db push` or the backend workflow.
