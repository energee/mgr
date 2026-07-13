#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || fail "jq is required (install from https://jqlang.org/download/)"

bash -n scripts/agent-worktree
bash -n scripts/__tests__/agent-worktree.test.sh
jq -e . .claude/settings.json >/dev/null

skill_count=0
for skill_dir in .agents/skills/*; do
  [[ -d "$skill_dir" ]] || continue
  skill_count=$((skill_count + 1))
  skill_name=$(basename "$skill_dir")
  skill_file="$skill_dir/SKILL.md"
  adapter=".claude/skills/$skill_name"

  [[ -f "$skill_file" ]] || fail "missing $skill_file"
  [[ "$(sed -n '1p' "$skill_file")" == '---' ]] || fail "$skill_file has no YAML frontmatter"
  grep -Eq '^name: [a-z0-9][a-z0-9-]*$' "$skill_file" || fail "$skill_file has an invalid name"
  grep -Eq '^description: .+' "$skill_file" || fail "$skill_file has no description"

  [[ -L "$adapter" ]] || fail "$adapter must be a compatibility symlink"
  [[ "$(readlink "$adapter")" == "../../.agents/skills/$skill_name" ]] || \
    fail "$adapter points to the wrong canonical skill"
  [[ -f "$adapter/SKILL.md" ]] || fail "$adapter does not resolve to a skill"
done

(( skill_count > 0 )) || fail "no canonical skills found under .agents/skills"

adapter_count=0
for adapter in .claude/skills/*; do
  [[ -e "$adapter" || -L "$adapter" ]] || continue
  adapter_count=$((adapter_count + 1))
  skill_name=$(basename "$adapter")

  [[ -L "$adapter" ]] || fail "$adapter must be a compatibility symlink"
  [[ -d ".agents/skills/$skill_name" ]] || \
    fail "$adapter has no canonical skill under .agents/skills"
done

(( adapter_count == skill_count )) || \
  fail "canonical skill count ($skill_count) does not match compatibility adapter count ($adapter_count)"

[[ -f .agents/skills/worktree-manager/agents/openai.yaml ]] || \
  fail "worktree-manager is missing Codex UI metadata"
grep -Fq 'scripts/agent-worktree' AGENTS.md || fail "AGENTS.md does not route worktree creation"
grep -Fq 'WorktreeCreate' .claude/settings.json || fail "Claude WorktreeCreate hook is missing"

while IFS= read -r entry || [[ -n "$entry" ]]; do
  case "$entry" in
    ''|'#'*) continue ;;
  esac
  git check-ignore --quiet --no-index -- "$entry" || \
    fail ".worktreeinclude entry is not ignored: $entry"
done < .worktreeinclude

printf 'OK: %s canonical skill(s) and agent worktree configuration validated\n' "$skill_count"
