# Phase 5 — Growth findings, report delivery, marketing site

Three parts, run in order. Part A extends the findings engine while it is still fresh. Part B is the deliverable clients actually receive. Part C is the site that sells it.

**This supersedes `docs/phase-4-5.md`.** Part A is that spec, unchanged in substance.

**Phase marker on completion:** Phase 7 — Operations hardening.

---

# Part A — Growth findings

Findings that point at money available, not only money being lost.

Deliberately small. Two rules, one schema change, one framing discipline.

## The problem this fixes

Every rule in Phase 4's library is defensive. None answer the question a client asks immediately after a waste finding: _where should the freed budget go instead?_

## Principles

**Waste is provable. Growth is a hypothesis.** Never presented as the same kind of claim.

**Growth findings are bounded tests, never instructions.** Efficiency decays as spend rises. A campaign at 6.8× will not hold 6.8× on triple the budget, and the finding text must say so.

**A report is never only growth findings.** If no waste finding fires, growth findings do not fill the space. "Nothing needs changing this month" outranks a manufactured opportunity.

**Same four-part shape:** what happened with the numbers, what is at stake, what to do, what we will check next month. For growth findings the check metric does the heavy lifting — it turns a guess into a measurement.

## A1 — Schema: opportunity_value and family

Add `opportunity_value` to `findings` as a sibling of `money_impact`, integer minor units, nullable. A finding carries one or the other, never both.

Add a `family` discriminator: `waste | growth | measurement`. Claim gap becomes `measurement`, which is what its existing exempt-from-suppression behaviour already implied.

**Done when** the migration applies with RLS intact, existing findings backfill to `waste` (claim gap to `measurement`), and a test proves a finding cannot carry both values.

## A2 — Ranking across families

`rankAndSuppress` sorts across both value fields in one list:

- Waste ranks above growth at equal value. A provable saving beats a hypothetical gain.
- Cap stays at three total.
- **At most one growth finding per report.**
- If no waste finding fires, growth findings are suppressed too and the output is "nothing needs changing" — unless a measurement finding applies.
- Suppressed growth findings recorded and queryable, as before.

**Done when** golden tests cover waste-only, growth-only (suppressed), mixed with correct ordering, and the one-growth cap.

## A3 — Rule: spend headroom

**Trigger:** actual MER sits comfortably above break-even MER with a margin of safety, and spend is not already pacing over target.

**Opportunity value:** the additional monthly spend deployable while still clearing break-even at the current margin structure. Both inputs already exist in the metric layer.

**Mandatory framing:** the figure is arithmetic at _today's_ efficiency, and efficiency falls as spend rises. The recommendation is a bounded increase for a defined period, with blended MER and total orders as check metrics.

**Skips when:** cost data incomplete, MER below or near break-even, or spend already pacing over target. Returns skipped with a reason.

**Done when** a golden test covers a fire case, an at-break-even case, and an incomplete-cost skip.

## A4 — Rule: scale signal

**Trigger:** a campaign whose ROAS is materially above the account average while holding a small share of total platform spend.

**Opportunity value: conservative.** Not "this campaign's ROAS applied to more budget" — that is the exact mistake the framing principle exists to prevent, and it is wrong in the direction that loses a client money. Use the revenue difference between that campaign's efficiency and the account average, applied to a bounded share shift, and state in the text that it is an estimate contingent on efficiency holding.

**Platform-reported ROAS is the only campaign-level efficiency figure available.** It stays labelled platform-reported in the finding text and is never presented as blended. The never-blend rule applies unchanged.

**Skips when:** no campaign-level data, too few campaigns, or no clear outperformer.

**Done when** a golden test covers a fire case, a no-outperformer case, and a missing-data skip.

## A5 — Review console and commentary

The review card shows family clearly. A growth finding must not look like a waste finding at a glance — it reads differently to the client and carries different confidence.

Commentary gains growth variants using the same deterministic four-part structure. **The figure guard is unchanged:** the model may polish prose and may never introduce a number.

**Done when** the demo review queue shows a growth finding, visually distinct, with a draft you would send.

## A6 — Recommendation tracking for growth

