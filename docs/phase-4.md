# Phase 4 — Findings engine

Goal: for any tenant and month, produce a small set of findings ranked by money at stake, each one specific enough to act on, with a written record of whether acting on it worked.

This is the part clients pay for. Everything before it was arithmetic.

---

## Principles

**Structured records first, prose last.** A finding is a row with numbers in it. Text is generated from the row, never the other way round. Get this backwards and you have a chatbot that waffles.

**Money impact is the sort key.** Not a severity label. An actual number. "This campaign spent $4,200 and produced 3 attributable orders" ranks above a 5% CTR decline because the arithmetic says so, not because someone tagged it high.

**Thresholds are per tenant.** A MER of 2.5 is healthy at 70% margin and fatal at 30%. Global defaults produce advice that is wrong for half your clients.

**The model never calculates.** It writes prose over numbers the metric layer already computed. It never sees raw data it could hallucinate from, and it never produces a figure that isn't already in the finding record.

**"Nothing needs changing" is a valid, valuable output.** A tool that manufactures three findings every month teaches clients to stop reading. One that occasionally says "spend is efficient, margins held, keep going" gets believed when it does raise something.

---

## Tasks

### 4.1 — Findings schema and state machine

```
findings {
  id, tenant_id, period, rule_id, severity,
  metric, current_value, comparison_value, delta,
  entity,              // campaign, product, discount code, channel
  entity_label,
  money_impact,        // integer minor units — the sort key
  evidence jsonb,      // the raw numbers behind it, for the UI and the PR reviewer
  status,              // new | recurring | resolved | dismissed
  first_seen_period, occurrence_count,
  draft_text, final_text, edited_at,
  created_at
}
```

State transitions, computed not hand-set:
- A finding matching one from last period by `rule_id` + `entity` becomes **recurring**, with `occurrence_count` incremented and `first_seen_period` carried forward.
- One that no longer triggers becomes **resolved**, and generates its own output — "last month we flagged X, you changed it, here is what happened."
- **Dismissed** is manual and sticky. When a client says "we bid on brand terms defensively, that's deliberate", it stops surfacing for that entity until the rule's underlying numbers change materially.

**Done when** a test runs three consecutive periods and proves a finding goes new → recurring → resolved with the correct counts, and that a dismissed finding stays suppressed.

### 4.2 — Per-tenant threshold calibration

At onboarding, compute each tenant's thresholds from their own 90 days plus their margin structure. Store them per tenant, editable in Settings.

Break-even MER comes from the actual contribution margin rate. CAC ceiling from their own historical variance, not a fixed percentage. Claim gap tolerance from what that account normally runs at.

**Done when** two tenants with different margin structures produce different thresholds from the same rule set, and a test proves a threshold change alters which findings fire.

### 4.3 — Rules library

| Rule | Trigger | Money impact |
|---|---|---|
| Below break-even MER | actual MER < break-even | (break-even − actual) × spend |
| Dead campaign | spend above threshold, zero attributed orders in 30d | full spend |
| Branded search share | branded keywords above threshold share of Google spend | branded spend |
| Search term waste | terms with cost, zero conversions | sum of that cost |
| Discount leakage | discount % of gross sales rising vs prior period | delta in absolute terms |
| Refund outlier | product refund rate above 2× store average and receiving spend | refunded value + spend |
| Payback broken | new-customer CAC > first-order contribution | CAC gap × new customers |
| Claim gap | platform-claimed vs UTM-attributed divergence beyond tolerance | flagged as measurement risk, no spend action |
| Spend pacing | projected month-end above budget threshold | overspend amount |

Every rule is a pure function: metrics and thresholds in, finding record or null out. Golden-file tested, values hand-calculated.

Rules that need data the tenant doesn't have — no cost data, no Google connection — return null with a reason, never a finding built on absent inputs.

**Done when** each rule has a golden test, and a test proves no rule fires on incomplete data.

### 4.4 — Ranking and suppression

Sort by `money_impact` descending. Suppress anything below the tenant's minimum impact threshold. Cap output at three per period.

Suppressed findings are recorded, not discarded — you want to know what was below the line.

**Done when** the demo tenant produces a ranked, capped set, and the suppressed ones are queryable.

### 4.5 — Findings review in the console

Your editorial step. A queue showing generated findings ranked by impact, with the evidence behind each one visible.

For each: read the draft, edit the text, approve, dismiss, or mark deliberate. Nothing reaches a client without passing through here.

Show state clearly — a recurring finding on its third month should look different from a new one, because it reads differently to the client too.

**Done when** you can review a month's findings for a tenant and end with an approved set you would be willing to send.

### 4.6 — Commentary layer

Two tiers.

**Rule templates** with slots, filled from the finding record. Deterministic, always correct, no model involved.

**Model-drafted narrative** on top, using the Anthropic API from the worker. It receives the computed findings and nothing else — no raw tables, no ability to compute. Its output populates `draft_text`. You edit into `final_text`.

Every finding follows the same four-part shape:
- What happened, with the numbers
- What is at stake, as a figure
- What to do, specifically
- What we will check next month, naming the metric that proves it right or wrong

That last part is what makes 4.7 possible.

**Done when** a draft reads like something you would send, and a test proves the model output contains no figure absent from the finding record.

### 4.7 — Recommendation tracking

Every approved finding carries its check-metric forward. Next period, the engine evaluates whether the recommendation was actioned and what happened.

This produces the closing-the-loop output: *"Last month we flagged $4,100 in PMax spend with 3 attributable orders. You cut it 70%. Orders held, cost per order fell from $121 to $84."*

A table in the console: recommendation, month, actioned yes/no, result, status.

**Done when** the demo tenant shows a multi-month recommendation history with at least one resolved case carrying a real measured result.

### 4.8 — Findings as issues

Findings awaiting review surface on the Issues page using the types already declared in Phase 3. A month with generated findings and no review is a blocking issue — it stops a report going out.

**Done when** an unreviewed findings set appears on Issues and clears when approved.

---

## Exit criteria

- Three consecutive periods produce correct new / recurring / resolved transitions
- Every rule golden-tested with hand-calculated values
- No rule fires on incomplete data
- Thresholds are per tenant and demonstrably change what fires
- A reviewed, approved set exists for the demo tenant that you would send
- Model output contains no number absent from the finding record
- Recommendation tracking shows a resolved case with a measured result
- "Nothing needs changing this month" is reachable and tested
- `pnpm verify` green

## Not in this phase

The report itself — PDF, email, delivery — is Phase 5. This phase produces approved findings; Phase 5 wraps them in a document.
