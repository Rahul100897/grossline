# CLAUDE.md

Read this before every task. If anything here conflicts with an instruction in a prompt, say so rather than silently picking one.

## What this is

Grossline is a reporting product for Shopify DTC brands. It pulls Shopify orders, Google Ads cost and Meta Ads spend for many merchants, computes blended commercial metrics, and produces a monthly PDF report plus an admin console.

The business model is analyst-with-a-tool. Rahul is the only application user in v1. Merchants receive a PDF and, later, a read-only portal.

**Current phase: Phase 3 — Admin console.** Phases 0–2 are complete — see `docs/phase-2.md` and `docs/phase-2-handover.md` for the metric layer (every metric in `docs/metrics.md` computes, golden-tested, reconciliation-agreed), and `docs/phase-1-handover.md` for connector state (one real dev store connected; Meta/Google still on fixtures). The Phase 3 spec is not written yet; do not start console work without it. Do not build ahead of the current phase.

## Stack

- TypeScript everywhere. Node 22, pnpm workspaces.
- Next.js (App Router) for the admin console. Tailwind + shadcn/ui.
- Astro for the marketing site.
- Postgres with Drizzle for schema and migrations. Raw SQL for aggregate queries, TypeScript for line-level money math over jsonb payloads (reasoning in `docs/decisions.md`, accepted 2026-09-06).
- BullMQ on Redis for jobs.
- Zod at every boundary: API responses, form input, env vars.
- Playwright for PDF rendering. Resend for email.
- Vitest for tests.

## Repo layout

```
apps/web              marketing site (Astro)
apps/admin            admin console (Next.js)
services/worker       connectors, metrics, findings, reports
packages/db           schema, migrations, tenant-scoped query helpers
packages/core         metric calculations, shared types, rule definitions
packages/config       eslint, tsconfig, prettier
docs/                 metrics.md, phase specs, runbooks
```

## Non-negotiables

These are not style preferences. Breaking one is a bug even if tests pass.

1. **Every query is tenant-scoped.** No database read or write without a `tenant_id` filter. All access goes through the helpers in `packages/db`. Postgres row-level security is the second net, not the first.
2. **Raw platform data is immutable.** It lands untouched in `raw_*` tables. Metrics are computed in a separate step into `metrics_*` tables and can always be recomputed from raw. Never overwrite raw rows with derived values.
3. **Every sync is idempotent.** Upsert on the platform's own ID. Re-running any sync for any window must never double-count.
4. **Money is integer minor units.** Never floats. Every amount carries its currency code. Every converted amount stores the FX rate used and the date of that rate.
5. **Dates are stored UTC.** The source timezone is recorded per store and per ad account. The reporting timezone is applied at query time, never at write time.
6. **Every metric has a golden-file test.** Fixture in, expected value out, committed. A metric without a test is not done.
7. **No secrets in the repo.** Platform tokens are encrypted at rest. Keys come from the environment. `.env.example` lists names only, never values.
8. **Migrations are forward-only and reviewed.** No destructive migration without an explicit backup step in the same PR.
9. **Nothing merges without CI green.** Typecheck, lint, tests, migration check.
10. **Definitions live in one place.** Every metric formula is in `docs/metrics.md`. If code and that document disagree, the document is right and the code is a bug. Changing a definition means changing the document in the same PR.

## Commands

```
pnpm dev            run admin + worker locally
pnpm verify         typecheck, lint, test, migration check — same as CI
pnpm db:migrate     apply migrations
pnpm db:studio      inspect the database
pnpm seed:demo      load the demo tenant with 18 months of sample data
pnpm worker:sync    run a sync for one tenant
```

## How we work

Follow this loop for anything non-trivial. Do not skip to implementation.

1. **Review.** Read the relevant existing code and `docs/`. Report what is already there and what you understand the task to be.
2. **Gap doc.** Write what is missing, what is ambiguous, and what decisions are needed. Save it to `docs/scratch/<task>.md`.
3. **Backlog.** Propose a numbered list of changes, each one PR-sized.
4. **Confirm.** Stop and wait for approval of that list.
5. **Implement.** One item at a time. Run `pnpm verify` after each. Report what changed.

## Definition of done

- `pnpm verify` passes
- New metrics have golden-file tests
- New tables have a migration and tenant scoping
- Anything user-visible has an empty state and an error state
- `docs/` updated if behaviour or definitions changed

## Things to ask about rather than decide

- Any new metric definition, or any change to an existing one
- Any schema change to `raw_*` tables
- Adding a dependency
- Anything that touches encryption, token storage or access control
- Anything that would write to a merchant's Shopify store or ad accounts — the answer is always no, but flag it if a task seems to require it

## Things you should not do

- Do not invent metric formulas. If it is not in `docs/metrics.md`, ask.
- Do not build merchant-facing features yet. v1 is admin-only.
- Do not add attribution modelling, pixel tracking or forecasting. Explicitly out of scope.
- Do not use `any`. If a platform response is unknown, model it with Zod and fail loudly.
- Do not mock platform APIs in a way that hides real shapes. Record real responses as fixtures.
