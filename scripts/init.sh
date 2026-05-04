#!/usr/bin/env bash
# scripts/init.sh — MGR harness bootstrap (Lecture 06)
#
# Verifies environment, installs dependencies, AND validates the four-line
# bootstrap contract: can start, can test, can see progress, can pick up next.
# Exits non-zero if any contract condition fails.
#
# Idempotent: safe to re-run.
#
# Usage: bash scripts/init.sh
#        make setup           (preferred)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "==> MGR harness bootstrap"
echo "    repo root: $REPO_ROOT"

if [ ! -f package.json ] || [ ! -d supabase ]; then
  echo "ERROR: must run from MGR repo root (package.json + supabase/ expected)" >&2
  exit 1
fi

require() {
  local cmd="$1" hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' not found. $hint" >&2
    exit 1
  fi
}

require bun  "Install Bun: https://bun.sh"
require node "Install Node 24+: https://nodejs.org"

if ! command -v supabase >/dev/null 2>&1; then
  echo "WARN: supabase CLI not installed — local DB workflows will fail. brew install supabase/tap/supabase"
fi

echo
echo "==> Versions"
echo "    bun:      $(bun --version)"
echo "    node:     $(node --version)"
command -v supabase >/dev/null 2>&1 && echo "    supabase: $(supabase --version)" || true

if [ ! -f .env ]; then
  echo "WARN: .env missing — copy .env.example to .env and fill in values before 'make dev'"
fi

echo
echo "==> bun install"
bun install

# ---- Bootstrap contract validation (Lecture 06) ----
#
# The contract: can start, can test, can see progress, can pick up next steps.
# Each is verified, not just described. Use BOOTSTRAP_SKIP=1 to skip (e.g.
# in CI where the agent already has its own gates).

if [ "${BOOTSTRAP_SKIP:-0}" = "1" ]; then
  echo
  echo "==> Bootstrap contract: SKIPPED (BOOTSTRAP_SKIP=1)"
  exit 0
fi

echo
echo "==> Bootstrap contract validation"

CONTRACT_FAILED=0
fail_contract() {
  echo "    FAIL: $1" >&2
  CONTRACT_FAILED=1
}
pass_contract() {
  echo "    PASS: $1"
}

# 1. Can start — package.json must define `dev` script
if grep -q '"dev"' package.json; then
  pass_contract "can start          (\`make dev\` resolves to bun run dev)"
else
  fail_contract "no 'dev' script in package.json"
fi

# 2. Can test (fast) — lint + typecheck must succeed
if bun run lint >/dev/null 2>&1 && bun run typecheck >/dev/null 2>&1; then
  pass_contract "can test (fast)    (lint + typecheck both green)"
else
  fail_contract "lint or typecheck not green — run \`make check-fast\` to see details"
fi

# 3. Can see progress — PROGRESS.md must exist and be reasonably fresh.
if [ ! -f PROGRESS.md ]; then
  fail_contract "PROGRESS.md missing — create it from the template in docs/agents/"
else
  # GNU coreutils (Linux) uses `-c %Y`; BSD/macOS uses `-f %m`. Probe Linux
  # first since it's the documented CI platform.
  PROGRESS_MTIME=$(stat -c %Y PROGRESS.md 2>/dev/null || stat -f %m PROGRESS.md 2>/dev/null || echo 0)
  PROGRESS_AGE_DAYS=$(( ( $(date +%s) - PROGRESS_MTIME ) / 86400 ))
  if [ "$PROGRESS_AGE_DAYS" -gt 14 ]; then
    fail_contract "PROGRESS.md is $PROGRESS_AGE_DAYS days old — refresh before resuming work"
  else
    pass_contract "can see progress   (PROGRESS.md updated $PROGRESS_AGE_DAYS day(s) ago)"
  fi
fi

# 4. Can pick up next — AGENTS.md exists and feature_list.json parses.
if [ ! -f AGENTS.md ]; then
  fail_contract "AGENTS.md missing — this is the canonical agent entry point"
elif [ ! -f docs/feature_list.json ]; then
  fail_contract "docs/feature_list.json missing — feature tracker required for WIP rule"
elif ! bun -e "JSON.parse(require('fs').readFileSync('docs/feature_list.json', 'utf8'))" >/dev/null 2>&1; then
  fail_contract "docs/feature_list.json is not valid JSON"
else
  pass_contract "can pick up next   (AGENTS.md + feature_list.json present and valid)"
fi

echo
if [ "$CONTRACT_FAILED" = "1" ]; then
  echo "==> Bootstrap contract FAILED. Fix the issues above and re-run \`make setup\`." >&2
  echo "    Set BOOTSTRAP_SKIP=1 to skip validation (CI / scripted use only)." >&2
  exit 1
fi

echo "==> Bootstrap contract: all four conditions verified."
echo
echo "    Next: \`make dev\`  /  \`make check\`  /  cat PROGRESS.md"
