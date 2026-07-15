# Decisions

> Project-level decision log. Distinct from [`docs/spec/decisions.md`](docs/spec/decisions.md), which logs **schema** decisions (DEC-*).
> Append; never edit prior entries. Format below.

## Format

```markdown
## YYYY-MM-DD — short title

- **Decision**: what was chosen
- **Why**: motivation (constraint / deadline / failure mode avoided)
- **Alternatives rejected**: what else was on the table, and why not
- **Reversibility**: easy / hard / one-way
```

---

## 2026-05-02 — AGENTS.md is canonical; CLAUDE.md deleted

- **Decision**: `AGENTS.md` is the single root agent-instruction file. `CLAUDE.md` deleted from the repo. Topic content split into `docs/agents/{patterns,query-keys,db-security,ui-rules,debugging}.md`.
- **Why**: Lecture 04 of the walkinglabs harness framework prescribes a 50–200 line router with topic docs. The 290-line `CLAUDE.md` mixed router and topic content. `AGENTS.md` is also the cross-tool standard (Codex / Cursor / Gemini / Aider) — Claude Code reads either, so unifying loses nothing and gains multi-agent compat.
- **Alternatives rejected**:
  - Symlink `CLAUDE.md → AGENTS.md` — Windows + CI portability friction.
  - Stub redirect (`CLAUDE.md` = "See AGENTS.md") — two files, contributor running Claude Code's `/init` could overwrite the stub.
- **Reversibility**: easy — `git revert` restores; cross-refs in plans/specs already use both names interchangeably.

## 2026-05-02 — Adopt walkinglabs harness framework

- **Decision**: Adopt the five-subsystem model (instructions / tools / environment / state / feedback) from <https://walkinglabs.github.io/learn-harness-engineering/>. Land in 9 ordered steps tracked in `PROGRESS.md`.
- **Why**: MGR's CLAUDE.md was the "one giant instruction file" anti-pattern (Lecture 04). Verification was inconsistent (agents had to know to run `bun lint && bun typecheck && bun test` manually). No cross-session continuity (`PROGRESS.md`, `DECISIONS.md`, `feature_list.json` all absent).
- **Alternatives rejected**:
  - Do nothing — accept agent overreach + premature "done" claims.
  - Build a custom harness — lower leverage; framework already has 12 lectures of distilled failure modes.
- **Reversibility**: easy — every artifact is a plain file; revert per-step.

## 2026-05-02 — `make` is the harness front door

- **Decision**: Single `Makefile` wraps `bun` scripts. `make check` is the pre-commit gate; `make check-all` is the PR gate; `make setup` is the bootstrap entry.
- **Why**: Agents shouldn't have to remember `bun lint && bun typecheck && bun test && bun build`. One command, one definition, layered per Lecture 09.
- **Alternatives rejected**:
  - `bun check` script in `package.json` — duplicates the chain; doesn't compose layers.
  - `npm-run-all` — extra dependency, no gain over plain Make targets.
- **Reversibility**: easy — delete `Makefile`, agents fall back to `bun run X`.

## 2026-07-13 — Agent worktrees use a harness-neutral root

- **Decision**: Claude, Codex, and Grok create and locate worktrees through `scripts/agent-worktree`, stored under `${AGENT_WORKTREE_ROOT:-$HOME/.agents/worktrees}/<repo>/<name>`. Shared skills live canonically under `.agents/skills/`, with harness adapters pointing to them.
- **Why**: Harness-native defaults scatter checkouts across `.claude`, `.codex`, and `.grok` locations, making handoff and cleanup unreliable. One Git-registered root gives every local harness the same absolute path and one lifecycle command.
- **Alternatives rejected**:
  - Repository-local `.agents/worktrees/` — nested checkouts expand search and file-watcher scope.
  - Keep each harness default — requires per-harness discovery and permits duplicate worktrees for the same task.
  - Documentation only — cannot enforce naming, protected-branch rules, dirty-tree protection, or canonical paths.
- **Reversibility**: easy — existing worktrees remain standard Git worktrees and can be moved or recreated elsewhere.

## 2026-07-15 — Recipe Save All is one database transaction

- **Decision**: The main recipe editor collects dirty parent fields and the six ingredient collections, then sends one version-checked `SECURITY INVOKER` RPC. Local dirty state and cache invalidation occur only after that transaction commits.
- **Why**: Separate DELETE/INSERT requests could erase ingredients on insertion failure, concurrent editors could merge replacement sets, and sequential section saves could leave a misleading partial commit.
- **Alternatives rejected**:
  - One transaction per ingredient section — protects each replacement but leaves Save All partially committed.
  - Client-side sequencing plus optimistic updates — JavaScript cannot create a transaction across PostgREST requests, and broad cache invalidation can overwrite unsaved local sections.
- **Reversibility**: moderate — the RPC and contribution registry can be reverted together, but doing so restores the known integrity gap.

## 2026-07-15 — Recipe additions replace one server-owned category

- **Decision**: Water-chemistry and non-water recipe additions share one version-checked PostgreSQL replacement command. The client names an allowlisted scope; the database derives membership from `additives.type`, locks the recipe, and commits the scoped delete/insert together.
- **Why**: These editors live outside the main six-section Save All aggregate. Separate PostgREST deletes and inserts could erase rows on failure, merge concurrent replacements, and trust a stale client-computed category boundary.
- **Alternatives rejected**:
  - Add additions to the main recipe aggregate — these screens save independently and own different additive categories.
  - Client compensation or retries — cannot roll back a committed delete or serialize two HTTP transactions.
- **Reversibility**: moderate — both call sites and the RPC can be reverted together, but doing so restores the integrity gap.
