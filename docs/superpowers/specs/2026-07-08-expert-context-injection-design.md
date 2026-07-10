# Expert context injection (Phase 1)

**Date:** 2026-07-08
**Branch:** `worktree-manage-agents`
**Status:** design approved, not implemented
**Supersedes an assumption in:** `2026-07-05-expert-agent-team-design.md`

## Problem

The repo has seven expert agents in `.claude/agents/`. Their value is not
"specialization" in the abstract — it is accumulated failure knowledge. From
`ui-systems-expert.md`: *always import `zodResolver` from `@/lib/form-resolver`,
never from `@hookform/resolvers/zod`*; *helper functions must be declared before
first use (Turbopack HMR hoisting hazard)*; *a prior campaign to generalize
`domain/` into `universal/` was reverse-engineered as not viable*. None of the 60
ECC plugin agents contain a single fact of that kind about this codebase.

The agent-team design assumed these files "are auto-invoked by future sessions"
(`2026-07-05-expert-agent-team-design.md`, line 19). They are not. **There is no
autoloader.** A subagent runs only when the `Agent` tool is called with its
`subagent_type`. "MUST BE USED" in a description is a hint to the model, not a
trigger the harness fires. Nothing in this repo enforces the `CLAUDE.md` table
— the only repo-level hook registered on this branch (a `Stop` hook running
`scripts/check-progress-drift.sh` via `.claude/settings.json`) checks progress
notes, not expert routing.

Four symptoms follow, all from that one root cause:

1. **Agents get skipped.** The `CLAUDE.md` expert table is advisory and is
   honored inconsistently.
2. **Unowned regions produce bad code.** `src/hooks/` (25 files),
   `src/contexts/` (11), the chat/AI surface (~10), and `src/lib/` top-level (36)
   have no expert holding their gotchas. `CLAUDE.md` defers chat to an
   `ai-features-expert` that does not exist.
3. **Rework arrives late.** When an expert *is* consulted it is usually at review
   time, after the code is written.
4. **Token burn.** `ui-systems-expert.md` is ~2,000 tokens. A subagent spawn to
   deliver it costs ~100,000. A recent `/code-review` run spent 527k tokens
   across five `general-purpose` agents.

The knowledge is cheap. The delivery mechanism is expensive and unreliable.

## Design

A `PreToolUse` hook on `Edit|Write` reads the target file path, resolves it to
the owning expert(s), and injects that expert's gotchas into context **before the
edit executes**. Deterministic, ~2k tokens, no subagent spawn.

### Hook contract (verified empirically, not assumed)

Confirmed against the two hooks already running in this repo — the `PostToolUse`
`Bash` cost-notice in `.claude/settings.local.json`, and ECC's `PreToolUse`
hooks in `~/.claude/plugins/marketplaces/ecc/hooks/hooks.json`.

- **stdin:** JSON with `session_id`, `tool_name`, `tool_input.file_path`, `cwd`.
- **stdout:** `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"<text>"}}`
- **exit:** always `0`. This hook never denies.

ECC already registers its own `PreToolUse` hooks matching `Edit|Write` (several
at the time of writing — the exact count shifts with plugin updates). Hooks
compose; ours is additive and must not assume it runs alone.

### Files

| File | Change |
|---|---|
| `.gitignore` | un-ignore `/.claude/hooks/**` — `/.claude/*` is an allowlist and would otherwise leave the hook untracked |
| `.claude/hooks/expert-context.ts` | new — the hook |
| `.claude/hooks/expert-context.test.ts` | new — vitest unit test |
| `.claude/settings.json` | register `PreToolUse` / `Edit\|Write` |
| `tsconfig.json` | add `".claude/hooks/**/*.ts"` to `include` — tsc wildcards never descend into dot-directories, so the default `**/*.ts` cannot see the hook |
| `vitest.config.ts` | add `".claude/hooks/**/*.test.ts"` to `include` |
| `.claude/agents/ai-features-expert.md` | new expert |
| `.claude/agents/ui-systems-expert.md` | scope: claim `src/hooks/`, `src/contexts/` |
| `.claude/agents/data-layer-expert.md` | scope: claim four `src/lib/*.ts` files |
| `CLAUDE.md` | update expert table; add `ecc:security-reviewer` row |

