# MGR Simplification — Design Spec

**Date:** 2026-05-19
**Status:** Approved — decisions resolved (§9); ready for per-phase planning
**Branch:** `refactor/simplify-phase-0-1`

---

## 1. Context & goals

`mgr` is a brewery-management app (Next.js 16 App Router + Supabase + React Query +
TypeScript). At the start of this effort it was ~139k LOC across 737 TS/TSX files
(~129k hand-written, excluding the 9,950-line generated `src/types/supabase.ts`),
40 entities, 151 migrations.

The user asked for two things:

1. **Meaningfully reduce lines of code** — eliminate unnecessary logic, duplication,
   and reinvention while keeping functionality stable.
2. **Let the AI/voice chat interact with every entity the same way the forms do** —
   create/update entities through chat without reinventing the form interface.

Multi-organization support is **not** in scope: the app is deployed one
organization per deployment, and that model is already adequate. No tenancy,
`org_id`, or RLS work is planned.

## 2. Key framing decisions (already made with the user)

- **Deliverable model:** Analysis → plan → execute, in reviewable phases.
- **Risk tolerance:** Aggressive — architecture and dependency changes are in scope.
- **Sequencing:** **AI-first** — Phase 1 ships first (quick + safe), then the entity
  refactor and generic AI tools (the user's priority), then reports and
  integrations. Execution order is **0 → 1 → 3 → 4 → 2 → 5** (§5).

## 3. Survey findings (parallel read-only surveys)

| Area | Finding | LOC opportunity |
|---|---|---|
| Whole-repo | 31 dead files, 2 dead deps, 293 unused exports, `if (error) throw` repeated ~228× | 1,000–9,000 |
| Entity system | 40 configs, ~73% boilerplate; "universal" components are genuinely clean (near-zero entity special-casing); a `_schema_registry` table already exists | 4,000–8,000 |
| Reports | Heavy client-side aggregation that belongs in SQL; repeated report scaffolding | 950–1,600 |
| AI chat & integrations | `tools.ts` search tools repeat a query+schema+error pattern ~8×; `entity-map.ts` duplicates ~38 entity definitions; QBO sync functions repeat a 6-step pattern | 800–1,200 |

### 3.1 The convergence

The single most valuable refactor — splitting entity configs into a **server-safe
core** and a **client-only presentation layer** — pays off twice:

1. **Kills duplication.** `src/app/api/chat/entity-map.ts` (412 LOC) exists *only*
   because `src/entities/*.tsx` are React modules that cannot be imported
   server-side. A server-safe core makes `entity-map.ts` redundant.
2. **Unlocks generic AI writes.** Entity configs already export `formSchema` (zod,
   36/39). The form persist path is trivial: zod-validate → `.insert`/`.update`.
   Once the schema is reachable server-side, one generic `createEntity` /
   `updateEntity` / `transitionEntity` tool — driven by `core[name].formSchema` —
   replaces every hand-coded write tool and covers all 40 entities. Forms and chat
   then share **one** validation contract.

## 4. Guiding principles

1. **Behavior-preserving by default.** Every phase ends green on `bun typecheck`,
   `bun run test`, `bun run lint`. No user-facing behavior change unless explicitly
   called out and approved.
2. **Risk backloaded, value frontloaded.** Safe, high-LOC wins ship first.
3. **Each phase is independently shippable** — its own plan, its own PR(s), its own
   merge. Work can stop after any phase.
4. **Convergence over addition.** The entity refactor is the hinge — one piece of
   work, two payoffs (§3.1).
5. **knip is the dead-code authority.** A `knip.json` is now committed; future
   dead-code passes run `bun run knip`.

## 5. The phased roadmap

**Execution order: 0 → 1 → 3 → 4 → 2 → 5** (AI-first — per decision §9.1).

| Phase | Name | Risk | Est. LOC Δ | Unlocks |
|---|---|---|---|---|
| 0 | Verification baseline + dead-code removal | low | **−7,700 (done)** | safety net |
| 1 | Shared data-access helpers | low–med | −700 to −1,500 | — |
| 3 | Entity config core/presentation split | med–high | −4,000 to −6,000 | Phase 4 |
| 4 | Generic AI entity tools + write safety | med | −300 to −500 net | AI/voice CRUD |
| 2 | Reports consolidation | low–med | −950 to −1,600 | — |
| 5 | Integrations cleanup | low–med | −400 to −800 | — |

Net target: **~9,000–12,000 LOC removed.** Phase 0 is complete (see §8).

### Phase 0 — Verification baseline + dead-code removal ✅ DONE

- Established green baseline: typecheck 0, lint 0, **1,116 tests pass**.
- Removed 2 unused dependencies (`media-chrome`, `@xyflow/react`) + dead `panel.tsx`.
- Removed **31 dead files (~7,693 LOC)** — verified via knip's transitive
  import-graph plus independent import-path greps.
- Added `knip.json` + `knip` script so dead-code detection is reliable.
- **Not done autonomously, deferred to review:** 293 unused *exports* (too granular
  to remove unreviewed — many are intentional public API surface); `formatDate`
  consolidation (now resolved — see §7).

### Phase 1 — Shared data-access helpers

- **Goal:** remove the ~228 repetitions of `const { data, error } = await …; if
  (error) throw error; return data;`.
- **Approach:** add `src/lib/supabase/query-helpers.ts` exporting `unwrap()` (and a
  maybe-variant). Roll out in bounded batches by directory, each batch verified
  green. The transformation is mechanically identical → the test suite is the gate.
- **Also:** merge the `format.ts` / `utils.ts` `formatValue` overlap; inline
  single-use hooks (`use-as-ref`, `use-callback-ref`); apply the resolved
  `formatDate` standard (§7). Each requires a behavior check before landing.
- **Risk:** low–med. The bulk rollout touches 100+ files — mechanical but broad;
  land it as several small PRs, not one.

### Phase 3 — Entity config core/presentation split (the keystone)

- **Goal:** eliminate ~73% boilerplate across 40 entity configs **and** make entity
  metadata reachable server-side.
- **Approach:**
  - Define `EntityCore` (server-safe, pure data: `table`, `formSchema`, field
    metadata, state machine, relations) and `EntityPresentation` (client-only:
    column renderers, section components, dialogs).
  - **File layout (resolved §9.3): per-entity directory** —
    `src/entities/<name>/{core.ts, presentation.tsx, index.ts}`. `index.ts`
    re-exports the assembled `EntityConfig` so existing callers are unaffected.
  - Add a `createEntityConfig()` helper: smart defaults + per-entity overrides.
    Plain TypeScript — **no build-time codegen** (codegen was considered and
    rejected: it adds a generated layer that is harder to debug for marginal extra
    savings).
  - `src/app/api/chat/entity-map.ts` is deleted; the core registry replaces it.
  - **Pilot** on 2–3 simple entities (`location`, `bin`, `supplier`), validate,
    then roll out the remaining 37.
- **Risk:** med–high — touches all 40 entities and the universal components. The
  pilot + per-entity verification contains it.

### Phase 4 — Generic AI entity tools + write safety

- **Goal:** AI/voice chat can create, update, and transition any of the 40 entities
  through the same validation contract the forms use.
- **Approach:**
  - Generic `createEntity` / `updateEntity` / `transitionEntity` tools driven by
    `EntityCore[name].formSchema`; replace the hand-coded per-entity write tools.
  - Consolidate the ~8 hand-written search tools into a `buildSearchTool()` factory.
  - **Write safety (resolved §9.4):**
    - **Authorization:** switch the chat route off the service-role client
      (`src/app/api/chat/route.ts:172`) to the **user's session**, so RLS enforces
      writes — plus tool-layer per-entity/per-action permission checks. Defense in
      depth.
    - **Confirmation:** **every write is confirmed** — the AI previews the
      create/update/transition and the user confirms before it executes.
- **Risk:** med — security-sensitive. Moving the chat route to a user-scoped client
  must be checked against the existing read tools (some may rely on RLS-bypass).
- **Tests:** explicit coverage for permission denial and the confirmation gate.

### Phase 2 — Reports consolidation

- **Goal:** shrink the four large report pages (`cogs` 1,552, `ttb` 794,
  `projections` 746, `inventory-valuation` 732 LOC).
- **Approach:**
  - Extract a shared report shell: `ReportHeader`, `ReportSummaryCard`,
    `DateRangeFilter`, `QueryResult` (loading/error/empty wrapper), `useDateRange`.
  - **Move aggregation into SQL (resolved §9.2): all three** — `cogs_by_period`,
    `cogs_by_sku`, and `batch_costing` become Supabase views / RPC functions. For
    each: a test compares the new SQL output against the current client
    calculation and must match exactly **before** the client code is deleted.
- **Risk:** low–med. Shell extraction is presentational (low). The SQL migration is
  medium — correctness of the ported calculation is the whole game.
- Migrations applied + verified **in the worktree only** — never on `main`.

### Phase 5 — Integrations cleanup

- **Goal:** collapse repetition in the third-party integration code.
- **Approach:**
  - QBO `syncEntity` factory — the `syncBill` / `syncCustomer` / `syncInvoice` /
    `syncSupplier` functions repeat a 6-step fetch→validate→build→call→log pattern
    (~200 LOC).
  - Consolidate the duplicated MongoDB / QBO sync-log helpers.
  - Audit the Square integration for dead/incomplete code (`square/inventory.ts`,
    `square/pricing.ts`).
- **Risk:** low–med.

## 6. Verification strategy

- **Gate for every commit:** `bun run typecheck`, `bun run test`, `bun run lint`
  all green.
- **Additional gate for phases that touch routes or the build:** `bun run build`.
- **Phase 2 migrations:** applied and verified in the worktree only — never on
  `main` (per repo policy).
- **Phase 3:** per-entity verification; pilot entities first.
- **Phase 4:** explicit tests for permission denial and the confirmation gate.

## 7. Out of scope / explicitly deferred

- Multi-organization / multi-tenancy — the app is one-org-per-deployment and that
  is sufficient.
- Removing the 293 knip-flagged unused *exports* — needs case-by-case review;
  many are intentional public API.
- Refactoring `prompt-input.tsx` (1,266 LOC) — no upstream package to adopt; hook
  extraction only, low priority.
- Build-time codegen for entity configs — considered and rejected (§Phase 3).

**`formatDate` standard (resolved §9.5):** in-app tables and planning views use a
**short date without the year** (e.g. `"May 19"`) with **`"—"`** as the
null/empty placeholder. Report pages keep their own explicit formats. The six
local `formatDate` definitions are consolidated to this standard in Phase 1.

## 8. Status

Phase 0 is **complete and committed** on `refactor/simplify-phase-0-1`:
~7,700 LOC removed, all checks green (PR #319). All §9 decisions are resolved;
the next step is `writing-plans` for Phase 1, then Phase 3.

## 9. Resolved decisions

1. **Roadmap ordering:** AI-first — execute **0 → 1 → 3 → 4 → 2 → 5**.
2. **Phase 2 SQL:** move **all three** aggregations (`cogs_by_period`,
   `cogs_by_sku`, `batch_costing`) into SQL, each test-verified byte-identical
   before client code is deleted.
3. **Phase 3 layout:** per-entity **directory**
   (`src/entities/<name>/{core.ts,presentation.tsx,index.ts}`).
4. **Phase 4 write safety:** **user-scoped client + RLS** plus tool-layer
   permission checks; **every write is confirmed** by the user before execution.
5. **`formatDate`:** short date **without year** + **`"—"`** null placeholder
   (§7).
