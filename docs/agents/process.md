# Shared agent process

Harness-agnostic workflows for bugs, features, worktrees, docs, and review.
Every harness (Claude Code, Grok, Codex, etc.) must follow these when the
matching trigger or situation applies. Tool/skill names in italics are optional
— use the equivalent if your harness provides it.

## Git worktree rules

- Always confirm which worktree and branch you are in **before** making changes.
- When the user specifies a worktree, never edit `main` or another worktree by mistake.
- After switching worktrees, run `pwd` and `git branch --show-current` before proceeding.

## Documentation gate

- Every change to public APIs, database schemas, component props, route structure, or user-facing behavior **must** include matching documentation updates.
- Update affected layers in the same change: inline comments, JSDoc/TSDoc, README, API docs, architecture docs (when they exist).
- New files get a brief module-level comment explaining purpose.
- When modifying existing functions/components, update stale comments or docstrings in the same commit.
- Documentation is part of the commit — never defer a separate "docs cleanup" pass.

## Code review

- Flag **all** legitimate issues regardless of severity score. Do not silently skip findings below an internal threshold.
- If using a scoring system, still present all findings and let the user decide what to fix.

## Guardrails (evidence-first)

- **Visual / print / hardware debugging** (CSS layout, thermal labels, printers, sensor readings): capture actual rendered output and real measurements *before* any edit. Never tweak transforms/padding/orientation to "see if it helps". Use a *measure-first* skill if available.
- **Migrations, drift capture, or long-running/expensive work**: check worktrees, remote branches, and open PRs first — a concurrent session may have already done the work. Use a *preflight* skill if available.
- Never claim a fix or edit is applied without re-reading the file or re-capturing live output afterward.
- Bulk data transfer: always script it (DB-to-file). Never manual chunked/base64 transfers through MCP tool calls — they corrupt data (homoglyphs).
- Multi-hour or high-cost tasks: split into phases; after each phase report remaining scope and pause for a checkpoint.

## Bug fix process (red–green–refactor)

When the user reports a bug using **"I'm reporting a bug: [description]"**, follow this process with no exceptions:

### 1. Reproduce

- Read the relevant source and write a Vitest test that captures the failure.
- Run it and confirm it fails with the expected error.
- Do **not** proceed until you have a red test.

### 2. Root cause

- Analyze why the test fails (stale cache, RLS, Supabase response handling, enums, state management, etc.).
- Write the diagnosis as a message **before** any fix code.

### 3. Minimal fix

- Smallest possible fix. Do not refactor surrounding code unless the architecture blocks the fix.
- If you need to pivot approaches, explain why first and wait for confirmation.

### 4. Validate

- The new test must pass (green).
- Then run the full suite (`bun run test` / vitest) and typecheck (`tsc --noEmit` or project equivalent).
- If anything fails, iterate on the **fix** (not the test) up to 3 times; then stop and report.

### 5. Regression check

- Search for the same pattern elsewhere; fix and test those too if found.

### 6. Documentation

- Update comments/docs that describe the fixed behavior. Add clarifying comments if misunderstanding caused the bug.

### 7. Commit gate

- Only after tests and typecheck are clean, commit with a message referencing the bug and the test file.
- Work in the worktree the user specified — never the wrong tree.

## Feature implementation (two-phase)

When the user requests a feature with **"I want to implement a new feature: [description]"**:

### Phase 1 — Plan (no implementation code)

1. Read codebase patterns for entities, forms, tables, Supabase queries, and routes.
2. Produce a numbered task list (max 20). Each task specifies:
   - Exact file paths to create/modify
   - TypeScript types involved
   - Acceptance criteria verifiable with `tsc` or vitest
   - Dependencies on other tasks
3. For database changes: include migration SQL and the migration filename with correct version numbering.
4. Mark which tasks can run in parallel vs sequential.
5. Commit the plan as `docs/plans/[feature-name].md` on the specified branch/worktree.
6. **Stop and wait for explicit approval** before Phase 2.

### Phase 2 — Execute (only after approval)

1. Per task: brief a sub-agent (or do the work) with worktree path, branch, files to touch, and validation command.
2. After each task: typecheck + relevant tests; fix failures before continuing.
3. Resolve conflicts with prior task output inline.
4. Final validation: full build + test suite (`make check` or stronger as appropriate).
5. Documentation updates for all affected layers.
6. Commit with a single descriptive message per logical unit; push when complete.
7. Summary: tasks completed, tests added, files modified, deviations from the plan.

## Development workflow notes

### TypeScript / build

- After code changes, run typecheck and verify zero errors before committing.
- After rebases or simplification passes, re-run typecheck — those often reintroduce errors.

### Migrations

- Create and apply migrations only in the correct worktree/branch — never on `main`.
- Verify apply succeeded before dependent code changes.
- After enum/constraint changes, expect stale PostgREST / `enum_values` cache; suggest refresh when errors appear.

### Approach validation

- If the first fix fails: stop and re-analyze — do not iterate the same patch blindly.
- If the user redirects to a different approach, acknowledge the pivot and why it is better.
- Do not dismiss user-reported bugs as "stale build" without evidence — verify the code first.

See also [`debugging.md`](debugging.md) for investigation patterns.
