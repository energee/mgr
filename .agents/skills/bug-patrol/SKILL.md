---
name: bug-patrol
description: Continuous automated bug detection and fix loop for MGR. Use when the user invokes /bug-patrol or asks for unattended overnight bug hunting that triages, fixes, and opens PRs.
---

# Bug Patrol — Continuous Automated Bug Detection & Fix Loop

## Description
Autonomous bug-hunting loop that runs quality checks, triages failures, fixes obvious issues via PRs, and dispatches to the user when human judgment is needed.

## Trigger
User invokes `/bug-patrol` to start the loop. Designed to run unattended (e.g. overnight).

## Instructions

You are an autonomous bug patrol agent for the MGR brewery management system. Your job is to continuously find and fix bugs while the user sleeps.

### Loop Structure

Run this loop repeatedly. Each iteration is one "sweep." Between sweeps, pause 30 seconds to avoid hammering CI.

#### STEP 1: SWEEP — Run all quality checks

Run these in parallel and collect all failures:

```bash
# Type checking
bun typecheck 2>&1

# Linting
bun lint 2>&1

# Unit tests
bun run test 2>&1
```

Parse the output into a structured list of issues. For each issue, extract:
- **file**: path to the affected file
- **line**: line number (if available)
- **category**: `type-error` | `lint-error` | `test-failure` | `build-error`
- **message**: the error message
- **severity**: `critical` (blocks build/tests) | `warning` (lint issues)

If ALL checks pass with zero errors, report "All clear" and proceed to Step 5 (Proactive Scan).

#### STEP 2: TRIAGE — Classify each issue

For each issue from Step 1, classify it:

**AUTO-FIX** (handle autonomously — open a PR):
- Unused imports or variables (lint)
- Missing type annotations that can be inferred
- Simple type mismatches with obvious fixes (e.g., `string | null` needs a null check)
- Test assertion mismatches where the expected value is clearly wrong
- Missing `await` keywords
- Incorrect import paths (file was moved/renamed)
- ESLint auto-fixable rules

**INVESTIGATE** (needs deeper analysis — try to fix, PR as draft if uncertain):
- Test failures where the test logic looks correct but the implementation is wrong
- Type errors that require understanding business logic
- Multiple related errors that suggest a refactoring regression
- Errors in database query code or Supabase client usage

**DISPATCH** (needs human judgment — ask the user):
- Errors that suggest intentional API changes or design decisions
- Test failures that might indicate the test is outdated vs the code is wrong
- Issues touching state machines, RLS policies, or migration files
- Anything where two reasonable fixes exist and the choice depends on product intent
- More than 5 related errors suggesting a systemic issue

#### STEP 3: EXECUTE FIXES

For each AUTO-FIX and INVESTIGATE issue (or batch of related issues):

1. **Create an isolated worktree**:
   ```bash
   worktree_path=$(scripts/agent-worktree create bugfix-<short-description> \
     --base origin/main \
     --branch bugfix/<short-description>)
   ```

2. **Spawn an agent** with `$worktree_path` as its working directory. Do not request native worktree isolation, which would create a duplicate checkout. Use this prompt template:
   ```
   You are fixing a bug in the MGR brewery management system.

   **Issue**: {category} in {file}:{line}
   **Error**: {message}
   **Classification**: {AUTO-FIX or INVESTIGATE}
   **Worktree**: {worktree_path}

   Instructions:
   1. Read the affected file and understand the context
   2. Apply the minimal fix (do NOT refactor surrounding code)
   3. Run `bun typecheck` and `bun run test` to verify your fix
   4. If the fix passes, commit with message: "fix: {description}"
   5. Push the branch: git push -u origin bugfix/{short-description}
   6. Create a PR:
      - For AUTO-FIX: regular PR with clear description
      - For INVESTIGATE: draft PR with your analysis in the description
   7. Report back: {success|failure|needs-human}

   IMPORTANT:
   - Do NOT add Co-Authored-By lines to commits
   - Run `bun lint` before committing
   - If the fix requires changing more than 3 files, STOP and report needs-human
   - If you're not confident the fix is correct, create a draft PR
   ```

3. **Batch related issues** — if multiple errors stem from the same root cause, fix them together in one worktree/PR.

4. **Limit parallel agents** to 3 at a time to avoid resource contention.

#### STEP 4: DISPATCH FOR HUMAN INPUT

For each DISPATCH issue, create a GitHub issue with this format:

```bash
gh issue create \
  --title "Bug Patrol: {short description}" \
  --label "bug-patrol,needs-triage" \
  --body "$(cat <<'EOF'
## Bug Patrol Finding

**Category**: {category}
**File**: {file}:{line}
**Error**: {message}

## Analysis
{Your analysis of why this needs human judgment}

## Options
1. {Option A}: {description and tradeoffs}
2. {Option B}: {description and tradeoffs}

## Recommendation
{Your recommended approach, if you have one}

---
*Found by Bug Patrol automated sweep*
EOF
)"
```

Also use AskUserQuestion to prompt the user directly — they may still be awake or will see it next session.

#### STEP 5: PROACTIVE SCAN (when all checks pass)

When the codebase is clean, look for latent issues:

1. **Dead code detection**: Look for exported functions/components with zero imports
2. **TODO/FIXME/HACK audit**: Grep for these markers and assess if any are stale
3. **Type safety gaps**: Look for `as any`, `@ts-ignore`, `@ts-expect-error` that might be removable
4. **Test coverage gaps**: Check if recently modified files have corresponding tests
5. **Dependency issues**: Run `bun pm audit --level high` for security vulnerabilities

For any proactive findings, follow the same triage flow (Step 2).

#### STEP 6: REPORT

After each sweep, output a brief status:

```
=== Bug Patrol Sweep #{n} ===
Timestamp: {ISO timestamp}
Type errors: {count} ({fixed}/{dispatched}/{remaining})
Lint errors: {count} ({fixed}/{dispatched}/{remaining})
Test failures: {count} ({fixed}/{dispatched}/{remaining})
PRs opened: {list of PR URLs}
Issues created: {list of issue URLs}
Next sweep in: 30s
```

### Loop Termination

Continue looping until:
- User sends a message (respond to it, then resume)
- All checks pass AND proactive scan finds nothing for 3 consecutive sweeps
- You've completed 20 sweeps (safety limit — report and stop)

### Rules

1. **Never commit directly to main** — always use feature branches and PRs
2. **Never modify migration files** — dispatch these to the user
3. **Never change test assertions** unless the test is clearly wrong (not the implementation)
4. **Always run the full test suite** before opening a PR
5. **Keep PRs small and focused** — one issue per PR (or one batch of related issues)
6. **Draft PRs for uncertain fixes** — let the user review before merging
7. Follow all rules in AGENTS.md (no Co-Authored-By, run lint, etc.)
