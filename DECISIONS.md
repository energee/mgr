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

- **Decision**: Claude, Codex, and Grok create and locate worktrees through `scripts/agent-worktree`, stored under `${AGENT_WORKTREE_ROOT:-<main-checkout>/.agents/worktrees}/<repo>/<name>`. Shared skills live canonically under `.agents/skills/`, with harness adapters pointing to them.
- **Why**: Harness-native defaults scatter checkouts across `.claude`, `.codex`, and `.grok` locations, making handoff and cleanup unreliable. One Git-registered root gives every local harness the same absolute path and one lifecycle command.
- **Update (2026-07-14)**: Root moved from `$HOME/.agents/worktrees` to the main checkout's `.agents/worktrees/` so worktrees sit beside the repo, not in the home directory. The nested-checkout hazard that originally ruled this out is neutralized by gitignoring `/.agents/worktrees/` and excluding it from `tsconfig.json`, `eslint.config.mjs`, `next` build, and `vitest`. `AGENT_WORKTREE_ROOT` still overrides.
- **Alternatives rejected**:
  - Home-directory root (`$HOME/.agents/worktrees`) — the original choice; moved out of `$HOME` per preference, hazard mitigated by ignore/exclude globs.
  - Keep each harness default — requires per-harness discovery and permits duplicate worktrees for the same task.
  - Documentation only — cannot enforce naming, protected-branch rules, dirty-tree protection, or canonical paths.
- **Reversibility**: easy — existing worktrees remain standard Git worktrees and can be moved or recreated elsewhere; set `AGENT_WORKTREE_ROOT` to relocate.

## 2026-07-15 — QuickBooks creates use durable request identities

- **Decision**: Before creating a QuickBooks Invoice or Bill, persist the exact outbound payload in `qbo_sync_log` and send a deterministic, per-entity `requestid`. Treat mapping and log-write errors as sync failures; a known remote success with a failed local mapping is reported as requiring reconciliation and is retried with the same request identity.
- **Why**: A QuickBooks POST and a Postgres mapping write cannot share a transaction. Intuit deduplicates repeated writes with the same request ID, so this closes both lost-response and remote-success/local-write-failure duplicate windows while retaining an operator-visible recovery record.
- **Alternatives rejected**:
  - Query by `DocNumber` before every create — document numbers are business-controlled and not a reliable unique request identity.
  - Only propagate mapping-write errors — honest failure reporting alone would still let the retry create a second remote document.
- **Reversibility**: easy — the intent uses the existing sync-log schema, and the request-ID behavior is isolated to the two transaction create paths.

## 2026-07-15 — Recipe Save All is one database transaction

- **Decision**: The main recipe editor collects dirty parent fields and the six ingredient collections, then sends one version-checked `SECURITY INVOKER` RPC. Local dirty state and cache invalidation occur only after that transaction commits.
- **Why**: Separate DELETE/INSERT requests could erase ingredients on insertion failure, concurrent editors could merge replacement sets, and sequential section saves could leave a misleading partial commit.
- **Alternatives rejected**:
  - One transaction per ingredient section — protects each replacement but leaves Save All partially committed.
  - Client-side sequencing plus optimistic updates — JavaScript cannot create a transaction across PostgREST requests, and broad cache invalidation can overwrite unsaved local sections.
- **Reversibility**: moderate — the RPC and contribution registry can be reverted together, but doing so restores the known integrity gap.

## 2026-07-15 — Square partial refunds use cumulative deltas

- **Decision**: Size each Square refund against the order's cumulative completed refund amount, then insert only the difference between each original sale allocation's cumulative target and its previously recorded reversals.
- **Why**: Flooring each event independently permanently lost units across split refunds; a three-unit sale refunded in two halves restored only two units. The existing per-order transaction lock makes the completed refund history stable while the delta is calculated.
- **Alternatives rejected**:
  - Decrement original sale allocations — completed allocations are the immutable removal ledger and must be reversed with adjustment entries.
  - Round each refund event independently — changes which event gets a unit but still permits event-boundary drift.
  - Alert and reconcile later — detects corruption after it occurs instead of preserving inventory in the ingest transaction.
