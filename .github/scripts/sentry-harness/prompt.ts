import type { SentryIssue } from "./types";

export function buildFixPrompt(issue: SentryIssue): string {
  const tagLines = Object.entries(issue.tags)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  return `You are the Sentry Error Harness. Your job is to fix ONE production error thoroughly.

## Error Details

- **Issue ID**: ${issue.issueId}
- **Short ID**: ${issue.shortId}
- **Title**: ${issue.title}
- **Culprit**: ${issue.culprit}
- **Environment**: ${issue.environment}
- **Level**: ${issue.level}
- **Events (7d)**: ${issue.eventCount7d}
- **First seen**: ${issue.firstSeen}
- **Last seen**: ${issue.lastSeen}
- **Sentry link**: ${issue.permalink}

### Tags
${tagLines || "  (none)"}

### Stack Trace
\`\`\`
${issue.stackTrace || "(unavailable)"}
\`\`\`

## Pipeline (follow in order)

1. **Trace stack trace** — resolve each frame to a source file. Read the code around each frame.
2. **Root cause analysis** — determine *why* the error occurs. Null safety? Race condition? Stale state? Missing error boundary? Write the analysis out before fixing.
3. **Pattern scan** — use Grep to find similar vulnerabilities elsewhere in the codebase. If found, include them in the fix scope.
4. **Implement the fix** — minimal and targeted. Follow the conventions in CLAUDE.md: entity configs, universal components, centralized query keys from \`src/lib/query-keys.ts\`, no hardcoded status maps (DEC-007), no empty-string Select values (DEC-008), security_invoker on views, RLS on new tables.
5. **Add tests** — write a Vitest test that reproduces the error condition. Confirm it fails on the original code, then passes on the fix.
6. **Validate** — run \`bun run typecheck\`, \`bun run test\`, \`bun lint\`. All three must pass.
7. **Simplify** — invoke \`/simplify\` to review the changed code for reuse, quality, and efficiency. Apply fixes.
8. **Re-validate** — if step 7 changed anything, run \`bun run typecheck\`, \`bun run test\`, \`bun lint\` again.
9. **Code review** — invoke \`/code-review:code-review\` on the diff. Surface bugs, logic errors, security issues, convention violations.
10. **Apply review fixes** — address each finding from step 9.
11. **Re-validate** — if step 10 changed anything, run \`bun run typecheck\`, \`bun run test\`, \`bun lint\` again.
12. **Open the PR** — create branch \`sentry-fix/SENTRY-${issue.issueId}\`, push, and open a PR with the template below. Apply labels \`sentry-fix\` and \`automated\`.

## Guardrails

- Follow CLAUDE.md conventions strictly. Do not invent new patterns.
- Do not modify unrelated code. No opportunistic refactors.
- Do not skip hooks (\`--no-verify\`) or bypass validation.
- If validation fails 3 times in a row, do NOT force a bad fix. Stop and open a **diagnostic PR** instead (see below).
- Do not create documentation files unless the fix requires them.

## Diagnostic PR Fallback

If after 3 attempts you cannot produce a working fix, OR the root cause is outside this codebase (infrastructure, third-party library, stale data), open a PR that:

- Adds better error handling or logging at the failure point.
- Documents the root cause analysis in the PR body.
- Applies labels \`sentry-fix\`, \`automated\`, AND \`needs-human\`.

## PR Body Template

\`\`\`markdown
## Sentry Fix: ${issue.title}

**Issue:** [${issue.shortId}](${issue.permalink}) | **Events (7d):** ${issue.eventCount7d} | **First seen:** ${issue.firstSeen} | **Last seen:** ${issue.lastSeen}

### Root Cause
<deep analysis with file:line references>

### Fix
<what changed and why — specific files and logic>

### Related Patterns
<other locations with the same vulnerability, if any, and whether they were addressed>

### Test Plan
- [x] Reproducing test added at <path>
- [x] Fix verified (test passes)
- [x] Full test suite passes
- [x] Type check clean
- [x] Lint clean
- [x] /simplify pass completed
- [x] /code-review pass completed
\`\`\`

Begin with step 1.`;
}
