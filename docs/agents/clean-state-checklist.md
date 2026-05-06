# Clean-state checklist

End-of-session verification (Lecture 12). Every item must be true before the
session is "complete". Run `bash scripts/cleanup-session.sh` to apply
idempotent cleanup ops, then verify each box.

## Required (every session)

- [ ] `make check` passes (lint + typecheck + vitest + build)
- [ ] `make dev` still starts the server (no broken startup path)
- [ ] No `console.log`, `debugger`, or session-only `TODO` markers remain in changed files
- [ ] `feature_list.json` updated — every feature touched has its `state` field set correctly (and `evidence` populated for `passing` entries)
- [ ] `PROGRESS.md` updated — current commit, completed list, next steps
- [ ] All changes committed AND pushed (`git status` shows "up to date with origin")

## Required (cross-component changes)

- [ ] `make check-all` passes (adds Playwright E2E)

## Required (schema changes)

- [ ] Migration applied successfully against local Supabase
- [ ] `bun run db:generate:local` ran cleanly; `src/types/supabase.ts` reflects the new shape
- [ ] `_schema_registry` entry added for any new table
- [ ] [`docs/data-model/`](../data-model/) doc updated for the affected domain

## Periodic (recommend weekly)

- [ ] Skim `DECISIONS.md` — any decisions made informally that should be logged?
- [ ] Skim `PROGRESS.md` — any "Blocked" items that have moved or rotted?

## What "clean state" means

A session is in a clean state if a fresh agent can:

1. **Start** — `make setup && make dev` works.
2. **Test** — `make check` is green.
3. **See progress** — `PROGRESS.md` is up to date.
4. **Pick up next** — the "Next steps" list in `PROGRESS.md` is concrete and ordered.

If any of those four conditions are false, the session is **not** complete.
