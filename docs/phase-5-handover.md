# Phase 5 handover — growth findings, report delivery, marketing site

Phase 5 is complete. Three parts, all merged (PRs #52–#68). This is the
per-phase detail; the consolidated view is `docs/handover.md`, the spec is
`docs/phase-5.md`, and every decision is in `docs/decisions.md`
(2026-09-10 entries, tasks 5.A1–5.C4).

**Phase marker is now Phase 7 — Operations hardening.** Phase 6 is intentionally
unused (the Phase 5 spec set the next marker directly to 7).

---

## Part A — Growth findings

Findings that point at money _available_, not only money being lost. Waste is
provable; growth is a hypothesis, and the two are never presented as the same
kind of claim.

- **A1 — schema.** `findings` gained `family` (`waste | growth | measurement`)
  and a nullable `opportunity_value_minor`. A finding carries a `money_impact`
  (waste/measurement) OR an `opportunity_value` (growth), never both — enforced by
  a Postgres CHECK (`findings_value_exclusive`) and the pure `valueIsExclusive`
  guard in core. Existing rows backfilled to `waste`; `claim_gap` → `measurement`.
- **A2 — ranking across families.** `rankAndSuppress` ranks both value fields in
  one list; higher value wins, waste above growth at equal value. Cap 3 total,
  **at most one growth per report**, and **growth is suppressed entirely when no
  waste finding fires** (a report is never only growth). `GROWTH_CAP = 1`.
- **A3 — `spend_headroom` (growth).** Fires when blended MER is comfortably above
  break-even (`× 1.2`) and spend is not pacing over target. Opportunity =
  `round(totalAdSpend × (MER ÷ break-even − 1))` — deployable spend at _today's_
  efficiency; the note frames it as a ceiling, not a target. Check metric MER.
- **A4 — `scale_signal` (growth).** A campaign whose **platform-reported** ROAS is
  ≥ 1.5× the spend-weighted account average while holding ≤ 25% of spend.
  Opportunity is conservative: `round(shareShift × (campaignRoas − avgRoas))`,
  `shareShift = 25%` of the campaign's spend — the revenue _difference_, not the
  ROAS applied to more budget. Stays labelled platform-reported, never blended.
- **A5 — review console + commentary.** The review card badges by **family**
  (green accent + "growth opportunity" for growth, "measurement risk" for claim
  gap) — never by severity. Two growth commentary variants in the same four-part
  shape. **The figure guard is unchanged**; the opportunity value is added to the
  allowed-figure set (it is a number in the record), and foreign figures are still
  rejected.
- **A6 — growth recommendation outcomes.** A growth bet that was tried and did not
  hold is recorded as `worsened` + **actioned** (waste worsened stays not
  actioned). `platform_roas` is higher-is-better. Console reads "tried — mer 2.59
  → 2.50, would revert".

The four defensive entity-level rules (dead-campaign, branded-search,
search-term-waste, refund-outlier) still skip on real data — unchanged from
Phase 4. `scale_signal` fires on the demo because per-campaign platform ROAS
exists; per-campaign _order attribution_ is what the four skippers still lack.

---

## Part B — Report delivery

- **B1 — template.** `renderReportHtml(ReportModel)` is one pure HTML string
  (`services/worker/src/reports/report-html.ts`, exported via the worker map) →
  both PDF and web preview, so content can't drift. Seven fixed sections:
  Headline · Blended efficiency · Margin (waterfall + completeness) · Channel &
  claim gap (labelled measurement) · What changed (MoM/YoY) · Findings (approved
  set, family-distinct) · What we check next month. Honesty markers (currency,
  timezone, last synced/reconciled, provisional, cost completeness) travel in a
  header bar. `buildReportModel` (`@grossline/worker/report-model`) selects it all
  from the metric layer + findings, read-only.
- **B2 — PDF.** `htmlToPdf(html, opts?)` gained per-page margins + header/footer;
  `REPORT_PDF_OPTIONS` sets 14/16mm margins and a "page X / Y" footer. Print CSS
  (`thead { display: table-header-group }`, `tr`/`.block`/`.finding` break-inside
  avoid) stops orphaned headers and split rows — verified with pypdf on a 70-row,
  4-page report (header repeats on every table page; content-identical re-render).
- **B3 — pipeline + snapshot.** `reports` table; `buildAndSaveReport` stores the
  ReportModel as a jsonb `snapshot`, `renderStoredReport` renders from it. A sent
  report is frozen; a past report is immune to later definition/cost changes
  (DB-tested). CLI `reports:build <tenant> <YYYY-MM>`.
- **B4 — console + send gate.** `/reports` (new nav item): build / preview
  (HTML route) / download PDF / mark ready / send / archive. **Send is blocked**
  with reasons when findings are unreviewed **or** reconciliation has not run
  (`reconciliation_runs`, upserted by the reconcile panel + CLI). Send emails the
  PDF as a Resend attachment (best-effort), records recipients, and freezes the
  report.
- **B5 — weekly digest.** Five trailing-7-day numbers (net sales, ad spend, MER,
  orders, AOV) + flags since the last digest (deduped, capped). Per-tenant
  schedule in the settings blob (`digest.enabled/defaultDay/days`);
  `sendWeeklyDigests` sends on each tenant's day. Dependency-free worker email
  helper. CLI `digest:send <tenant> <YYYY-MM-DD> [email]`.
- **B6 — WhatsApp block.** `buildWhatsAppSummary` — a four-line paste-ready block
  (name+period, headline, three numbers, top finding). A copy button on `/reports`.
- **B7 — trial + free first report.** `tenant_status` gained `trial` (excluded
  from MRR, included everywhere else). The report footer states the free period +
  price for a trial. Issues rule: a trial whose report was sent ≥ 14 days ago with
  no decision. Offboarding is one console action (`offboardTenant`: delete all
  data, revoke connections, mark churned; requires typing the slug). Convert is
  one click. **Not built (Part 2):** self-serve trial signup, prospect demo login,
  automated expiry emails.

---

## Part C — Marketing site (`apps/web`, Astro)

- **C1 — pages.** Home / What it does / The report / Pricing / Contact / Privacy /
  Terms + a new Free-report page. The hero **is the claim gap**, with the demo
  tenant's real August figures (Meta reports 195 conversions, the store recorded
  124 — 36% gap), said plainly to be demo data. Pricing shows **three tiers**
  (Advisory, Growth, Partner — **not Insight**), flat and based on ad spend, never
  % of revenue, with no invented numbers and an empty client-quote slot. No copy
  promises the four skipping rules. Design target: `docs/design/marketing-mockup.html`.
