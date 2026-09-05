## What this changes

<!-- One or two sentences. What behaviour is different after this merges? -->

## Task

<!-- e.g. Phase 0, task 0.3 -->

## Checklist

- [ ] `pnpm verify` passes locally
- [ ] Every new query is tenant-scoped and goes through `packages/db` helpers
- [ ] No raw platform data is overwritten by derived values
- [ ] Any sync change is still idempotent on re-run
- [ ] Money is integer minor units with a currency code; conversions store the FX rate
- [ ] New or changed metrics have a golden-file test
- [ ] New or changed metric definitions are updated in `docs/metrics.md` in this PR
- [ ] No secrets, tokens or real merchant data in the diff (including fixtures)
- [ ] Migration included if the schema changed, and it is forward-only

## Metric definitions touched

<!-- List them, or write "none". If any changed, say which periods need recomputing. -->

## How I tested this

<!-- Not "it works". What did you actually run or check? -->

## Anything the reviewer should look at closely

<!-- Ambiguous decisions, things you were unsure about, shortcuts taken. -->
