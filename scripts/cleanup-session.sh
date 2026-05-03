#!/usr/bin/env bash
# scripts/cleanup-session.sh — Idempotent end-of-session cleanup (Lecture 12)
#
# Safe to re-run. Removes session-scoped artifacts that should not persist
# across sessions. Intentionally narrow: this is not a "clean everything"
# script — `make clean` exists for that.
#
# Usage: bash scripts/cleanup-session.sh
#        After running, walk through docs/agents/clean-state-checklist.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Session cleanup"

# Temporary debug logs (idempotent: -f suppresses missing-file errors)
rm -f /tmp/mgr-debug-*.log
rm -f /tmp/claude-mgr-*.log
echo "    cleared /tmp/mgr-debug-*.log, /tmp/claude-mgr-*.log"

# Playwright trace artifacts that pile up
if [ -d test-results ]; then
  rm -rf test-results
  echo "    removed test-results/"
fi

if [ -d playwright-report ]; then
  rm -rf playwright-report
  echo "    removed playwright-report/"
fi

# Stale Next.js cache from interrupted dev sessions
if [ -d .next/cache/webpack ]; then
  rm -rf .next/cache/webpack
  echo "    removed .next/cache/webpack/ (stale dev cache)"
fi

# Detect leftover console.log / debugger statements in working-tree changes
echo
echo "==> Checking for session-only debug residue in changed files"
DEBUG_HITS="$(git diff --name-only --diff-filter=AM HEAD 2>/dev/null \
  | grep -E '\.(ts|tsx|js|jsx)$' \
  | xargs -I {} grep -nE '(console\.log|debugger;)' {} 2>/dev/null \
  || true)"

if [ -n "$DEBUG_HITS" ]; then
  echo "WARN: review these before committing:"
  echo "$DEBUG_HITS"
else
  echo "    none found"
fi

echo
echo "==> Cleanup complete. Now walk docs/agents/clean-state-checklist.md."
