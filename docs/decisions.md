# Decisions log

Decisions made during autonomous implementation that were not fully specified
in CLAUDE.md or the phase docs. Each entry says what was decided and why the
simplest option was chosen. Anything here can be revisited.

## 2026-09-05 — Repo bootstrap

- **Git state.** `github.com/Rahul100897/grossline` had zero commits and zero
  refs (verified with `git ls-remote`). "Preserve remote history and rebase
  onto it" was therefore a no-op: the local directory was `git init`-ed on
  `main` with `origin` pointing at the GitHub repo, and history starts here.
  Nothing was force-pushed or discarded.
- **`.env.example` values blanked.** All previously non-empty values were
  local-dev defaults or API version strings, not credentials
  (`NODE_ENV=development`, localhost `DATABASE_URL`/`REDIS_URL`,
  `MASTER_KEY_VERSION=1`, `SHOPIFY_API_VERSION=2026-07`,
  `META_API_VERSION=v21.0`). They were moved into comments so local setup
  stays documented. **No real credentials were found; nothing needs rotating.**
- **`.gitignore` merge.** Remote had no `.gitignore` (empty repo), so the
  local version stands. It already covered `.env`, `.DS_Store`,
  `node_modules/`, `docs/scratch/`. Added `.claude/settings.local.json`
  (session-local Claude Code permission state, not shared config).
- **Scratch clone.** `~/Documents/grossline-repo` (created in an earlier
  session as a staging copy) is now redundant — every file in it exists in
  this repo. It was left in place because deleting directories was out of
  scope for autonomous mode; safe to delete manually.
- **Direct pushes to `main`.** README says `main` is protected with PR-only
  merges. Branch protection is a GitHub setting that does not exist yet on a
  fresh repo, and the instruction for this bootstrap phase was one commit per
  task pushed after each. Phase 0 commits therefore go directly to `main`;
  turn on branch protection before Phase 1.
