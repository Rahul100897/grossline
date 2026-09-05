# Google Ads fixtures

**Every file prefixed `synthetic-` is hand-authored from Google Ads API docs
(v18, REST searchStream), not recorded from a real account.** Replace each
with a real recorded response (anonymised) once the developer token has access
and an account is linked. Tracked in `docs/phase-1-handover.md`.

All customer ids, campaign ids and names are fictional.

| File | What it covers |
|---|---|
| `synthetic-searchstream-campaigns.json` | Daily campaign rows (2 campaigns × 3 days) incl. a zero-cost day; cost_micros/conversions as strings |
| `synthetic-customer-info.json` | customer resource: currency_code, time_zone, descriptive_name |
| `synthetic-unlinked-error.json` | 403 body for a client account not linked to the MCC (USER_PERMISSION_DENIED) |
