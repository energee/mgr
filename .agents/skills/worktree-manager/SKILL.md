---
name: worktree-manager
description: Create, enter, locate, hand off, diagnose, or remove shared Git worktrees for Claude, Codex, and Grok. Use whenever an agent needs an isolated branch, the user asks to work in a worktree, parallel tasks need separate checkouts, or work must move between AI harnesses.
---

# Worktree Manager

Use `scripts/agent-worktree` as the only worktree creation and discovery interface. It stores worktrees under `${AGENT_WORKTREE_ROOT:-$HOME/.agents/worktrees}/<repo>/`, where every local harness can find them through the shared Git repository.

## Create or resume

1. Read `PROGRESS.md` and check `docs/feature_list.json` for another `in_progress` feature.
2. Choose a short lowercase name and a non-protected branch.
3. Create the worktree from the repository root:

   ```bash
   scripts/agent-worktree create <name> --base origin/main --branch <type>/<name>
   ```

   Omit `--base` to prefer local `origin/HEAD`, then `origin/main`, then `HEAD`. Fetch explicitly first when the task requires the latest remote state.
4. Treat the absolute path printed on stdout as the working root. Verify it before editing:

   ```bash
   git -C <path> status --short --branch
   ```

The command is idempotent when the canonical path is already registered. It attaches an existing local branch when that branch is not checked out elsewhere.

## Enter or hand off

Resolve an existing worktree with:

```bash
scripts/agent-worktree path <name>
```

Pass the returned absolute path during handoff. Use that path as the tool working directory for every subsequent command.

- Claude: switch with `EnterWorktree(path=<path>)` or start Claude from that directory.
- Codex CLI: start with `codex -C <path>`.
- Grok: start with `grok --cwd <path>`.

Do not create a second checkout for a handoff. Do not allow multiple write agents to edit the same worktree concurrently; use read-only inspection or explicit writer ownership.

## Inspect or clean up

```bash
scripts/agent-worktree list
scripts/agent-worktree doctor
scripts/agent-worktree prune
```

Only remove a worktree when the user requests cleanup or the task's documented landing process requires it:

```bash
scripts/agent-worktree remove <name>
```

Removal refuses uncommitted changes. Use `--force` only with explicit user approval after explaining what will be discarded. `prune` removes stale Git metadata, not active worktree directories.

## Constraints

- Never create new worktrees under `.claude/worktrees/`, `.worktrees/`, the repository's `.agents/`, or another harness-specific directory.
- Never use `claude --worktree`, bare `EnterWorktree`, `grok -w`, or manual `git worktree add` when the shared script is available.
- Never use `main` or `master` as an agent-worktree branch.
- Preserve `.worktreeinclude`; the manager copies listed ignored local files into new worktrees.