The existing classifier handles actioned / improving / worsened / pending.

One addition: a growth recommendation that was actioned and did _not_ hold must be recorded as a genuine outcome, not hidden. "We suggested a 30% increase, you tried it, MER fell from 3.2 to 2.6, we would revert" is a valuable report line and the whole reason growth findings are framed as tests.

**Done when** the demo shows a growth recommendation carried forward with a measured result.

## Not in Part A

Best entry product by cohort LTV, winback opportunity, AOV threshold gap, underweighted channel. All computable, none built until a client asks. The schema and ranking work here makes each a small addition later.

---

# Part B — Report delivery

The monthly artifact a client receives. Everything before this was infrastructure.

## Principles

**One template, two outputs.** The HTML report renders to PDF via Playwright and to a web preview in the console. Never two layouts — they drift within a month.

**Nothing goes out unreviewed.** A report cannot be sent unless its findings are approved. Phase 4.8 already makes unreviewed findings a blocking issue; this enforces it at the send step.

**Nothing goes out unreconciled.** Reconciliation for the period must have been run. A variance you can explain belongs in the report; a variance you never looked for is how trust dies.

**Honesty markers travel with the report**, not just the console: reporting currency, timezone, last synced, last reconciled, provisional-day note, cost completeness and provenance.

## B1 — Report template

HTML, one file, rendering to both PDF and web preview. Per-client branding: name, logo, period.

**Fixed section order, every report, every client:**

1. **Headline** — one sentence stating whether the month worked, with the contribution figure and the direction of travel.
2. **Blended efficiency** — MER against break-even and target, blended CAC against first-order contribution.
3. **Margin** — the waterfall from gross sales to contribution, with cost completeness stated.
4. **Channel and claim gap** — spend by platform, platform-claimed against store-recorded, the divergence shown plainly and labelled as measurement rather than correction.
5. **What changed** — month over month and year over year on the headline metrics, absent where history does not exist.
6. **Findings** — up to three, in the four-part shape, ranked as Part A specifies.
7. **What we will check next month** — the check metrics from this month's findings, plus outcomes of last month's.

Consistency is the product. A client should know where to look without reading.

**Done when** the demo tenant renders a complete report in both outputs with identical content.

## B2 — PDF rendering

Reuse the Playwright plumbing from task 3.6. Print CSS, page breaks that never orphan a table header, embedded fonts, consistent margins.

The support ticket in the Phase 3 demo data was literally about a table splitting across pages with an orphaned header. Fix that class of problem here.

**Done when** a multi-page report PDF has no orphaned headers or split tables, and renders identically on a second run.

## B3 — Report build pipeline

A `reports` table: tenant, period, status (`draft | approved | sent`), built_at, sent_at, recipients, pdf path, and a snapshot of the metric values and findings as rendered.

**The snapshot matters.** A report sent in September must still show September's numbers in December, even if a definition changed or costs were re-uploaded since. Store what was sent, not a live query.

Build is triggered from the console or by the nightly job after metrics compute.

**Done when** a report built in the past renders identically after a definition change and a cost re-upload.

## B4 — Console: build, preview, send, archive

Extend the existing Reports surface. Per tenant and period: build, preview in browser, download PDF, send, and an archive with sent status and recipients.

Send is blocked with a clear reason when findings are unapproved or reconciliation has not run for the period.

**Done when** you can run a full cycle — build, read, send, archive — in the browser, and the send gate provably blocks on both conditions.

## B5 — Weekly digest

Five numbers plus anything flagged since the last digest. Email, plain, no attachment. Sent on a configurable day.

Monthly reports are always slightly too late. This is the thing that catches a spend problem in days.

**Done when** the demo tenant produces a digest email you would send, and the send respects the per-tenant schedule.

## B6 — WhatsApp summary block

Plain text, ready to paste, short enough for a phone. Headline, three numbers, the top finding in one line.

Not an integration. A copy button in the console. Founders live on WhatsApp and this is how a report actually gets read on the day it lands.

**Done when** the console offers a copyable block for any built report.

## B7 — Trial status and the free first report

**Missing from the entire scope of work until now, and it is the primary sales mechanism.**

