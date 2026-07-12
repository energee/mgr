#!/usr/bin/env bash
# Rebuilds PROGRESS.md from docs/progress/ entry files.
#
# Why: a single shared PROGRESS.md conflicted on every concurrent PR (GitHub's
# PR merge ignores the merge=union gitattribute). Entries now live one-per-file
# in docs/progress/ — concurrent branches touch different files, so conflicts
# are structurally impossible. CI (.github/workflows/progress.yml) runs this on
# every push to main that touches docs/progress/ and commits the result.
#
# Layout:
#   docs/progress/YYYY-MM-DD-slug.md  one session entry, verbatim as it should
#                                     appear in PROGRESS.md (a "- **YYYY-MM-DD
#                                     (title).** ..." bullet, sub-bullets ok)
#   docs/progress/archive.md          frozen pre-2026-07-12 content (old
#                                     "Current state" bullets + historical
#                                     sections), appended after the entries
#
# Ordering: newest-first by filename (date prefix); same-date ties sort by slug.
set -euo pipefail
cd "$(dirname "$0")/.."

{
  cat <<'EOF'
# Progress

> **GENERATED FILE — do not edit or commit on a branch.** Built from
> `docs/progress/` by `scripts/build-progress.sh`; CI rebuilds it on main after
> every merge that touches `docs/progress/`. To record progress, ADD ONE FILE
> per session entry — `docs/progress/YYYY-MM-DD-slug.md` — containing the entry
> exactly as it should appear below (a `- **YYYY-MM-DD (title).** …` bullet).
> Read this file at session start; write to `docs/progress/` at session end.

## Current state

EOF
  find docs/progress -maxdepth 1 -name '[0-9]*.md' | sort -r | while read -r f; do
    cat "$f"
  done
  cat docs/progress/archive.md
} > PROGRESS.md
