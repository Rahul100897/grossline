# Phase 8 handover — merchant portal and marketing-site completion

Phase 8 has two parts, both complete and merged to `main`:

- **Part A — the merchant portal** (`apps/portal`, tasks 8.1–8.10): a read-only,
  invitation-only app where a merchant logs in to read their own sent reports and
  the figures behind them. Admin-only-v1 is superseded; this is recorded in
  `CLAUDE.md` and `docs/decisions.md`.
- **Part B — marketing-site completion** (`apps/web`, task 8.11): the inner pages
  brought onto the homepage's design system, rewritten in plain language, with a
  "Log in" route to the portal and legal pages that describe real behaviour.

`pnpm verify` is green, and passes on a **repeated** clean-clone run (a
test-isolation flake in the auth suite was fixed — see Tests below).

> **Note on the spec.** `docs/phase-8.md` was worked from as a working-tree file
> and was never committed; `CLAUDE.md` references it. This handover plus the
> dated `docs/decisions.md` entries (2026-09-15) are the durable record of what
> was built and why. Re-committing the spec, or dropping the dangling reference,
> is a small follow-up.

---

## ⚠️ Legal pages need professional review before launch

The three legal pages describe what the software **actually does** (verified
against the code), but they are generated text, **not reviewed law**. Each file
carries a top-of-file `DRAFT` comment. Do not launch the marketing site publicly
until a qualified lawyer and/or CA (Indian jurisdiction) has reviewed them.
Specifically flag for review:

- **`apps/web/src/pages/terms.astro`**
  - **Governing law / jurisdiction** — currently "laws of India, courts of
    Ahmedabad, Gujarat." Confirm this is what you want and correctly stated.
  - **Liability cap** — "limited to the fees paid for the month in which a claim
    arises." A lawyer should confirm this is enforceable and adequate.
  - Whether a consumer/B2B distinction, indemnity, or dispute-resolution clause is
    needed.
- **`apps/web/src/pages/privacy.astro`**
  - The **"no customer PII"** claim is technically accurate (see below) but should
    be confirmed as adequately disclosed for GDPR/Indian DPDP purposes.
  - Data-subject rights wording (access/correction/deletion) — confirm it meets
    the regimes you operate under.
  - Retention period is described qualitatively ("while the engagement is active")
    — a lawyer may want a stated maximum.
- **`apps/web/src/pages/data-processing.astro`**
  - **Controller/processor split** wording.
  - **Sub-processor list** — currently the hosting/database provider (unnamed),
    **Resend** (email) and **Anthropic** (report commentary). Name the hosting
    provider, and keep the list current; a DPA may need to enumerate them formally.
  - **International-transfers** clause is described generically — confirm the legal
    basis (SCCs etc.) for each provider.

The "no customer PII" claim is **true as built**: the Shopify connector
(`services/worker/src/connectors/shopify/queries.ts`) deliberately requests only
an opaque customer id, order count and lifetime-spend figure — never a name,
email, phone or address (see the comment at `CUSTOMER_FIELDS`). If that query is
ever widened to pull identifying fields, the privacy and data-processing pages
become inaccurate and must change in the same PR.

---

## Demo login

The portal ships with a seeded demo merchant so the experience can be shown
without touching a real store.

| | |
|---|---|
| **Portal URL (local)** | http://localhost:3002 |
| **Email** | `demo@getgrossline.com` |
| **Password** | `explore-grossline` (override with `DEMO_PORTAL_PASSWORD`) |
| **Tenant** | demo-brand — `63a34105-1758-4881-8444-c2829409838b` (America/New_York, USD) |

Seed / reset:

```
pnpm seed:demo-portal   # create the demo merchant user + membership
pnpm demo:reset         # re-seed the deterministic demo identity + tenant
```

The demo tenant has 18 months of seeded data with metrics computed and two sent
reports (2026-07, 2026-08), so the portal shows real figures and a report
archive immediately. `demo:reset` restores identity + tenant seed but **not**
computed metrics — recompute is part of the nightly job; after a reset run
`pnpm --filter @grossline/worker metrics:recompute <tenant>` if the portal needs
figures again.

---

## Part A — the merchant portal

### Auth (no new dependency)

Reuses the admin primitives: `hashPassword`/`verifyPassword` (scrypt) and the
Web-Crypto HMAC session token from `@grossline/core/auth/*`. Unlike admin's
stateless token, **merchant sessions are DB rows** (`merchant_sessions`) so they
can be revoked and rotated immediately. Login is rate-limited and locks out
(≥5/email or ≥20/IP in 15 min), every attempt is audited, and the session token
is rotated on login.

- Identity tables (migrations 0035–0037): `merchant_users`,
  `merchant_memberships`, `merchant_sessions`, `merchant_tokens`,
  `merchant_login_attempts`. Helpers in `packages/db/src/merchant.ts` and
  `merchant-auth.ts`.
- Invite / password-reset / view-as tokens are single-use, hashed at rest, and
  time-bounded (invite 72h, reset 1h, view-as 2min).

### Tenant scoping — the non-negotiable

