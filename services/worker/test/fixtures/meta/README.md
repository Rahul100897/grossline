# Meta fixtures

**Every file prefixed `synthetic-` is hand-authored from Meta's published
Marketing API docs (v21.0), not recorded from a real ad account.** Replace
each with a real recorded response (anonymised) once an ad account is
connected, keeping the same edge cases. Tracked in `docs/phase-1-handover.md`.

All account IDs, campaign IDs and names are fictional.

| File | What it covers |
|---|---|
| `synthetic-account-info.json` | Ad account with currency, timezone_name, attribution_spec, account_status |
| `synthetic-insights-campaign-page1.json` | Daily campaign insights, page 1 (incl. a zero-spend day, actions/action_values/purchase_roas, attribution_setting) |
| `synthetic-insights-campaign-page2.json` | Page 2, no further paging |
| `synthetic-insights-account.json` | Account-level daily rows incl. a zero-spend day |
| `synthetic-insights-campaign-restated.json` | The same days re-served with restated spend (Meta's 28-day restatement) |