- **Reversibility**: moderate — the replacement RPC can be reverted, but doing so restores deterministic inventory drift for sequential refunds.

## 2026-07-15 — Recipe additions replace one server-owned category

- **Decision**: Water-chemistry and non-water recipe additions share one version-checked PostgreSQL replacement command. The client names an allowlisted scope; the database derives membership from `additives.type`, locks the recipe, and commits the scoped delete/insert together.
- **Why**: These editors live outside the main six-section Save All aggregate. Separate PostgREST deletes and inserts could erase rows on failure, merge concurrent replacements, and trust a stale client-computed category boundary.
- **Alternatives rejected**:
  - Add additions to the main recipe aggregate — these screens save independently and own different additive categories.
  - Client compensation or retries — cannot roll back a committed delete or serialize two HTTP transactions.
- **Reversibility**: moderate — both call sites and the RPC can be reverted together, but doing so restores the integrity gap.

## 2026-07-15 — Yeast pitch events use their UUID as the retry key

- **Decision**: `pitch_yeast_atomic` accepts a stable request UUID and stores it directly as `yeast_pitch_events.id`; source-row locking and defensive triggers make balance, status, and event creation one database transaction.
- **Why**: the event already has a globally unique immutable identifier, so a second idempotency column would duplicate identity without improving retry semantics. The source lock is the shared serialization point for RPC and direct writers.
- **Alternatives rejected**:
  - A separate nullable `idempotency_key` column — adds a second unique identity and legacy-null behavior with no benefit for immutable events.
  - Client-only availability checks — cached readers cannot serialize concurrent deductions.
  - RPC without table guards — authenticated direct inserts and source edits could still produce a negative derived balance.
- **Reversibility**: hard — event UUIDs become part of the public command contract, though the RPC can later accept a separate key while preserving existing IDs.

## 2026-07-15 — Order change approval stops at fulfillment history

- **Decision**: Apply order change requests atomically against `selling_format_id`, but reject approval when the order already has a non-cancelled pick list or active/completed finished-good allocation. Staff cancels and regenerates those artifacts first.
- **Why**: Allocations are order-level and cannot reliably identify one of multiple matching order lines. Automatic cancellation could rewrite the wrong reservation, and sales users may approve orders without inventory-write permission.
- **Alternatives rejected**:
  - Reproduce the legacy brand/format running-total cancellation — ambiguous for duplicate product lines and could over-cancel a larger reservation.
  - Give sales users inventory-write access — materially broadens their role beyond order management.
  - Run the entire approval as `SECURITY DEFINER` — unnecessary privilege for the actual order/request mutation.
- **Reversibility**: moderate — a future line-linked allocation model could safely replace the precondition with exact reservation reconciliation.

## 2026-07-15 — Shipping-material estimates share the order-item write boundary

- **Decision**: Recalculate order shipping-material estimates with invoker-rights database triggers on material-impacting order-item writes. Serialize through the parent order row, preserve manual actual quantities, and let the browser only invalidate its cache after commit.
- **Why**: Direct staff edits previously committed before a separate browser calculation, while change-request approval bypassed that browser path entirely. The shared trigger makes the line change, estimate update, and approval status one rollback boundary.
- **Alternatives rejected**:
  - Call a recalculation RPC after each mutation — it remains a second transaction and can leave stale estimates.
  - Duplicate recalculation inside every mutation RPC — direct table writes would still bypass the contract and the same formula would drift across commands.
  - Keep the browser hook for direct edits only — preserves the original partial-commit and manual-override bugs.
- **Reversibility**: moderate — the triggers and calculator can be removed together, but doing so restores a multi-transaction derivation gap.
