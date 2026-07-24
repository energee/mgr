---
name: harness-engineering
description: Apply Ryan Lopopolo's harness-engineering corpus (github.com/lopopolo/harness-engineering) to improve this repo's agent harness. Use when asked to improve the harness, diagnose why an agent trajectory failed, review the repo's agent-readiness, or decide where a lesson/tool/check should live. Runs the corpus playbooks with mgr as the target.
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

# harness-engineering — improve the environment, hold the worker constant

Harness engineering improves agent output by shaping context and tools around a
fixed model/agent. This skill applies the upstream corpus to **this repo** as
the target. The corpus is **read-only shared context**: local truth (AGENTS.md,
docs/agents/, DECISIONS.md, migrations, tests) always governs; never copy the
corpus's layouts, policies, or fixtures into mgr.

## Get the corpus

```bash
C=~/.cache/harness-engineering
[ -d "$C" ] && git -C "$C" pull --ff-only -q || git clone -q --depth 1 https://github.com/lopopolo/harness-engineering "$C"
```

Then read `$C/AGENTS.md` — it is the corpus's own routing guide. Follow it.

## Pick the mode

| Request looks like | Follow |
|---|---|
| "Improve the harness for job X" / "why did that trajectory fail" | `$C/playbooks/improve-harness.md` — baseline → earliest failed handoff → smallest owning intervention → fresh rerun → retain/revise/remove |
| "Review/audit the repo's agent-readiness" | `$C/playbooks/repository-review.md` — follow representative jobs request→delivery; findings ordered by consequence |
| A single unresolved design decision (where should this lesson/tool/check live?) | Read ONE thesis via the routing table in `$C/AGENTS.md` (context routing section). Don't preload the corpus. |

## Ground rules (from the corpus, binding here)

- **One thesis at a time.** Retrieve a thesis only when mgr-local evidence
  leaves the decision unresolved; add a second only for a distinct concern.
- **Smallest owning intervention.** Prefer moving a lesson into its earliest
  durable owner: a type, a DB constraint, a lint rule, a test, a runbook in
  `docs/agents/`, an expert-agent file, or root routing in `AGENTS.md` —
  in roughly that order of durability.
- **Verify with a fresh rerun.** An intervention counts only if a fresh
  trajectory actually retrieved/invoked it and the job closed. Record the
  retain/revise/remove decision.
- **Proof at the claim boundary.** `make check` proves internal contracts;
  user-facing claims need the `verify` skill (real browser, real app).
- **Record the result** in `docs/progress/YYYY-MM-DD-slug.md` using the
  compact result record from the playbook (job, gap, intervention, rerun
  evidence, decision, owner).

## mgr-specific owner map

Where interventions land in this repo, by gap class:

| Gap class | mgr owner |
|---|---|
| Context (missing/stale/never retrieved) | `AGENTS.md` routing table, `docs/agents/*.md`, expert files in `.claude/agents/` |
| Capability (missing/illegible tool) | `Makefile` target, `scripts/`, or a skill in `.agents/skills/` |
| Domain ownership (competing representations) | entity `core.ts`, `src/domain/`, DB constraint/migration, `_schema_registry` |
| Authority (capability ≠ permission) | `.claude/settings.json` permissions/hooks, sandbox config |
| Proof (green check ≠ real outcome) | vitest/Playwright suite, `verify` skill, `make verify-feature` |
| Feedback (lesson didn't survive) | ESLint rule, `make check-db` SQL checks, Stop hooks, DEC entry in `docs/spec/decisions.md` |
