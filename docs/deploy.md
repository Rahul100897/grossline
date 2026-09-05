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
