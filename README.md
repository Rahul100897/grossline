# Grossline

Revenue and ad spend reporting for Shopify DTC brands. Pulls Shopify orders, Google Ads cost and Meta Ads spend across many merchants, computes blended commercial metrics, and produces a monthly report.

**Private repository.** It contains merchant business data structures and credential handling. Do not make it public, and do not commit real merchant data, even as test fixtures, without anonymising it first.

## Start here

1. `CLAUDE.md` — conventions and non-negotiables. Read before writing code.
2. `docs/metrics.md` — every metric definition. The source of truth.
3. `docs/phase-0.md` — what we are building right now.

## Local setup

```bash
pnpm install
cp .env.example .env      # fill in what you need
docker compose up -d      # postgres + redis
pnpm db:migrate
pnpm seed:admin           # create the admin login from .env (prints TOTP enrolment once)
pnpm seed:demo            # demo tenant with sample data (arrives with Phase 1)
pnpm dev
```

Admin console runs at `localhost:3000`. Marketing site at `localhost:4321`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | admin + worker |
| `pnpm verify` | typecheck, lint, test, migration check — same as CI |
| `pnpm db:migrate` | apply migrations |
| `pnpm db:studio` | inspect the database |
| `pnpm seed:demo` | load the demo tenant |
| `pnpm worker:sync <tenantId>` | run one tenant's sync manually |

Run `pnpm verify` before every push. If it fails locally it will fail in CI.

## Branching

- `main` is always deployable and protected. No direct pushes.
- Branch per task: `phase0/tenant-scoping`, `phase1/shopify-connector`, `fix/meta-restatement-window`.
- One task per PR. If a PR touches more than one task, split it.
- Squash merge. The PR title becomes the commit message.

Commit messages: `type(scope): summary` — `feat(db): tenant-scoped query helpers`, `fix(meta): re-pull 28-day restatement window`.

## Reviews

Every PR needs one approval. The PR template checklist is not decoration — the tenant-scoping and money-handling items are the two that cause silent data corruption, and neither shows up in tests unless someone looks.

## Working with Claude Code

Follow the loop in `CLAUDE.md`: review, gap doc, backlog, confirm, implement. Gap docs go in `docs/scratch/`, which is gitignored. Anything worth keeping from a gap doc moves into `docs/` properly and gets committed.

Start a fresh session per task group. Long sessions on a growing codebase lose context and produce inconsistent decisions.

## Security

- No secrets in the repo. `.env` is ignored. `gitleaks` runs on every PR.
- Platform tokens are encrypted at rest in the `credentials` table, never in environment variables beyond the master key.
- All platform access is read-only. Nothing is ever written back to a merchant's store or ad accounts.
- Test fixtures from real accounts must have store names, order IDs, customer names and email addresses replaced before committing.

## Deployment

Not yet. Phase 0 is local only, except the marketing one-pager on Cloudflare Pages.
