#!/usr/bin/env bash
# scripts/init.sh — MGR harness bootstrap (Lecture 06)
#
# Verifies environment, installs dependencies, prints next steps.
# Idempotent: safe to re-run. Fails fast if a required tool is missing.
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

# Required tools
require() {
  local cmd="$1" hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' not found. $hint" >&2
    exit 1
  fi
}

require bun  "Install Bun: https://bun.sh"
require node "Install Node 24+: https://nodejs.org"

# Optional but strongly recommended
if ! command -v supabase >/dev/null 2>&1; then
  echo "WARN: supabase CLI not installed — local DB workflows will fail. brew install supabase/tap/supabase"
fi

# Versions
echo
echo "==> Versions"
echo "    bun:      $(bun --version)"
echo "    node:     $(node --version)"
command -v supabase >/dev/null 2>&1 && echo "    supabase: $(supabase --version)" || true

# .env presence
if [ ! -f .env ]; then
  echo "WARN: .env missing — copy .env.example to .env and fill in values before 'make dev'"
fi

# Install deps
echo
echo "==> bun install"
bun install

# Bootstrap contract (Lecture 06)
echo
echo "==> Bootstrap contract"
printf "    %-22s %s\n" "can start"        "make dev"
printf "    %-22s %s\n" "can test (fast)"  "make check-fast    (lint + typecheck)"
printf "    %-22s %s\n" "can test (full)"  "make check         (+ vitest + build)"
printf "    %-22s %s\n" "can test (e2e)"   "make check-all     (+ playwright)"
printf "    %-22s %s\n" "can see progress" "cat PROGRESS.md"
printf "    %-22s %s\n" "can pick up next" "cat AGENTS.md"
echo
echo "==> Init complete."