### Language: TypeScript, run by `bun`

Not Python, for two reasons that were checked rather than assumed:

- A `.ts` hook can be covered by `bun run typecheck` — but not for free.
  `tsconfig.json`'s `**/*.ts` include does NOT reach it: tsc wildcards never
  descend into dot-directories, so anything under `.claude/` is invisible to
  the default include. The design therefore adds `.claude/hooks/**/*.ts` to
  the tsconfig `include` array (see the files table), parallel to the vitest
  `include` addition. A `.py` file, by contrast, is invisible to `lint`,
  `typecheck`, and `test` no matter what — a strange property for the one tool
  whose job is making code correct.
- `bun` executes a zero-import `.ts` file directly. No `bun install`, no build
  step. Verified: piping a hook payload into `bun hooktest.ts` parsed
  `tool_input.file_path` and printed it.

Registration command: `bun "$CLAUDE_PROJECT_DIR/.claude/hooks/expert-context.ts"`.

Accepted risk: the hook depends on `bun` being on `PATH` in the hook shell. If it
is not, the hook silently no-ops. `bun` is already required by every command in
this repo, so it is the safest binary to depend on, and fail-open makes a miss
harmless.

### Path map

Lives inline in the hook as an ordered list of `[glob, agentName]` pairs. It is
the only consumer, so a second file would be a second thing to drift. A test
asserts the map and `.claude/agents/*.md` agree in both directions.

| Glob | Expert |
|---|---|
| `**/__tests__/**`, `**/*.test.ts`, `**/*.test.tsx` | `test-surgeon` |
| `src/app/api/chat/**`, `src/domain/ai/**`, `src/contexts/chat-context.tsx`, `src/components/domain/shared/chat-*.tsx` | `ai-features-expert` |
| `src/entities/**`, `src/services/**`, `src/app/api/{batches,orders,customers,recipes,users}/**` | `entity-architect` |
| `src/lib/supabase/**`, `src/lib/query-keys.ts`, `src/lib/{permissions,optimistic-lock,errors,pg-error-codes}.ts`, `supabase/migrations/**`, `src/app/portal/**`, `src/app/update-password/**`, `src/app/api/auth/**`, `src/proxy.ts` | `data-layer-expert` |
| `src/domain/**` | `brewing-domain-expert` |
| `src/integrations/**`, `src/app/api/{square,slack,email,integrations}/**`, `src/app/api/settings/api-key/**` | `integrations-expert` |
| `src/components/**`, `src/hooks/**`, `src/contexts/**` | `ui-systems-expert` |

**All matches inject, not first-match-wins.** Editing
`src/domain/__tests__/units.test.ts` should surface both `test-surgeon` and
`brewing-domain-expert`. Each payload is ~2k tokens; two is affordable and
strictly more useful than picking one arbitrarily. No cap is needed — the map
cannot produce more than three matches for any path.

`src/domain/ai/**` matches `ai-features-expert` *and* `brewing-domain-expert`.
That is correct and intentional: `recipe-analyzer.ts` is both.

The remainder of `src/lib/` (`format.ts`, `parsers.ts`, `logger.ts`, `enums.ts`,
`env.ts`, `sentry-config.ts`, and 19 others) is **explicitly unowned**. It is a
grab-bag, and an agent covering all of it would be a "misc expert," which is
another way of spelling `general-purpose`.

### Payload

From the matched agent's `.md`, extract the `## Must-know gotchas` and
`## Review checklist` sections — each from its heading to the next `## `. Skip
`## Mission` (prose, no actionable facts) and `## Key files` (paths that are
cheap to find).

### Dedupe

Once per `(session_id, agentName)`. Marker file at
`${TMPDIR}/mgr-expert-ctx/${session_id}__${agent}`. Nothing is written into the
repo, so no `.gitignore` change and no cleanup job — the OS reaps `TMPDIR`.

