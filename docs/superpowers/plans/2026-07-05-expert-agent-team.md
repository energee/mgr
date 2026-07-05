# Expert Agent Team + Targeted LOC Campaign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build six project-scoped expert agents from a measured codebase evaluation, produce a ranked fix backlog, and execute the top 2–3 duplication/LOC fixes with the new agents.

**Architecture:** Read-only explorer agents fan out over six code areas and distill gotchas + dedup candidates; their output becomes `.claude/agents/*.md` files (domain knowledge split into `docs/knowledge/` for future app-chat reuse) plus a ranked backlog; top fixes run in isolated worktrees gated by characterization tests and a read-only reviewer agent.

**Tech Stack:** Claude Code agents (markdown + frontmatter), jscpd/depcheck (via bunx, not committed), vitest, bun, git worktrees.

**Spec:** `docs/superpowers/specs/2026-07-05-expert-agent-team-design.md`

## Global Constraints

- Work happens in worktree `/Users/tedslesinski/Repos/mgr/.claude/worktrees/agent-team`, branch `feat/expert-agent-team` (base `ba0ed5d5` = last-fetched origin/main). Verify with `pwd` + `git branch --show-current` before any change. Never commit to `main` or `fix/harness-stability`.
- NEVER add `Co-Authored-By` lines to commits.
- Commit subjects prefixed: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `ci:`.
- Gates before any code commit: `bun run lint` && `bun run typecheck` && `bun run test`. Docs-only commits skip gates.
- Test runner is `bun run test` (vitest). `bun test` is the WRONG runner (Bun native).
- Sandbox may fail with `E2BIG`/"argument list too long" while many worktrees exist — retry that command with sandbox bypass, per command.
- knip/depcheck are advisory only: knip false-flags exports consumed via the entity registry and `z.infer`.
- New worktrees need `bun install` before typecheck/tests (Next.js dual-lockfile warning is expected).
- Explorer/read phases touch the MAIN repo checkout read-only (`/Users/tedslesinski/Repos/mgr`); all writes go to the agent-team worktree or fix worktrees.
- Never touch worktrees under `~/conductor/` (user's Conductor app owns them).

---

### Task 1: Prune stale agent worktrees (Phase 0a)

**Files:** none (git state only)

**Interfaces:**
- Produces: worktree count low enough that sandboxed commands stop hitting `E2BIG`; a list of skipped-as-unsafe worktrees for the report.

- [ ] **Step 1: Enumerate candidates**

Run from `/Users/tedslesinski/Repos/mgr`:
```bash
git worktree list --porcelain | awk '/^worktree /{print $2}' | grep '\.claude/worktrees/' | grep -v '/agent-team$'
```
Expected: paths like `.claude/worktrees/agent-a727b67b`, `.claude/worktrees/audit`, `.claude/worktrees/fix-pr-*`.

- [ ] **Step 2: Classify each candidate**

For each path `P` with branch `B` (from `git worktree list`):
```bash
git -C "$P" status --porcelain | head -3        # must be EMPTY (clean)
git log --oneline main.."$B" | head -3           # must be EMPTY (no unique commits)
```
Safe to remove only if BOTH are empty, OR the branch is already merged (`git branch --merged main | grep "$B"`). Anything dirty or with unique commits: SKIP and record path+reason.

- [ ] **Step 3: Remove safe ones**

```bash
git worktree remove "$P"          # no --force; force only if git complains about untracked build artifacts (node_modules)
git branch -d "$B" 2>/dev/null    # -d not -D; refuses unmerged = extra safety
git worktree prune
```

- [ ] **Step 4: Verify**

```bash
git worktree list | wc -l
```
Expected: well under 53 (target: ≤ 15). Report removed count + skipped list to the user before proceeding.

### Task 2: Baseline measurements (Phase 0b)

**Files:**
- Create (scratchpad, NOT committed): `$SCRATCH/baseline/loc.txt`, `$SCRATCH/baseline/jscpd.json`, `$SCRATCH/baseline/depcheck.txt`
  where `SCRATCH=/private/tmp/claude-501/-Users-tedslesinski-Repos-mgr/e0b1047d-9be6-49ce-977b-2bec649bf6bc/scratchpad`

**Interfaces:**
- Produces: duplication % + top-15 clone list + unused-dep list, consumed by Task 7's backlog doc.

- [ ] **Step 1: LOC snapshot**

Run from `/Users/tedslesinski/Repos/mgr` (main checkout = read baseline):
```bash
mkdir -p "$SCRATCH/baseline"
find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | tail -1 | tee "$SCRATCH/baseline/loc.txt"
```
Expected: ~161k total.

- [ ] **Step 2: Duplication scan**

```bash
bunx jscpd src --min-tokens 70 --reporters console,json --output "$SCRATCH/baseline" --ignore "**/__tests__/**,**/*.test.*"
```
Expected: console summary table with clones count + duplicated-lines %. JSON lands at `$SCRATCH/baseline/jscpd-report.json`. Record the top 15 clone pairs by duplicated lines.

- [ ] **Step 3: Unused dependency scan (advisory)**

```bash
bunx depcheck 2>&1 | tee "$SCRATCH/baseline/depcheck.txt"
```
Expected: lists of "Unused dependencies" / "Unused devDependencies". Treat as candidates only — verify each before believing it (registry/`z.infer` false-positive history).

### Task 3: Evaluation fan-out — six read-only explorers (Phase 1)

**Files:**
- Create (scratchpad): `$SCRATCH/explorers/<agent-name>.md` — one per explorer, raw output saved verbatim.

**Interfaces:**
- Produces: per-area (a) gotcha/convention/checklist content (≤600 words) and (b) dedup-candidate table `| files | what's duplicated | est. LOC saved | risk (low/med/high) |` — consumed by Tasks 4, 5, 7.

- [ ] **Step 1: Dispatch all six explorers in ONE message (parallel, read-only, no worktrees)**

Common preamble for every brief:
> You are evaluating `/Users/tedslesinski/Repos/mgr` (READ-ONLY — change nothing). Study: (1) the code in your assigned area, (2) `git log --follow` / `git log --grep=fix --grep=revert` history of its key files — past fixes and reverts are mistakes worth encoding, (3) `docs/plans/2026-06-30-dedup-extraction-backlog.md` and `docs/plans/2026-06-30-codebase-audit.md`, (4) `/Users/tedslesinski/.claude/projects/-Users-tedslesinski-Repos-mgr/memory/MEMORY.md`. Return exactly two sections: **A. Expert knowledge** — the gotchas, conventions, and a review checklist a fresh engineer needs for this area, ≤600 words, concrete file paths; **B. Dedup/simplification candidates** — markdown table `| files | duplication | est LOC saved | risk |`, only entries you verified by reading both sides of the duplication.

Per-explorer focus (append to preamble):
1. **entity-architect scope:** `src/entities/` (all 36 configs + `cores.ts` + `index.ts`), how entities wire to routes in `src/app/` and `src/lib/query-keys.ts` + `src/lib/entity-actions.ts`. Look hard for repeated column/form/schema shapes hoistable into `cores.ts` helpers.
2. **data-layer-expert scope:** `src/lib/supabase/`, `src/lib/query-keys.ts`, `src/lib/optimistic-lock.ts`, `src/lib/pg-error-codes.ts`, `supabase/migrations/` (esp. 00092, 00190, 00191), RLS model, PostgREST quirks.
3. **brewing-domain-expert scope:** `src/domain/` — units.ts, inventory-units.ts, water-chemistry, yeast-*, ttb-utils, allocation-calculations, packaging-completion, consumption-planning, planning/, purchasing/, sales/. Also produce raw material for a domain-knowledge doc: unit conventions, BOM semantics, TTB rules — written so an END USER-facing chat could consume it (no dev tooling references in that portion).
4. **ui-systems-expert scope:** `src/components/` (universal/, data-table/, domain/, ui/, portal/, dashboard/), `src/lib/form-resolver.ts`, `src/lib/data-table*.ts`. This is 44% of the app — prioritize the biggest clone clusters.
5. **test-surgeon scope:** all `__tests__` dirs + `src/test/`, `vitest.config.*`. Document the exact working idiom: `createRoot`+`act`, stubbing `Sortable`/`UnitInput`/data-hooks, mocking `@/lib/supabase/client` (top-level env validation), plus which areas lack characterization coverage.
6. **refactor-reviewer scope:** git history repo-wide — `git log --grep='revert' --grep='reintroduc' --grep='regression' -i --oneline`, PRs #308/#309/#324/#328/#331 context in docs/plans, `.claude/settings.json`. Distill a behavior-preservation review checklist and the repo's known refactor failure modes.

- [ ] **Step 2: Save each explorer's raw output**

Write each result verbatim to `$SCRATCH/explorers/<name>.md`. Verify all six files are non-empty; re-dispatch any explorer that returned thin/generic content (no file paths = thin).

### Task 4: Shared domain-knowledge docs (Phase 2a)

**Files:**
- Create: `docs/knowledge/brewing-domain.md`
- Create: `docs/knowledge/entity-model.md`
(in the agent-team worktree)

**Interfaces:**
- Produces: app-chat-safe knowledge files referenced by Task 5's `brewing-domain-expert` + `data-layer-expert` agents; later importable by `src/domain/ai/prompt.ts` (NOT wired now — spec non-goal).

- [ ] **Step 1: Write `docs/knowledge/brewing-domain.md`** from explorer 3's output. Required sections: `## Units & conversions` (canonical units, where conversion lives), `## BOM & packaging` (sessions consume materials via `selling_format_materials`; no direct session↔material table — by design), `## TTB & compliance`, `## Yeast & water chemistry assumptions`. Module-level intro comment stating purpose + consumers (dev agents now, app chat later).

- [ ] **Step 2: Write `docs/knowledge/entity-model.md`** from explorers 1+2: entity inventory with key relations (batch→brew-log, order→order-item, purchase-order→po-line-item→po-receive, packaging-session→session-line-item, keg-* cluster, pricing-tier cluster), and the permission model in one paragraph (role-based via `user_has_permission()`, no tenancy).

- [ ] **Step 3: Verify app-chat safety**

```bash
grep -inE 'vitest|knip|worktree|createRoot|CLAUDE|agent' docs/knowledge/*.md
```
Expected: no matches (dev-tooling content belongs in agent files, not here). Fix any hits.

- [ ] **Step 4: Commit**

```bash
git add docs/knowledge/ && git commit -m "docs: shared brewing-domain + entity-model knowledge base"
```

### Task 5: Write the six agent files (Phase 2b)

**Files:**
- Create: `.claude/agents/entity-architect.md`, `.claude/agents/data-layer-expert.md`, `.claude/agents/brewing-domain-expert.md`, `.claude/agents/ui-systems-expert.md`, `.claude/agents/test-surgeon.md`, `.claude/agents/refactor-reviewer.md` (in the agent-team worktree)

**Interfaces:**
- Consumes: `$SCRATCH/explorers/*.md` section A content.
- Produces: agents auto-matchable by description, used by Task 8's fix procedure.

- [ ] **Step 1: Write all six using this exact template**

```markdown
---
name: <agent-name>
description: <2-3 sentences: WHEN to use — name the directories/file patterns that trigger it, e.g. "Use when creating or modifying anything under src/entities/ ...". MUST BE USED for <area> changes.>
tools: Read, Grep, Glob, Bash, Edit, Write
---

# <Agent title>

## Mission
<one paragraph: what this agent owns and optimizes for>

## Must-know gotchas
<explorer section A content — bulleted, each with a file path>

## Review checklist
<5-10 checks specific to this area>

## Key files
<the 5-10 files that define this area's patterns>
```

Per-file specifics:
- `refactor-reviewer.md`: `tools: Read, Grep, Glob, Bash` (NO Edit/Write — it gates, it doesn't fix) and an added `## Verdict format` section: must end reports with `BEHAVIOR-PRESERVING: yes|no|uncertain` + reasons.
- `brewing-domain-expert.md` and `data-layer-expert.md`: add `## Knowledge base` section: "Read `docs/knowledge/brewing-domain.md` / `docs/knowledge/entity-model.md` first; that file is the source of truth — update IT, not this agent file, when domain rules change."
- `test-surgeon.md`: must include the full working test-file skeleton (imports, `vi.mock('@/lib/supabase/client')`, `createRoot`+`act` render helper) from explorer 5, as a copy-paste block.

- [ ] **Step 2: Verify frontmatter + tool scoping**

```bash
head -6 .claude/agents/*.md | grep -c 'name:'          # expect 6
grep -L 'description:' .claude/agents/*.md              # expect empty
grep -E 'Edit|Write' .claude/agents/refactor-reviewer.md | head -2   # expect no match in tools line
```

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/ && git commit -m "feat: six project expert agents (entity, data-layer, domain, ui, test, review)"
```

### Task 6: Project CLAUDE.md with routing table (Phase 2c)

**Files:**
- Create: `CLAUDE.md` (repo root — none exists today; verify with `ls CLAUDE.md` first, if one appeared via merge, append the routing section instead)

**Interfaces:**
- Produces: routing so future sessions actually invoke the agents.

- [ ] **Step 1: Write CLAUDE.md** (≤45 lines):

```markdown
# mgr — brewery management (Next.js + Supabase + TypeScript)

## Commands
- `bun run lint` / `bun run typecheck` / `bun run test` (vitest — never `bun test`) — all three before any commit
- Migrations: `supabase/migrations/00XXX_description.sql`, always `db push --include-all`

## Expert agents — consult before working in their areas
| Touching | Use agent |
|---|---|
| `src/entities/`, entity registry, new entities | `entity-architect` |
| `src/lib/supabase/`, `query-keys.ts`, migrations, RLS | `data-layer-expert` |
| `src/domain/` calculations (units, BOM, TTB, yeast, water) | `brewing-domain-expert` |
| `src/components/` | `ui-systems-expert` |
| Writing/repairing tests, pre-refactor coverage | `test-surgeon` |
| Reviewing any refactor/dedup diff (read-only gate) | `refactor-reviewer` |

Domain source of truth: `docs/knowledge/brewing-domain.md`, `docs/knowledge/entity-model.md` — update those, not agent files, when domain rules change.

## Conventions
- Commit prefixes feat/fix/chore/docs/refactor/perf/ci; NEVER Co-Authored-By lines
- Query keys only via `src/lib/query-keys.ts`
- One entity = one file in `src/entities/<name>.tsx`, registered in `index.ts`
- knip/depcheck flag false positives (entity registry, `z.infer`) — verify before deleting
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md && git commit -m "docs: project CLAUDE.md with agent routing table"
```

### Task 7: Ranked backlog doc + PR (Phase 3)

**Files:**
- Create: `docs/plans/2026-07-05-agent-team-fix-backlog.md`

**Interfaces:**
- Consumes: Task 2 baselines, Task 3 section-B tables, PR #328 deferred items.
- Produces: ranked menu; Task 8 takes the top 2–3.

- [ ] **Step 1: Write the backlog doc.** Structure:

```markdown
# Agent-team fix backlog (2026-07-05)

## Baseline (pre-campaign)
- LOC (src, ts+tsx): <Task 2 number>
- jscpd: <N> clones, <X>% duplicated lines (min-tokens 70, tests excluded)
- depcheck advisories: <list — UNVERIFIED>

## Ranked fixes
| # | Fix | Files | Est LOC saved | Risk | Coverage exists? | Source |
(rank by LOC-saved ÷ risk; risk high = touches domain calcs or shared cores)

## Deferred from PR #328 (carried forward)
- B5 dynamicOptions extension — NOT behavior-preserving, needs feature design
- B1/B2 editor characterization coverage — optional safety net (merges assessed low-value)

## Success criteria
- jscpd % below baseline after top fixes land; suite green (~1547 tests); tsc clean per PR
```

Merge duplicate candidates reported by multiple explorers (same files = one row, keep higher risk rating).

- [ ] **Step 2: Commit and open the PR**

```bash
git add docs/plans/2026-07-05-agent-team-fix-backlog.md && git commit -m "docs: ranked fix backlog with jscpd/LOC baselines"
git push -u origin feat/expert-agent-team    # SSH may need sandbox bypass
gh pr create --title "feat: project expert-agent team + knowledge base + fix backlog" --body "<summary of agents, knowledge docs, backlog; note app-chat wiring deferred>"
```
Expected: PR URL. Report it to the user.

### Task 8: Execute top fixes (Phase 4) — repeat per fix, max 3 fixes

**Files:** per fix: new worktree `/Users/tedslesinski/Repos/mgr/.claude/worktrees/fix-<slug>` on branch `refactor/<slug>` based on `ba0ed5d5`; files per backlog row.

**Interfaces:**
- Consumes: Task 7 ranking (top rows where risk ≤ medium), Task 5 agents.
- Produces: one PR per fix; per-PR `git diff --shortstat` recorded for Task 9.

Selection rule: take backlog rows top-down; skip any row with risk=high or "coverage exists?"=no AND est LOC saved < 100 (coverage cost would exceed payoff).

- [ ] **Step 1: Create isolated worktree**

```bash
cd /Users/tedslesinski/Repos/mgr
git worktree add .claude/worktrees/fix-<slug> -b refactor/<slug> ba0ed5d5
cd .claude/worktrees/fix-<slug> && bun install    # dual-lockfile warning expected
```

- [ ] **Step 2: Coverage gate (test-surgeon agent)**

Dispatch `test-surgeon`: "Worktree `/Users/tedslesinski/Repos/mgr/.claude/worktrees/fix-<slug>`, branch `refactor/<slug>`. Target files: <files>. Verify characterization tests exist and pass for the behaviors these files own; if missing, write them using the repo idiom in your definition. Run `bun run test -- <test paths>` and report output." Must be GREEN before any refactor. If tests were added: commit `test: characterization coverage for <area>`.

- [ ] **Step 3: The refactor (area agent)**

Dispatch the matching area agent (`ui-systems-expert` for components, `entity-architect` for entities, etc.): "Same worktree/branch. Execute backlog fix #<n>: <row description>. Behavior-preserving ONLY — no API changes, no feature changes. Run `bun run lint && bun run typecheck && bun run test` before reporting; fix your own failures (max 3 iterations, then stop and report)."

- [ ] **Step 4: Review gate (refactor-reviewer agent)**

Dispatch `refactor-reviewer` on `git diff ba0ed5d5...HEAD`. Required verdict `BEHAVIOR-PRESERVING: yes`. On `no`/`uncertain`: one repair round via the area agent, re-review; still not `yes` → abandon (Step 6).

- [ ] **Step 5: Land**

```bash
git commit -m "refactor: <what was deduplicated> (backlog #<n>)"   # if not already committed by agent
git push -u origin refactor/<slug>
gh pr create --title "refactor: <slug> (backlog #<n>)" --body "<what/why, LOC delta from git diff --shortstat, gates run>"
```

- [ ] **Step 6: Abort path (only on 3 failed gate iterations or failed review)**

```bash
cd /Users/tedslesinski/Repos/mgr && git worktree remove --force .claude/worktrees/fix-<slug> && git branch -D refactor/<slug>
```
Then edit the backlog doc row: demote with reason (commit `docs: demote backlog #<n> — <reason>` on `feat/expert-agent-team`).

### Task 9: Wrap-up report

**Files:**
- Modify: `docs/plans/2026-07-05-agent-team-fix-backlog.md` (results section)

- [ ] **Step 1: Append results to the backlog doc**: per-fix PR links + `git diff --shortstat` LOC deltas + any demotions. Commit `docs: record campaign results` and push.

- [ ] **Step 2: Report to user**: agents created (6), knowledge docs (2), PRs opened (1 + per-fix), LOC delta total, skipped/demoted items, worktrees removed in Task 1 vs. skipped-as-unsafe.

- [ ] **Step 3: Update session memory**: add MEMORY.md pointer that the agent team + backlog exist (so future sessions route through them instead of rebuilding).
