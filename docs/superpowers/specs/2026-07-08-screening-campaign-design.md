# Screening campaign: replace autoharness (Phase 2)

**Date:** 2026-07-08
**Branch:** `worktree-manage-agents`
**Status:** design approved, not implemented
**Independent of:** Phase 1 (`2026-07-08-expert-context-injection-design.md`).
They share only the word "agent". Ship either first.

## What autoharness is

An external Python tool (`pipx install autoharness`) driving a bounded
self-improvement loop over `src/lib/`:

1. Ask a generator for **one** edit plan.
2. Apply it, but only inside `editable_surfaces: [src/lib]`, and never inside
   `protected_surfaces` (tests, `vitest.config.ts`, `package.json`,
   `tsconfig.json`, `supabase/migrations/**`, `.github/**`, `scripts/**`).
3. Screen with `bun run typecheck && bun run test` (`benchmarks/screening.yaml`).
4. Keep it if it wins. Ten iterations.

`scripts/autoharness-claude-shim.py` (182 lines) exists for exactly one reason:
autoharness's built-in `claude_code` generator refuses OAuth and demands
`ANTHROPIC_API_KEY`. The shim is an adapter for driving Claude **from** Python.

## Why replace it

- The shim's entire reason to exist disappears when the loop lives inside the
  repo's own toolchain. Invoking `claude --print` directly works with OAuth —
  the shim proves it.
- `autoharness.yaml` and `benchmarks/screening.yaml` both hardcode
  `/Users/tedslesinski/Repos/mgr`, so the campaign has been broken from every
  worktree since it was written. Last substantive commits: #251 (2026-05-03),
  #331.
- It is the last real Python dependency in the agent path.

The campaign runner, the config format, and the OAuth adapter all collapse into
the script that was hiding inside them.

## Why not the `Workflow` tool

Considered and rejected. `Workflow` scripts are plain JavaScript in a sandbox
with **no filesystem or Node access**. They cannot run `git diff --name-only`,
cannot apply an edit plan, cannot shell out to `bun run test`. Every one of those
would have to be delegated to an agent, which puts the bounds check back inside
an LLM's discretion — destroying the one property worth preserving. The
enforcement function would also be untestable, because a workflow script is not
an importable module.

**The anti-gaming property lives in the applier, not the generator.** The shim
passes `--disallowedTools Edit Write`; the generator never holds a file handle.
It emits JSON operations and autoharness filters them by path. An agent told
"make typecheck and vitest pass" that *can* edit tests will edit tests. Any
replacement must keep enforcement in deterministic code.

## Design

One file: **`scripts/screening.ts`**, run by `bun`. Roughly 120 lines.

### Stages

**Baseline.** Run `bun run typecheck && bun run test` three times on unmodified
`HEAD`, collecting failing test names. If the union is non-empty, abort and print
the list. This is `autoharness doctor`'s flake check. Dropping it lets the loop
manufacture wins against a flaky suite — a candidate "fixes" a test that was
going to pass on retry anyway.

**Propose.** Shell out to:

```
claude --print --output-format json --json-schema <schema> \
  --permission-mode bypassPermissions \
  --disallowedTools "Edit Write NotebookEdit MultiEdit" \
  --append-system-prompt <non-interactive override> \
  <prompt>
```

Returns `{"structured_output":{"summary":"…","operations":[…]}}`. Operation types:
`search_replace`, `write_file`, `delete_file`, `move_path`, `unified_diff`. Paths
relative to repo root. Preserve the shim's `--disallowedTools` — the generator
proposes, it does not apply.

**Apply.** Into a scratch `git worktree`, never the working tree.

**Bound.** `boundsCheck(paths: string[]): {ok: boolean; rejected: string[]}` — a
pure function. Reject if any path falls outside `src/lib/**` **or** matches a
protected glob. **Protected beats editable**, which is the case that bites:
`src/lib/__tests__/foo.test.ts` is inside the editable surface and must still be
rejected. Also reject an empty operation list (a no-op candidate is not a win).

**Screen.** Surviving candidates run `bun run typecheck && bun run test` in their
own worktree. Non-zero exit drops the candidate.

**Report.** Print surviving diffs. **Nothing is committed and nothing is applied
to the working tree.** The human applies.

Loop up to 10 iterations, matching `campaign.max_iterations`.

### Configuration

Inline constants in `scripts/screening.ts`. No YAML. The two existing config
files hold nine values between them, all of which are either hardcoded absolute
paths (broken) or one-line shell commands.

`EDITABLE = ["src/lib/**"]` and `PROTECTED` carried over verbatim from
`autoharness.yaml`'s `protected_surfaces`.

## Verification

`boundsCheck` is money-path logic: a mistake here lets an agent edit the
benchmark it is being scored against. It gets a vitest unit test at
`src/__tests__/screening-bounds.test.ts`, so `bun run test` and
`bun run typecheck` both cover it.

Cases:

1. `src/lib/format.ts` → allowed.
2. `src/lib/__tests__/format.test.ts` → **rejected** (protected beats editable).
3. `vitest.config.ts` → rejected.
4. `package.json` → rejected.
5. `supabase/migrations/00223_debit_bin_inventory.sql` → rejected.
6. `src/components/ui/button.tsx` → rejected (outside editable surface).
7. `[]` → rejected (no-op candidate).
8. Mixed list with one bad path → rejected, and `rejected` names that path.

To keep `boundsCheck` importable by the test, `scripts/screening.ts` exports it
and guards its entry point with `import.meta.main`.

## Deletions

| Path | Reason |
|---|---|
| `scripts/autoharness-claude-shim.py` | 182 lines of OAuth adapter, obsolete |
| `autoharness.yaml` | hardcoded absolute path; nine values move inline |
| `benchmarks/screening.yaml` | hardcoded absolute path; one shell command |
| `docs/agents/autoharness.md` | documents the deleted tool |
| `AGENTS.md` row (line 57) | points at the deleted doc |
| `pipx install autoharness` | external toolchain dependency |

`PROGRESS.md` line 161 is history and stays.

## Out of scope

`scripts/migration/{migrate_catalog_items,migrate_orders,migration_utils}.py`
are one-shot MongoDB→Postgres importers from #161 (January). `migration_utils.py`
imports `bson`, an undeclared pip dependency. The data landed long ago
(`00161_supplier_catalog_inventory_items.sql` is live). Deleting them is safe —
git preserves them — and would bring the repo to zero Python files, but it is
unrelated to agent tooling and needs the owner's explicit confirmation.

## Non-goals

- No `PreToolUse` deny-hook. An earlier draft proposed one to enforce
  `protected_surfaces` and claimed it shared infrastructure with Phase 1. That
  was wrong: enforcement belongs in the applier, and `--disallowedTools` already
  keeps the generator away from file handles. The two phases share nothing.
- No `Workflow` orchestration. See above.
- No auto-apply, no auto-commit. Winners are reported; a human lands them.
- No campaign state store, no `events.jsonl`, no `autoharness report`. Print to
  stdout. Add persistence when a campaign actually needs to resume.

## Success criterion

`bun scripts/screening.ts` runs a 10-iteration campaign over `src/lib/` from any
worktree, rejects any candidate touching a protected path, and reports only
diffs that pass typecheck and the full vitest suite — with no Python installed.