- **C2 — sample report.** `apps/web/public/sample-report.pdf` is generated from
  the demo tenant by the Part B pipeline (committed as a site asset via a
  `.gitignore` negation); `sample-report.png` is a full-page render embedded on
  The report page. Console screenshots were **not** captured — it needs an admin
  login (password entry), which the assistant does not do; the site leads with the
  real merchant-facing report instead.
- **C3 — intake.** `ticket_type` gained `free_report`; `/free-report` posts to the
  same public intake endpoint as the contact form and lands in the same inbox,
  filterable on its own type.
- **C4 — basics.** favicon.svg, robots.txt, hand-written sitemap.xml (no
  `@astrojs/sitemap` dependency), OG/Twitter meta + `og:image` = the sample
  report. No third-party analytics.

**Deploy is not done** (Part C runs locally). The Cloudflare Pages steps,
including the Phase 5 additions (`PUBLIC_ADMIN_URL`, the committed sample
assets), are in `docs/deploy.md`, gated on Rahul's Cloudflare account.

---

## Running the Phase 5 pieces

Worker CLIs (`pnpm --filter @grossline/worker <name> …`): `reports:build
<tenant> <YYYY-MM>`, `digest:send <tenant> <YYYY-MM-DD> [email]`. Reconciliation
(`reconcile` CLI or the console panel) now records a run so a report can be sent.
The marketing site: `pnpm --filter @grossline/web dev` (4321) / `… build`.

**Demo report, reproducible** (after the Phase 4 demo setup in `docs/handover.md`
§6, which computes metrics + findings for 2026-05…08):

```
DEMO=<demo tenant id>
pnpm --filter @grossline/worker reports:build $DEMO 2026-08   # build + snapshot
pnpm --filter @grossline/worker digest:send  $DEMO 2026-08-15 # dry-run digest
```

To send a report from the console it must first be reconciled (open the
Reconciliation panel for the month) and its findings approved (Findings page) —
both gates are enforced. To regenerate the site's sample assets after a metric
or definition change, re-run `reports:build` for the demo and re-render the
PDF/PNG into `apps/web/public` (the tmp-script flow used in B1/C2).

---

## Tests added

Core: `findings-family`, extended `findings-ranking` (families), `findings-rules`
(spend_headroom, scale_signal + updated healthy-account), `findings-commentary`
(growth variants + guard), `findings-recommendations` (growth outcomes). Worker
(DB-backed): `findings-family` (CHECK), `report-html`, `report-immutability`,
`report-send-gate`, `digest`, `whatsapp`, `offboard`, `ticket-free-report`. All
golden values hand-calculated. `pnpm verify` green on a clean clone.

---

## Known gaps Phase 7 inherits

See `docs/handover.md` §10. In short: the four dormant entity-level rules; no
scheduled worker jobs for report/digest; no production deploy target;
Meta/Google still on fixtures.
