---
name: sweep-report
description: Post-patrol summary report after bug patrol completes. Use when finishing a bug-patrol loop or when asked for a sweep report.
---

# Sweep Report — Post-Patrol Summary

## Description
Generates a summary report after bug patrol completes. Shows what was found, fixed, and needs attention.

## Instructions

After bug patrol completes (or is interrupted), generate a comprehensive report.

### Report Format

```markdown
# Bug Patrol Report — {date}

## Summary
- **Sweeps completed**: {n}
- **Total issues found**: {n}
- **Auto-fixed (PRs opened)**: {n}
- **Dispatched (needs human)**: {n}
- **Remaining**: {n}

## PRs Opened
| PR | Title | Status | Confidence |
|----|-------|--------|------------|
| #{number} | {title} | ready/draft | high/medium |

## Issues Created (Need Your Input)
| Issue | Title | Why it needs you |
|-------|-------|-----------------|
| #{number} | {title} | {brief reason} |

## Proactive Findings
- {finding 1}
- {finding 2}

## Recommended Next Steps
1. {Review PR #X — straightforward fix, should be safe to merge}
2. {Triage Issue #Y — needs a product decision about Z}
3. {Consider: finding from proactive scan}
```

Write this report to `$TMPDIR/bug-patrol-report-{date}.md` and display it inline.