### Failure

Every path exits `0` and prints nothing: unparseable stdin, missing
`file_path`, no glob match, unreadable agent file, missing `TMPDIR`. `main()` is
wrapped in `try/catch`. A broken hook must never wedge an edit. This is why the
approved behavior is *inject, fail open* rather than *block until the agent is
consulted* — blocking reintroduces the 100k-token spawn and can wedge the
session when the map is wrong.

## Content work

The mechanism is worthless without knowledge to deliver.

**`ai-features-expert.md` (new).** Must be researched against
`src/app/api/chat/route.ts`, `chat/tools.ts`,
`src/domain/ai/{prompts,recipe-analyzer}.ts`, and `src/contexts/chat-context.tsx`
— not stubbed from general LLM knowledge. Known seeds: the AI SDK property is
`maxOutputTokens`, not `maxTokens`; `streamText` bounds tool calls via
`stopWhen: stepCountIs(N)`; `convertToModelMessages` adapts UI messages. The
load-bearing fact is that `tools.ts` is an **LLM trust boundary with database
write access** — the write-safety/confirmation gate (Phase 4C) lands there.
Implementation must read the files and record what actually bites, matching the
gotcha density of `ui-systems-expert.md`.

**Scope extensions.** `ui-systems-expert` claims `src/hooks/` and
`src/contexts/` — they are the state feeding its components, and a sibling agent
would fight it over every hook-plus-component change. `data-layer-expert` claims
`src/lib/{permissions,optimistic-lock,errors,pg-error-codes}.ts` — data-layer
concerns wearing a `lib/` hat.

**`CLAUDE.md`.** Update the table to match the map above, and add one row
pointing `ecc:security-reviewer` at the webhook and auth surface. That is a
review lens nobody owns: `refactor-reviewer` is scoped to behavior-preservation,
not security. The other 57 ECC agents stay unrouted — 27 are for languages this
repo does not contain, and adding rows for `typescript-reviewer` or
`performance-optimizer` buys an agent that does what a well-scoped prompt already
does.

## Verification

The hook has branching logic and a parser, so it gets one runnable check:
`.claude/hooks/expert-context.test.ts`, run by the existing `bun run test`.

To be testable, the hook exports `resolveExperts(filePath)` and
`extractSections(markdown)`, and only runs `main()` under `import.meta.main`.

Cases:

1. `src/components/domain/recipe/x.tsx` → `["ui-systems-expert"]`.
2. `src/domain/__tests__/units.test.ts` → both `test-surgeon` and
   `brewing-domain-expert` (multi-match).
3. `src/contexts/chat-context.tsx` → `ai-features-expert` and
   `ui-systems-expert`.
4. `README.md` → `[]`, stdout empty, exit `0`.
5. Malformed stdin → exit `0`, stdout empty.
6. Second call with the same `session_id` + agent → suppressed.
7. `extractSections` pulls gotchas + checklist and drops Mission and Key files.
8. **Map/disk agreement:** every agent named in the map exists in
   `.claude/agents/`, and every `.claude/agents/*.md` appears in the map.

## Non-goals

- No blocking or denying. Ever.
- No new agents beyond `ai-features-expert`. Specifically no hooks/contexts
  agent and no `src/lib` agent.
- No `Workflow` dispatcher.
- No changes to the other 57 ECC agents.
- Subagents are not replaced. `test-surgeon`, `refactor-reviewer`, and
  `ecc:security-reviewer` remain spawned agents — isolated context, parallelism,
  and adversarial review are things a context injection cannot do. This is
  consistent with `docs/agents/dispatching-agents.md`, which stays authoritative
  on *when to spawn*.

## Known snag

`.claude/settings.json` in the main checkout is on the sandbox write-deny list.
Registration needs the `update-config` skill or an explicit prompt. The worktree
copy is writable for testing.

## Success criterion

Editing `src/components/**` surfaces the `zodResolver`, helper-hoisting, and
`universal/`-purity rules in context with no subagent spawn — and the first draft
follows them.
