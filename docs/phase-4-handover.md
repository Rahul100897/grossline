# Phase 4 handover — Findings engine

Phase 4 is complete. For any tenant and month the engine produces a small set of
findings ranked by money at stake, each specific enough to act on, drafted into
client-ready prose the analyst reviews and approves, with a written record of
whether acting on it worked. This is the part clients pay for.

## What shipped, by task

| Task                        | What                                                                                                                             | Where                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 Schema + state machine  | findings + tenant_calibration tables (RLS); pure `reconcileFindings` computes new→recurring→resolved and keeps dismissals sticky | `packages/core/src/findings/{state-machine,types}.ts`, `packages/db/src/findings.ts`, migrations 0027–0028                                              |
| 4.2 Calibration             | pure `calibrateThresholds` from the tenant's own history + margin; per-tenant storage + Thresholds tab                           | `packages/core/src/findings/calibration.ts`, `packages/db/src/calibration.ts`, `services/worker/src/findings/calibrate.ts`, `merchants/[id]/thresholds` |
| 4.3 Rules library           | nine pure, golden-tested rules → finding record or null                                                                          | `packages/core/src/findings/rules.ts`                                                                                                                   |
| 4.4 Ranking + pipeline      | pure `rankAndSuppress` (floor, cap 3, claim-gap exempt); worker pipeline build→run→rank→reconcile→persist                        | `packages/core/src/findings/ranking.ts`, `services/worker/src/findings/{build-input,pipeline}.ts`                                                       |
| 4.5 Review console          | `/findings` queue: read, edit, approve, dismiss, mark deliberate                                                                 | `apps/admin/app/(console)/findings/*`, `components/finding-card.tsx`                                                                                    |
| 4.6 Commentary              | tier-1 deterministic templates + tier-2 guarded Anthropic narrative                                                              | `packages/core/src/findings/commentary.ts`, `services/worker/src/findings/commentary.ts`                                                                |
| 4.7 Recommendation tracking | pure `classifyRecommendation`; history table on the Findings page                                                                | `packages/core/src/findings/recommendations.ts`, `apps/admin/lib/recommendations.ts`                                                                    |
| 4.8 Findings as issues      | unreviewed findings → blocking issue, clears on approval                                                                         | `apps/admin/lib/issues.ts` (`findings` type)                                                                                                            |

## The invariants (all enforced and tested)

- **Structured records first, prose last.** A finding is a row of numbers
  (`findings` table + `evidence` jsonb). Rules produce `FindingDraft`; the model
  only writes over those numbers.
- **The model never calculates.** Tier-2 commentary receives the finding's
  computed numbers and nothing else, and its output passes through the figure
  guard (`foreignFigures`): any number not derivable from the record rejects the
  draft and falls back to the deterministic template. Tested both ways.
- **Missing inputs → skip with a reason, never a finding on absent data.** Each
  rule returns `fired | ok | skipped(reason)`; a `DataAvailability` flag set
  drives the choice. A test proves every rule skips on fully-absent data.
- **Money impact is the sort key** (integer minor units), not a severity label.
- **Thresholds are per tenant**, calibrated from each tenant's own history and
  margin; a test proves two margin structures produce different thresholds and
  that a threshold change flips a fire decision.
- **"Nothing needs changing" is a real, tested output** — reachable when only
  suppressed or measurement-risk findings remain.

## The pipeline and CLIs

Findings are computed by the worker, recomputable any number of times
(analyst-touched rows — approved, edited, dismissed — are preserved):

```
pnpm --filter @grossline/worker findings:calibrate <tenantId> [monthsBack] [--force]
pnpm --filter @grossline/worker findings:compute   <tenantId> <YYYY-MM>
pnpm --filter @grossline/worker findings:draft      <tenantId> <YYYY-MM>
```

`runFindings` (exported as `@grossline/worker/findings-pipeline`) and
`recompute`/`generateDraftsForPeriod` also run from the console. Commentary uses
the Anthropic Messages API via plain fetch (no SDK); model id from
`ANTHROPIC_MODEL` (default `claude-sonnet-5`), and it no-ops to the template
when `ANTHROPIC_API_KEY` is unset.

## Demo scenario (reproducible)

The demo's real finding set is a recurring **payback_broken** (blended MER is
healthy at ~2.5 but first-order acquisition is underwater — CAC > first-order
contribution) plus a **claim_gap** measurement risk. Producing it from a fresh
seed:

```
pnpm seed:demo
pnpm --filter @grossline/worker costs:import-shopify <demoTenantId>   # populate product COGS from raw payloads
pnpm --filter @grossline/worker metrics:compute <demoTenantId> <YYYY-MM>   # each month
pnpm --filter @grossline/worker findings:calibrate <demoTenantId> --force
pnpm --filter @grossline/worker findings:compute <demoTenantId> <YYYY-MM>  # each month, in order
pnpm --filter @grossline/worker findings:draft   <demoTenantId> <YYYY-MM>  # each month
```

Across May–Aug 2026 this gives the full state machine (payback new→recurring×3;
claim_gap new→resolved→new→recurring) and a recommendation history with a
resolved case carrying a measured result (May claim gap resolved; May payback
improving, CAC $64.73 → $54.44). The dev store, with no cost inputs or ad
platforms, correctly reports "nothing needs changing" with every rule skipping.

## Things worth knowing for Phase 5

- **Phase 5 delivers the approved set.** A finding is "sendable" when
  `approved_at` is set; `final_text` (or `draft_text`, or the live template) is
  the prose. The four-part note already names next month's check-metric, which
  is what recommendation tracking reads.
- **The HTML→PDF plumbing exists** (Phase 3 invoice PDFs): the pure template in
  `services/worker/src/billing/invoice-html.ts` pattern, and the Playwright
  wrapper split across `services/worker/src/pdf/render.ts` (worker/report
  runtime) and `apps/admin/lib/pdf.ts` (Next). The monthly report reuses it.
- **A month with unreviewed findings is a blocking issue** (`findings` type on
  the Issues page) — Phase 5 must not send a month that has not been reviewed.
- **Entity-level rules are ready but dormant on real data.** Dead-campaign,
  branded-search, search-term-waste and refund-outlier are golden-tested but the
  metric layer does not yet provide per-campaign order attribution, keyword
  reports, or per-product refunds, so they skip. Wiring those metrics is future
  work; the rules already consume them.

## Verification

- `pnpm verify` green on a clean clone of `main`. Core carries the findings
  goldens (state machine, calibration, nine rules, ranking, commentary + figure
  guard, recommendation classifier).
- Verified live in the browser (fresh tabs, zero console errors): calibration
  and the Thresholds tab; the review queue (edit → approve → "ready to send",
  dismiss/reopen); the recommendation history (resolved + improving + worsened +
  pending); findings-as-issues appearing on unapprove and clearing on approve.

Every decision is logged in `docs/decisions.md` under the 2026-09-10 entries.
The stray NUL byte in `packages/core/src/costs.ts` was fixed (behaviour
unchanged).
