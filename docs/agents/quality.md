# Quality snapshot

Codebase health at a glance. Grade each domain and architectural layer A–D.
Update weekly, or whenever a major change shifts a grade. Compare against
previous snapshots in `git log -- docs/agents/quality.md`.

## Grades

- **A** — solid; would not be the bottleneck if a competent agent took over today.
- **B** — works; a minor refactor would clean it up.
- **C** — surfaces issues regularly (bugs, agent confusion, slow iteration). Plan a focused session.
- **D** — actively painful; consider a corrective rewrite.

## Domains

| Domain | Grade | As of | Notes |
|---|---|---|---|
| production | A− | 2026-05-04 | 12 entities (batch, brand, brew-log, beer-style, packaging-session, recipe, session-line-item, vessel, vessel-transfer, yeast-pitch, yeast-pitch-event, yeast-strain). Most active domain — F134 (recipe editor fixes, #246), F136 (packaging redesign), F112 (recipe/batch/brew-log cohesion) all recent. Universal entity pattern carries it. |
| inventory  | B  | 2026-05-04 | 12 entities (largest surface). F137 unified material planning landed in commit a2704f7 — load-bearing. Allocations pattern is robust. Some legacy: keg-inventory and keg-transactions migrations (00029–00032) are in the permissive-RLS allowlist. |
| sales      | B  | 2026-05-04 | 7 entities + customer portal (F114). Single-tenant permissive RLS on order_materials family (00162) — documented but coarse. Pricing tiers (F110, F117) and selling formats (F124, F130) work. Less recent attention than production. |
| purchasing | B− | 2026-05-04 | 4 entities (purchase-order, po-line-item, po-receive, supplier). Smaller surface, demand-planning view (F105) is shared with inventory. F132 (COGS projections) recent. Few dedicated tests. |
| catalog    | B+ | 2026-05-04 | Brands / styles / yeasts / water-profiles / containers / selling-formats. Mostly stable; brands+styles design (F104) shipped early. Schema is wide and self-documenting via `_schema_registry`. |
| packaging  | A− | 2026-05-04 | F136 redesign (PackagingDayView, in-progress flow) shipped in commit 196cb56-era work. Custom status-based detail view pattern is one of the cleanest in the repo. New E2E smoke spec covers it. |
| auth       | B  | 2026-05-04 | F116 (permission-based roles), `user_profiles` mirrored from `auth.users` via 00036 trigger. `is_admin_rls` and similar SECURITY DEFINER helpers grandfathered. F131 login redesign recent. RLS now checked executably. |
| ai         | A− | 2026-05-04 | Dedicated `src/domain/ai/`, multiple DB functions (`analyze_recipe_style_compliance`, `get_recipe_summary`, etc.), separate `docs/spec/ai-integration.md`. F100, F106, F111 all shipped. AI chat panel works end-to-end. |

## Architectural layers

| Layer | Grade | As of | Notes |
|---|---|---|---|
| Entity configs (`src/entities/`)              | A  | 2026-05-04 | 40 entity configs driving universal list/detail/edit. The project's defining strength. New entities take ~1–2 hours including pages. |
| Universal components (`src/components/universal/`) | A  | 2026-05-04 | 17 files, recently consolidated to `EntityDetailUnified` (F113). `EntityDetail` / `EntityForm` removed; ESLint blocks re-introduction. `StatusBadge` derives from `stateMachine.stateDisplay`. |
| Domain components (`src/components/domain/`)  | B  | 2026-05-04 | 114 files of mixed maturity. Recipe editor is the gold standard (independent-save sections, shared context, client-side calc). Other corners are simpler one-off forms. Test coverage spotty (only 2 domain components have tests). |
| Hooks (`src/hooks/`, `src/lib/queries/`)      | B  | 2026-05-04 | 19 hooks, no dedicated test files for hooks themselves. Centralized query keys (`src/lib/query-keys.ts`) now ESLint-enforced — strong invariant. |
| DB schema (`supabase/migrations/`)            | B  | 2026-05-04 | 147 migrations. Eight executable checks now in place (security_invoker, RLS, auth.users, search_path, SECURITY DEFINER, permissive RLS, schema_registry, data-model docs). Corrective migration 00156 applied to production 2026-05-04. Allowlists hold ~30 grandfathered entries to be tightened over time. |
| Tests (vitest + Playwright)                   | B− | 2026-05-04 | 1019 vitest passing across 34 files, but most live in `src/lib/__tests__/` (21 of 40). Hooks, entity configs, and most components have no dedicated tests. Coverage threshold set at 50% on `src/lib/**` (raise gradually). E2E smoke covers 5 flows; deeper flows are `test.skip` pending seed data. |
| AI integration (`src/domain/ai/`, DB functions)  | A− | 2026-05-04 | Mature library + DB functions + spec doc + AGENTS.md routing. Recipe style compliance / brewing science / write-actions all wired. AI chat panel (F100) works in the app. |
| Harness (this folder + `Makefile` + scripts/) | A− | 2026-05-04 | Rolled out 2026-05-02 to 2026-05-04 across PRs and #249. 16 ultrareview findings addressed. Eight executable DB checks, ESLint custom rules, WIP=1 enforcement, bootstrap contract validation, Sentry harness writes harness state. Not yet battle-tested across multiple agent sessions — promote to A after a 2-week soak proves drift detection works in practice. |

## Trend log

> Append a one-liner whenever a grade moves. Don't edit prior entries.

- **2026-05-02** — Harness rolled out (A−). DB schema bumped from C to B because executable security checks now exist, even though the corrective migration 00156 still needed to be applied.
- **2026-05-03** — Round 2 hardening landed (PR #249, commits 4f18fd4 + 3e8b24f): ESLint custom rules, schema-registry / data-model-docs / WIP / permissive-RLS / search_path / SECURITY DEFINER checks, Linux bootstrap fix, parser-correctness fixes for the new DB checks.
- **2026-05-04** — Initial baseline grades filled in (this commit). 00156_security_invoker_corrections applied to production database via `bun run db:migrate -- --include-all`; the 9 legacy views and `recent_vessel_cleanings` rebuild are now live.

## How to update

1. Read the current grades. Disagree with one? Append a trend-log line, then update the cell.
2. Don't grade your own current work — wait until it's been live for at least a few days.
3. **Move a grade only when evidence has changed**: a bug rate spike, a successful refactor, a new pattern that simplifies a domain, an audit that surfaces hidden debt.
4. Trend lines matter more than absolute values. A `B → C` matters more than the difference between two `B`s.
