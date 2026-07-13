# Dispatching subagents

When to spawn subagents instead of doing the work yourself, and how to brief them.
Applies to every harness that supports subagents (Claude Code `Agent` tool, Grok `spawn_subagent`, etc.). Prefer **strategy** over tool brand names.

## Decision rule

| Situation | Approach |
|---|---|
| Single read or search on a known file/pattern | **Do it inline** — read/search/shell in the current session. Faster than dispatch. |
| 2+ independent reads with no shared state needed | **Parallel subagents** — one message, multiple children. |
| Cross-stack investigation (DB / API / UI for one bug) | **Three parallel agents** — one per layer. Synthesize their reports. |
| Open-ended search across the repo (>3 queries deep) | **One explore/research agent** with a focused question. |
| Full implementation of a planned feature | **Direct work** — keep yourself in the loop; use a task list. |
| Task that is large and self-contained (e.g., bulk migration) | **One general-purpose agent** with a full brief. |

The cost of a subagent is the briefing — if writing the prompt takes longer than doing the work, dispatch loses.

## Domain experts (MGR)

When the change set matches a row in `AGENTS.md` → **Expert agents**, either:

1. **Dispatch** the matching expert as a subagent (harnesses that support named agents), or
2. **Read** `.claude/agents/<name>.md` and follow its body before editing that area.

Same rules either way. See also [`process.md`](process.md) for plan/execute and bug workflows.

## Brief like a smart colleague

A subagent has none of your conversation context. Give it:

1. **What you're trying to accomplish and why.** Not just the immediate task — the surrounding goal so it can make judgment calls.
2. **What you've already tried or ruled out.** Saves duplicated work.
3. **Constraints.** Worktree path, branch, files touched (or off-limits), conventions to follow.
4. **Output shape.** "Report under 200 words", "punch list", "bulleted findings", or "diff-only" — match expected length to the task.
5. **For lookups: the exact command or pattern.** For investigations: the question only.

Terse command-style prompts produce shallow, generic work. Always over-brief on context.

## Worked examples

### Cross-stack bug triage

You have a 500 error on a customer-portal route after a recent migration. Three agents in parallel — same message, different focus:

```
Agent 1 (DB):    "Investigate supabase/migrations/00153–00155 for any column or
                  view changes that affect the customer_portal_view.
                  Specifically check whether a `status` column was renamed,
                  dropped, or had its type changed. Read migration files only
                  — no app code. Report as <findings/no-findings> + cite the
                  exact line numbers. Under 200 words."

Agent 2 (API):   "Trace the request path for GET /api/portal/orders/[id].
                  Find: which Supabase query runs, which RLS policies it
                  triggers, whether it joins customer_portal_view. Read
                  src/app/api/portal/, related entity configs. Report the
                  chain in 5–10 bulleted hops + the exact SQL query string.
                  Under 250 words."

Agent 3 (FE):    "Trace what the customer portal calls when loading order
                  details. Find: which hook runs, which queryKey, what error
                  handling exists. Start from
                  src/app/portal/orders/[id]/page.tsx. Report under 200 words
                  as a chain (component → hook → query → state)."
```

Synthesize: combine the three reports into one root-cause analysis. Share the
synthesis with the user before writing any fix.

### Backfill investigation (one explore agent)

You need to know which existing migrations create views that join `auth.users`:

```
Agent type: explore / research (read-only), thorough search
Prompt: "Find every CREATE VIEW or CREATE OR REPLACE VIEW in
        supabase/migrations/ that JOINs or SELECTs from auth.users.
        Include views that reference it transitively (e.g., via a function
        return). Report file path, line number, view name, and the exact
        line that touches auth.users. Sort by migration filename.
        No code changes — read only."
```

### Independent code review

Get a second opinion that hasn't seen your reasoning:

```
Agent type: code-reviewer (or general-purpose with review brief)
Prompt: "Review the corrective migration at
        supabase/migrations/00156_security_invoker_corrections.sql.
        Context: backfilling security_invoker on 9 legacy views and
        rebuilding recent_vessel_cleanings to use user_profiles.email
        instead of auth.users. I've checked: user_profiles.email is
        synced from auth.users via 00036 trigger; the view's column
        shape is unchanged; CREATE OR REPLACE preserves dependents.
        Independent verification: is this migration safe to apply
        against a populated database, and is there anything I missed?
        Under 250 words."
```

## Anti-patterns

- **"Based on your findings, fix the bug."** Don't push synthesis onto the agent. You read the report, you decide the fix.
- **"Look around the codebase."** Vague prompts get vague answers. Name the question.
- **Spawning a subagent for a one-shot read or search.** Overhead > value.
- **Multiple agents on the same file.** Either consolidate into one prompt or give each agent a *different slice* of the file.
- **Forgetting to set the report length.** Subagents return whatever they produce — bound it.

## Cost discipline

Each subagent burns context (its own + a slice of yours via the report). Two heuristics:

- **Length cap the report.** "Under 200 words" is rarely too tight for an investigation; "under 100 lines" works for diff summaries.
- **Skip subagents for ≤3 trivial steps.** Three shell/search calls in your own session are faster than one dispatch + report read.

The harness exists to make agents reliable, not to make every task multi-agent. Solo work is the default.

## Harness notes (optional)

| Concern | Claude Code | Grok Build |
|---|---|---|
| Spawn | `Agent` / Task tool | `spawn_subagent` |
| Explore | `subagent_type: Explore` | `subagent_type: explore` |
| Domain experts | Named agents under `.claude/agents/` | Same files — spawn by name if listed, else read the body |
| Isolation | shared `scripts/agent-worktree` path | shared `scripts/agent-worktree` path |
