# Deploying the marketing site (apps/web) to Cloudflare Pages

Phase 0 target: `getgrossline.com` live on Cloudflare Pages. Needs Rahul's
Cloudflare account, so these are the manual steps. Nothing else in the repo
deploys yet.

## One-time setup

1. Cloudflare dashboard → **Workers & Pages → Create → Pages →
   Connect to Git** and select `Rahul100897/grossline` (grant the Cloudflare
   GitHub app access to this repo only).
2. Build configuration:
   - **Framework preset**: Astro
   - **Build command**: `pnpm --filter @grossline/web build`
   - **Build output directory**: `apps/web/dist`
   - **Root directory**: leave as `/` (the workspace needs the repo root)
   - **Environment variables**: `NODE_VERSION=22` (Pages defaults may be older)
3. Deploy. The first build gives a `*.pages.dev` URL — check `/`, `/privacy`
   and `/terms` render.

## Custom domain

4. If `getgrossline.com` is not yet in this Cloudflare account, add it as a
   zone and point the registrar's nameservers at the ones Cloudflare assigns.
5. In the Pages project → **Custom domains → Add** `getgrossline.com`
   (and `www.getgrossline.com`, set to redirect to the apex or vice versa —
   pick one canonical host). Cloudflare creates the CNAME records itself.
6. Wait for the TLS certificate to issue, then verify
   `https://getgrossline.com` serves the site.

## Email on the domain

The site lists `hello@getgrossline.com`. Set up routing so it actually
delivers: Cloudflare dashboard → the zone → **Email → Email Routing** →
create the `hello@` address and forward it to the personal inbox. (Later,
Resend will need DNS records on this same zone for outbound report emails —
that is Phase 2, nothing to do now.)

## After it is live

- Every push to `main` that touches `apps/web` redeploys automatically.
- The live URL unblocks the Google Ads developer-token application, which
  wants a real company website.

## Phase 5 additions (marketing site)

Part C runs locally; deploy is still gated on the Cloudflare account. When the
site does go up, the Phase 5 pieces need:

- **`PUBLIC_ADMIN_URL`** must be set as a Pages build-time environment variable
  pointing at the deployed admin origin (e.g. `https://admin.getgrossline.com`).
  The Contact and Free-report forms post to `${PUBLIC_ADMIN_URL}/api/tickets/intake`;
  it falls back to `http://localhost:3000` in dev. Without it, live intake would
  POST to localhost and silently fail. (The admin intake route already sends
  permissive CORS for the static site to POST cross-origin.)
- **`PUBLIC_PORTAL_URL`** (Phase 8) must likewise be set as a Pages build-time
  variable pointing at the deployed merchant-portal origin (e.g.
  `https://portal.getgrossline.com`). The "Log in" links in the nav and footer of
  every page point there; it falls back to `http://localhost:3002` in dev.
  **Both variables are baked in at build time**, so the marketing site must be
  rebuilt (a Pages "Retry deployment" or any push to `main`) after the admin and
  portal origins exist — until then, "Log in" and the forms point at localhost and
  will not work for a real visitor.
- **The sample report is a committed static asset** (`apps/web/public/sample-report.pdf`
  and `.png`), generated from the demo tenant by the Part B pipeline — no build
  step renders it. Regenerate and re-commit it when the report definition or the
  demo data changes (re-run `reports:build` for the demo, then re-render the
  PDF/PNG into `apps/web/public`). Every push to `main` touching `apps/web`
  redeploys, so the refreshed asset ships automatically.
- **No third-party analytics** is wired, by design (privacy-first). If analytics
  are ever wanted, use a privacy-preserving, cookieless option only.
- The site references `hello@getgrossline.com`; outbound report emails (Resend)
  and the admin/worker runtime (Playwright/Chromium for PDFs, the Postgres
  migrations for the `reports`/`reconciliation_runs` tables) are a separate,
  still-unwired admin/worker deploy — not part of the marketing-site Pages deploy.

---

# Merchant portal + Postgres (Render)

