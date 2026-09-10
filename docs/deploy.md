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