The free first report is not a demo of software. It is the service delivered once at no charge — which is why it converts, and why it cannot be automated without becoming worse.

- Tenant status gains `trial`. Excluded from MRR and billing; included in everything else, so a trial tenant's broken sync still appears on Issues.
- Report footer states which period is free and what the price is afterwards.
- An Issues rule: a trial where the report has been sent and no decision has been recorded after fourteen days.
- Offboarding path: connection revoked, data deleted, on a single action.

**Not built:** self-serve trial signup, a prospect demo login, automated expiry emails. All Part 2. At your client count each of those replaces a conversation you should be having.

**Done when** a trial tenant can be created, receive a report, and be either converted or offboarded, entirely from the console.

## Known limitation to respect in the report

Four Phase 4 rules — dead campaign, branded search share, search term waste, refund outlier — are built and tested but skip on real data, because the metric layer does not yet provide per-campaign attribution, keyword-level data, or per-product refund rates.

So a real merchant today gets findings from five rules, not nine. **The report must not imply otherwise**, and no marketing copy in Part C may promise those findings. Closing those metric gaps is Phase 7 or later.

---

# Part C — Marketing site

The full site. The one-pager from task 0.7 becomes the home page.

**Design reference:** `docs/design/marketing-mockup.html`. Commit it if it is not already. It is a visual target, not markup to copy.

## Principles

**No invented proof.** No fake testimonials, no logo wall, no "trusted by" claim. Where a client quote would go, leave the slot empty until a real one exists. Nothing on this site may be untrue, because the product is honesty about numbers.

**Screenshots come from the demo tenant**, which is realistic seeded data, and the site says so where it matters. Not a real merchant's numbers.

**The hero is the claim gap.** Meta's number beside the store's number. It is the only thing you show that no competitor does, and it explains the product faster than any headline. Use the demo tenant's real figures.

## C1 — Pages

Home, What it does, The report, Pricing, Contact, Privacy, Terms.

Pricing shows Advisory, Growth, Partner — **not Insight**. That tier requires the merchant portal and self-serve billing, both Part 2. Advertising a plan you cannot deliver means turning people away after they have said yes.

State plainly that pricing is flat and based on ad spend, never a percentage of revenue. That is the direct contrast with every competitor and the thing their current tool annoys them about.

## C2 — Screenshots and the sample report

Real screenshots from the console and the merchant-facing views, taken against the demo tenant.

A downloadable sample report PDF, generated from the demo tenant by the Part B pipeline. This is the single best asset on the site — a prospect who reads a real report understands the product completely.

## C3 — Contact and intake

The support form from task 3.7 already exists and writes to `tickets`. Wire the contact page to it. Add a "request a free first report" path that lands in the same inbox with its own type.

## C4 — Basics

Meta and OG tags, sitemap, robots, favicon. Fast, static, no CMS. No third-party analytics that would sit awkwardly beside a privacy-first pitch — if analytics are wanted, a privacy-preserving option only.

**Done when** the site builds, deploys, and every page reads true with no placeholder text.

---

# Exit criteria

**Part A**

- `opportunity_value` and `family` in the schema, mutually exclusive with `money_impact`, existing rows backfilled
- Ranking golden-tested across families, one-growth-maximum enforced
- Both rules golden-tested with hand-calculated values including skips
- Growth findings suppressed when no waste finding fires
- Review card distinguishes family
- Figure guard unchanged and enforced

**Part B**

- One template renders identically to PDF and web
- A report built in the past is immune to later definition and cost changes
- Send blocked on unapproved findings and on missing reconciliation
- Full cycle runnable in the browser: build, preview, send, archive
- Weekly digest and WhatsApp block both produce output you would send
- A trial tenant can be created, served and offboarded from the console
- Multi-page PDF has no orphaned headers or split tables

**Part C**

- All pages live, no placeholder text, no invented proof
- Sample report PDF downloadable, generated by the real pipeline
- Contact and free-report intake both reach the tickets inbox
- Pricing shows three tiers, not four

**All parts**

- `pnpm verify` green on a clean clone
- Phase marker reads "Phase 7 — Operations hardening"
