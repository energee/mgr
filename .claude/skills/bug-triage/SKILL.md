---
name: bug-triage
description: Isolated fix agent for a single bug in a worktree. Spawned by bug-patrol or used when fixing one triaged issue with minimal scope.
---

# Bug Triage — Isolated Fix Agent

## Description
Sub-agent skill for fixing a specific bug in an isolated worktree. Spawned by bug-patrol.

## Instructions

You are a focused bug-fix agent. You've been given a specific issue to fix in the MGR brewery management system.

### Process

1. **Verify worktree context**:
   ```bash
   pwd
   git branch --show-current
   ```

2. **Read the affected file(s)** — understand the surrounding code before making changes.

3. **Diagnose the root cause**:
   - For type errors: trace the type flow to find where the mismatch originates
   - For lint errors: check if it's auto-fixable (`bun lint --fix`) or needs manual work
   - For test failures: read both the test and the implementation to understand intent

4. **Apply the minimal fix**:
   - Change as few lines as possible
   - Do NOT refactor, add comments, or "improve" surrounding code
   - Do NOT touch files unrelated to the fix
   - If the fix requires changing more than 3 files, report `needs-human`

5. **Validate**:
   ```bash
   bun typecheck
   bun lint
   bun run test
   ```
   All three must pass. If they don't, iterate up to 3 times. After 3 failures, report the situation.

6. **Commit and push**:
   ```bash
   git add <specific-files-only>
   git commit -m "$(cat <<'EOF'
   fix: <description of what was wrong and what was fixed>
   EOF
   )"
   git push -u origin <branch-name>
   ```

7. **Open PR**:
   ```bash
   gh pr create --title "fix: <short description>" --body "$(cat <<'EOF'
   ## Summary
   - <what was broken>
   - <what the fix does>
   - <how it was validated>

   ## Found by
   Bug Patrol automated sweep

   ## Test plan
   - [x] `bun typecheck` passes
   - [x] `bun lint` passes
   - [x] `bun run test` passes
   EOF
   )"
   ```
   Use `--draft` flag if you're not fully confident in the fix.

8. **Report result** back to the parent agent:
   - `success`: PR opened, all checks pass
   - `failure`: couldn't fix after 3 attempts (include error details)
   - `needs-human`: fix is too complex or ambiguous

### Rules
- NEVER add Co-Authored-By lines to commits
- NEVER modify migration files, RLS policies, or state machine configs
- NEVER change the test if the implementation might be wrong — fix the implementation
- Always run full validation before committing
- Keep the PR description clear enough for async review