Phase 8 demo deploy: the merchant portal (`apps/portal`) on **Render** with a
**Render Postgres** database, seeded with the synthetic demo tenant so a client
can be given a working login. This is the demo slice only — the admin console,
the worker and Redis are **not** deployed here (the demo is read-only and its
data is pre-seeded, so it needs neither).

Provider decision recorded in `docs/decisions.md` (2026-09-15): hosting is
**Render**, database is **Render Postgres**. These are the names the
`/data-processing` page now uses.

## What is in the repo

- `apps/portal/Dockerfile` — production image (build from the repo root; the
  portal needs its workspace packages). Ships Chromium for the report-PDF route.
- `render.yaml` — a blueprint for the portal web service (the database is created
  in the dashboard so its cost is a deliberate choice).
- `packages/db/scripts/prod-app-role.sql` — creates the `grossline_app` role
  (no BYPASSRLS) on the production database, so row-level security is enforced.
- `pnpm --filter @grossline/worker demo:provision` — seeds the synthetic demo
  tenant, computes metrics through the last complete month, and creates the demo
  login. Safe on any database; never touches a real store or credentials.

## 💰 Cost (flag before committing)

- **Web service**: Render Starter ≈ **$7/mo**. The Free tier works but cold-starts
  (~50s) look bad for a client demo.
- **Postgres**: Render's smallest paid tier ≈ **$7/mo**. Free Postgres exists but
  **expires after ~30 days** — unsuitable for a demo you keep sending out.
- Total ≈ **$14/mo**. Nothing here is charged until you create the paid services.

## One-time setup

1. **Create the database.** Render dashboard → **New → Postgres**. Pick a name
   (e.g. `grossline-db`), region, and a paid plan (see cost above). Note both the
   **Internal Database URL** (the owner connection string) and the host/db/user.
2. **Create the `grossline_app` role.** Using the database's `psql` (Render shows
   a connect command), run the repo script with a strong password:
   ```
   psql "<owner connection string>" \
     -v app_password="'<a-strong-secret>'" \
     -f packages/db/scripts/prod-app-role.sql
   ```
3. **Run migrations** against the owner connection string (applies the schema,
   RLS policies and the grants to `grossline_app`):
   ```
   DATABASE_URL="<owner connection string>" NODE_ENV=production pnpm db:migrate
   ```
4. **Provision the demo data** (synthetic only):
   ```
   DATABASE_URL="<owner connection string>" NODE_ENV=production \
     pnpm --filter @grossline/worker demo:provision
   ```
   It prints the demo login: `demo@getgrossline.com` / `explore-grossline`.
5. **Create the web service.** Render → **New → Blueprint**, point it at this repo
   (it reads `render.yaml`), or **New → Web Service → Docker** with Dockerfile
   `apps/portal/Dockerfile` and context `/`. Set env vars:
   - `DATABASE_URL` = the owner connection string
   - `APP_DATABASE_URL` = same host/db, user `grossline_app`, the password from
     step 2
   - `SESSION_SECRET` = a strong random string (the blueprint generates one)
   - `NODE_ENV` = `production`
6. **Deploy.** The build runs the Dockerfile; the service comes up on a
   `https://grossline-portal-*.onrender.com` URL. Open `/login` and sign in with
   the demo credentials — you should land on the latest complete month with real
   figures. That URL is the one to send a client.

## Wiring the marketing "Log in" to it

Once the portal URL exists, set `PUBLIC_PORTAL_URL` to it in the Cloudflare Pages
project and rebuild (see the marketing section above) so the site's "Log in"
points at the live portal instead of localhost.

## Known limits of the demo slice

- **Reports tab is empty** — the demo has no *sent* reports (building and sending
  a report is a gated admin flow, and the admin console is not deployed here). The
  four data tabs (This month, Channels, Customers, Products) are fully populated;
  Reports shows its empty state. Provisioning demo reports is a fast follow.
- **No RLS bypass**: the portal connects as `grossline_app`, so RLS is enforced in
  production exactly as locally — proven by the isolation suite.
- Verified locally before any Render spend: the Dockerfile image builds, boots,
  and the demo login renders August figures against the `grossline_app`
  (RLS-enforced) connection.
