# Phase 2 handover — metric layer

Completed 2026-09-06, PRs #14–#28 (squash merges, CI green on every one).
Read with `docs/phase-2.md` (the spec) and `docs/decisions.md` (every
judgement call, dated).

## What exists

**Storage.** `metric_values` — one row per (metric, grain day|month, period,
scope), money as integer minor units with currency, rates as 6-dp decimals,
completeness/provisional/FX traces in `meta`. `metric_runs` records every
compute with the raw watermark it read. Both RLS'd like every tenant table.
Raw is never touched; everything recomputes from raw.

**Compute.** Pure functions in `packages/core/src/metrics/` (order-facts,
revenue, customers, margin, ad-platforms, blended, channels), orchestrated by
`services/worker/src/metrics/pipeline.ts`. Commands:

```
pnpm metrics:compute <tenantId> <YYYY-MM>
pnpm metrics:recompute <tenantId> <from> [to]
```

Nightly: the scheduler enqueues a `metrics` job per active tenant 30 minutes
after the sync fan-out; it recomputes the current + previous month (platform
restatement windows land there). NOTE (flagged in decisions.md): computation
is TypeScript over raw payloads, deviating from CLAUDE.md's "Raw SQL for
metric queries" stack line — rationale recorded, portable later.

**Metric families** (all per docs/metrics.md, which gained ~10 changelog
entries this phase):

- Revenue: gross/discounts/returns/net (returns on the original order's
  processedAt), shipping revenue (minus shipping-only refunds), taxes,
  order count, units, AOV, units/order, refund rate, cancelled rate —
  daily series (explicit zero days) + monthly.
- Customers: new/returning by the store's own record (cohort anchored on the
  `customerOrderIndex = 1` order), new-customer count/revenue/share, repeat
  rate 30/60/90 + time-to-second (provisional until windows close),
  frequency buckets, cohort revenue-per-customer curves.
- Margin: COGS on net units at the cost effective on the order date with
  completeness meta (missing cost ≠ zero), gross profit/margin, contribution,
  full contribution (only with complete merchant inputs), break-even ROAS.
- Ad platforms: per platform/campaign spend, impressions, clicks, CPM/CPC/CTR,
  platform-reported conversions/value/ROAS (labelled, reference-only, never
  summed across platforms, never blended — proven by test), budget pacing.
- Blended: total ad spend (per-day FX with recorded rates), MER, aMER,
  blended CAC, first-order contribution vs CAC, spend share vs
  store-recorded revenue share. Zero denominators → absent.
- Channels: first/last-touch mix by source/medium/campaign, landing pages,
  days-to-conversion, claim gap (both numbers, `notACorrection`).
- Comparisons: one engine — MoM, YoY, rolling 7/28/90; missing history is
  explicitly absent, no Δ% against zero/absent, rolling exposes coverage.

**Testing.** Hand-calculated goldens for every family (derivation tables in
the test headers — values never came from the implementation); committed
golden FILES (`services/worker/test/goldens/`, regenerate with
`UPDATE_GOLDENS=1`) turn any definition change into a readable PR diff; the
metric layer and the untouched 1.7 reconciliation math agree exactly on the
demo tenant — that agreement test caught two real divergences (cohort
anchoring, Google rounding grain) before anything shipped.

## Exit criteria

| Criterion | Status |
|---|---|
| Every metric in docs/metrics.md computes for any tenant/month | ✅ |
| Golden test per metric, hand-calculated values | ✅ (+ diff-harness files) |
| Metric layer and 1.7 reference math agree independently | ✅ exact, by test |
| Recompute from raw: single command, idempotent | ✅ proven by test |
| Missing cost data → completeness flag, never a wrong number | ✅ |
| Open questions closed | ✅ four decisions + changelog (PR #19) |
| `pnpm verify` green | ✅ incl. clean clone from GitHub, no .env |

## Caveats for Phase 3 (admin console)

- **Provisional flags and completeness live in `meta`** — every surface that
  renders a metric must show them, or the number lies by omission.
- **Blended ratios can be absent** (zero spend / zero cohort). Render absence,
  not zero.
- The dev store's data is thin (10 seeded orders); the demo tenant is the
  realistic dataset. The 60-day `read_all_orders` limit still stands on the
  real store — its warning is on the connection.
- Cost inputs and product costs exist for the fixture/demo tenants only where
  tests created them; the real tenant needs `pnpm costs:import-shopify`, a
  costs CSV, and `/tenants/<id>/costs` filled in before margins mean anything.
- FX: run `pnpm fx:pull 500` before computing over non-USD history; a missing
  rate fails the run loudly by design.
