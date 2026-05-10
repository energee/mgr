# autoharness

Automated refactor screening for `src/lib`. Claude proposes one edit per
iteration, autoharness applies it in a sandboxed copy, runs `typecheck +
vitest`, and keeps only the candidates that stay green.

Use it when you want a batch of low-risk mechanical cleanups (dead code,
duplication, no-op aliases) without writing them yourself. Do not use it for
behavioral changes, new features, or anything where tests don't cover the
contract.

## Prerequisites

- `pipx install autoharness` (one time). Verify with `autoharness --version`.
- `claude` CLI on `PATH` (the shim shells out to it). Logged in to a
  subscription that allows `--print` mode.

## Running a campaign

```bash
autoharness doctor              # validate config + measure flake/runtime
autoharness run-benchmark       # one baseline run of the benchmark
autoharness optimize            # default 10-iteration campaign
autoharness report              # human-readable summary
```

`optimize` is the only long command (~10–25 min per iteration; the per-iter
cost is dominated by Claude, not the benchmark). Run it in the background
and check `.autoharness/workspaces/mgr/events.jsonl` for live progress, or
just wait for the final summary.

## Reviewing proposals

Each iteration's proposal is logged by the shim to
`/tmp/claude/autoharness-shim-logs/shim_output_<pid>_<candidate>.json`. Each
log is the structured edit-plan Claude emitted: `summary`, `hypothesis`,
`intervention_class`, and a list of `operations` (each with `type`,
`path`, and `search`/`replace` or `content`).

Read the summaries first to triage; pull the full diffs for anything that
looks worth applying. Autoharness's own `report` command shows aggregate
stats but not the proposals.

## Applying winners

Autoharness reverts every iteration's edits by design (auto-promote is off),
so winning proposals must be cherry-picked by hand. A `local_command`-style
script that loops over the chosen candidate JSONs and applies each
`search_replace` op to the listed `path` is the simplest approach — see the
git log for `refactor/autoharness-src-lib-cleanup` for an example commit.

After applying, run the full gate before committing:

```bash
bun run typecheck && bun run test && bun run lint
```

## Editable surfaces

`autoharness.yaml` constrains what the optimizer can touch:

- **Editable**: `src/lib` only.
- **Protected**: all tests (`src/**/__tests__/**`, `*.test.{ts,tsx}`,
  `__mocks__`, `src/test-utils`), `vitest.config.ts`, `playwright.config.ts`,
  `e2e/**`, all toolchain (`package.json`, `tsconfig.json`, `next.config.ts`,
  `Makefile`, etc.), `supabase/migrations/**`, `.github/**`, `scripts/**`,
  `feature_list.json`, all autoharness config itself.

The protection list is anti-gaming: with tests colocated under `src/` and
the screening gate just being `vitest`, an unconstrained optimizer can
"improve" the benchmark by deleting failing tests. Don't widen the editable
surface without also tightening protections.

## Local autoharness patches (READ THIS)

`pipx`'s install of autoharness has two upstream bugs that prevent the
campaign loop from working out of the box. We have two local patches to
`campaign_handlers.py` inside the pipx venv:

1. **`staging_mode="auto"` → `staging_mode="off"`** (line ~1867). The
   default copies the whole repo into `.autoharness/workspaces/.../staging/
   target` on every iteration. Because the staging dir lives *inside* the
   repo, the copy recurses into itself and blows up to 20+ GB before any
   actual work happens. `"off"` applies edits in place; autoharness reverts
   them via its existing restore machinery.

2. **Missing `record = None`** before the `if exit_code != 0:` branch
   (around line 1880). Without it, any execution failure crashes the
   campaign with `UnboundLocalError`.

Both live at:
`~/.local/pipx/venvs/autoharness/lib/python3.14/site-packages/autoharness/campaign_handlers.py`

**`pipx upgrade autoharness` reverts both.** After upgrade, re-apply or the
loop breaks. If you see a `UnboundLocalError` or a runaway staging copy,
check these first.

## OAuth shim

`scripts/autoharness-claude-shim.py` exists because the built-in
`claude_code` generator hardcodes `--bare`, which refuses keychain auth
and demands `ANTHROPIC_API_KEY`. The shim swaps that for a plain
`claude --print --json-schema ...` invocation that uses the OAuth keychain
(works with Max subscription), then unwraps the `structured_output` field
from the `--output-format json` envelope.

The shim disallows `Edit Write NotebookEdit MultiEdit` tools so Claude can
inspect the repo but cannot apply changes outside the structured output —
autoharness owns the edit application.

## Known caveats

- **Iteration time grows under load.** Early iterations finish in ~10 min;
  later iterations (especially #7+) can take 20–35 min as Max subscription
  rate-limit smoothing kicks in. Plan for ~2 h for a full 10-iter campaign.
- **Preflight runs `python -m compileall .`.** Walks `node_modules`, takes
  ~40 s the first time; cached after.
- **No auto-promotion configured.** Every iteration's edits are reverted;
  manual cherry-pick is the workflow.
- **Workspace state is gitignored.** `.autoharness/`, `autoharness.project.md`,
  `autoharness.claude.md`, `autoharness.onboarding.json`. Regenerate the
  last three with `autoharness guide` if needed.
