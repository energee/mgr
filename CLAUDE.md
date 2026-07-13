# mgr — Claude Code entry point

All project instructions live in `AGENTS.md`, shared with Codex and any other harness. Do not add rules here — add them there.

@AGENTS.md

## Claude Code specifics

- Expert agents (`.claude/agents/*.md`, table in `AGENTS.md`): dispatch them as subagents rather than reading them inline. When work fans out across independent files/tests, dispatch them in parallel.
- Search: `mgrep` to locate code by meaning; the literal `Grep`/`rg` tools only for exact-string ref-counting.
- Minor choices (naming, defaults, equivalent approaches): pick one and note it — don't ask. Ask only for scope changes or destructive actions.
- When work fans out across independent files/tests, dispatch the expert agents in parallel rather than iterating serially.

## Conventions
- Commit prefixes feat/fix/chore/docs/refactor/perf/ci; NEVER Co-Authored-By lines
- Query keys only via `src/lib/query-keys.ts`
- One entity = one directory `src/entities/<name>/` (`core.ts` + `presentation.tsx` + `index.ts`), registered in `src/entities/index.ts`
- knip/depcheck flag false positives (entity registry, `z.infer`) — verify before deleting
- Search: `mgrep` to locate code by meaning; literal `grep`/`rg` only for exact-string ref-counting
- Progress log: ADD `docs/progress/YYYY-MM-DD-slug.md` (one file per session entry, the `- **date (title).** …` bullet verbatim); PROGRESS.md is GENERATED on main by CI — never edit or commit PROGRESS.md on a branch
