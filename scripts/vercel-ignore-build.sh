#!/usr/bin/env bash
# scripts/vercel-ignore-build.sh — Vercel ignored-build step (vercel.json "ignoreCommand").
#
# Skips Vercel builds for commits that touch only documentation/agent-config
# paths (docs/, any *.md, .github/, .claude/, .agents/) so docs-only pushes
# and automated PROGRESS.md rebuild merges don't burn build minutes.
#
# Vercel semantics: exit 0 = skip the build, exit 1 = proceed with the build.
set -euo pipefail

# First commit or shallow clone without the parent available: build to be safe.
if ! git rev-parse --verify --quiet 'HEAD^' >/dev/null 2>&1; then
  echo "vercel-ignore-build: no parent commit available; building."
  exit 1
fi

if git diff --quiet 'HEAD^' HEAD -- ':!docs' ':!*.md' ':!.github' ':!.claude' ':!.agents'; then
  echo "vercel-ignore-build: docs-only change; skipping build."
  exit 0
fi

echo "vercel-ignore-build: non-docs changes detected; building."
exit 1