**Tenant identity comes only from the session and its memberships, never from
client input.** `app/(app)/scope.ts` is the single place a page obtains its
tenant; there is no code path that accepts a tenant id from a URL, query,
header or form field. The active tenant is `session.activeTenantId` when it is
one of the user's memberships, else the first membership. Switching tenants goes
through `switchTenant`, which validates the target against memberships.

Merchant identity tables use `adminDb()` (no RLS, like `admin_users`); all
**data** reads (metrics, reports) go through `withTenant(...)` under Postgres
RLS. So the portal has two nets: session-derived scoping first, RLS second.

### Pages (`apps/portal/app/(app)`)

This month, Channels, Customers, Products, Reports (archive + per-period HTML
view and PDF, `status === 'sent'` only), Settings (report-a-problem →
`createTicket`, refused under view-as). The shell shows a tenant switcher (only
when multi-tenant and not view-as), a view-as banner, and a stale-sync banner
when a connection is degraded/broken.

### Admin side (`apps/admin/.../merchants/[id]/access`)

An "Access" tab per merchant: invite / resend / change role / revoke / disable /
**View as**. View-as issues a single-use handoff token and redirects to the
portal's `/view-as/[token]?tenant=…`, which exchanges it for a **read-only,
30-minute** session pinned to that tenant. Every action is audited.

### Isolation suite (8.9) — the thing that must never regress

- `packages/db/test/portal-isolation.test.ts` — proves the session→data path:
  tenant A's session cannot read tenant B's data across five vectors.
- `apps/portal/test/route-scope.test.ts` — a **guard that fails if a new
  `(app)` route is added without going through `scope()` /
  `requirePortalSession()` / `getPortalSession()`.** If you add a portal route
  and this test fails, that is the point — wire it through the session, don't
  weaken the test.
- `apps/admin/test/portal-session-refused.test.ts` — admin routes refuse a portal
  cookie.

### Operations (8.10)

`offboardTenant` now calls `removeTenantMerchantAccess` first (drops memberships,
kills sessions, deletes orphaned users). Merchant login / lockout / admin access
actions all land in the shared audit log. A dedicated failed-login alert and the
nightly demo-reset + metrics-recompute schedule are noted for the ops runbook.

---

## Part B — marketing site (`apps/web`, Astro)

- **`Marketing.astro`** is now the single layout — the homepage's design system
  (self-hosted fonts, `--gl-*` tokens, nav, footer, and a `pagehead` / `prose` /
  `card` / form vocabulary). `Base.astro` is deleted.
- **what-it-does, the-report, pricing** rebuilt on it, matching the homepage at
  1440px and 390px, with jargon rewritten to plain language (MER, blended CAC,
  contribution, reporting timezone, claim gap → their plain meanings). Pricing
  mirrors the homepage's exact tiers (Advisory / Growth / Partner); the
  client-quote slot is left visibly empty.
- **Legal**: privacy + terms rewritten and a new **data-processing** page — see
  the review warning above.
- **contact + free-report** forms restyled onto the layout. The free-report form
  is unchanged functionally — it posts to the admin public intake endpoint with
  ticket type `free_report`, which creates the ticket and emails the analyst.
- **Log in** added to the nav (before the CTA) and footer on every page, pointing
  to the portal via `PUBLIC_PORTAL_URL` (dev fallback `http://localhost:3002`).

> **Design skill.** No `frontend-design` skill is installed in this environment
> (searched; only an unrelated match). Part B was built directly against
> `docs/design/design-tokens.css` and the ported homepage, consistent with the
> Phase 3/5 precedent.

---

## Running the Phase 8 pieces

```
pnpm --filter @grossline/portal dev   # merchant portal → http://localhost:3002
pnpm --filter @grossline/admin  dev   # admin console   → http://localhost:3000
pnpm --filter @grossline/web    dev   # marketing site  → http://localhost:4321
```

The portal needs the admin console for the view-as handoff and the marketing
forms' intake endpoint. Env: `PUBLIC_PORTAL_URL` (web → portal), `PORTAL_BASE_URL`
(admin → portal for view-as/invite links), `PUBLIC_ADMIN_URL` (web forms →
admin intake). All are listed in `.env.example`.

---

## Tests added

DB: `merchant-identity`, `merchant-auth`, `portal-isolation`,
`merchant-viewas-ops`. Portal: `route-scope` (the new-route guard). Admin:
`portal-session-refused`. All green; `pnpm verify` passes on a clean clone and on
a repeated back-to-back run.

**Test-isolation fix (this phase):** the merchant lockout tests used constant IPs
against a test DB that is not reset between local runs, so a second `pnpm verify`
inside the 15-minute lockout window failed spuriously. They now use a unique IP
per run. CI was never affected (fresh DB each run); the fix makes local repeated
verification reliable.

---

## Known gaps / follow-ups

- **Legal review** before public launch (above) — the single most important gate.
- **`docs/phase-8.md` is not committed** though `CLAUDE.md` references it.
- Not built, by design (out of scope for v1): self-signup, billing / card
  payment, the $179 Insight tier, any merchant-facing edit of data Rahul owns.
- Inherited from Phase 5/7 and still open: no scheduled worker jobs for
  report/digest build; no production deploy target; Meta/Google still on
  fixtures; the four dormant entity-level findings rules.
- The hosting/database provider is unnamed on the data-processing page — name it
  once chosen.
