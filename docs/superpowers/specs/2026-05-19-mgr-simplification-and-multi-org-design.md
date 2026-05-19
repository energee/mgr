# MGR Simplification & White-Label Readiness — Design Spec

**Date:** 2026-05-19
**Status:** Draft — awaiting user review
**Branch:** `refactor/simplify-phase-0-1`

---

## 1. Context & goals

`mgr` is a brewery-management app (Next.js 16 App Router + Supabase + React Query +
TypeScript). At the start of this effort it was ~139k LOC across 737 TS/TSX files
(~129k hand-written, excluding the 9,950-line generated `src/types/supabase.ts`),
40 entities, 151 migrations.

The user asked for three things:

1. **Meaningfully reduce lines of code** — eliminate unnecessary logic, duplication,
   and reinvention while keeping functionality stable.
2. **Make the codebase usable by multiple organizations.**
3. **Let the AI/voice chat interact with every entity the same way the forms do** —
   create/update entities through chat without reinventing the form interface.

## 2. Key framing decisions (already made with the user)

- **Deliverable model:** Analysis → plan → execute, in reviewable phases.
- **Risk tolerance:** Aggressive — architecture and dependency changes are in scope.
- **Tenancy model: one deployment per organization (white-label).** Each org gets
  its own deployment and its own Supabase project. "Multi-org" therefore means
  *configurability and brand-ability per deployment* — **not** shared-DB SaaS
  multi-tenancy. This is decisive: it removes a 12–15 week tenancy re-introduction
  (no `org_id` columns, no RLS rewrite) and makes the multi-org goal *align* with
  simplification instead of fighting it.
- **Sequencing:** Approach A — low-risk, high-LOC wins first; the entity-system
  refactor (highest risk) is backloaded behind a solid verification baseline.

### 2.1 The multi-tenant history

The codebase **was** multi-tenant and the team deliberately removed it:
`supabase/migrations/00002_single_tenant.sql` dropped the `breweries` and
`user_breweries` tables and replaced them with singleton settings rows (hardcoded
UUID `00000000-0000-0000-0000-000000000001`). The white-label model embraces that
single-tenant decision rather than reversing it.

## 3. Survey findings (five parallel read-only surveys)

| Area | Finding | LOC opportunity |
|---|---|---|
| Whole-repo | 31 dead files, 2 dead deps, 293 unused exports, `if (error) throw` repeated ~228× | 1,000–9,000 |
| Entity system | 40 configs, ~73% boilerplate; "universal" components are genuinely clean (near-zero entity special-casing); a `_schema_registry` table already exists | 4,000–8,000 |
| Reports | Heavy client-side aggregation that belongs in SQL; repeated report scaffolding | 950–1,600 |
| AI chat & integrations | `tools.ts` search tools repeat a query+schema+error pattern ~8×; `entity-map.ts` duplicates ~38 entity definitions; QBO sync functions repeat a 6-step pattern | 800–1,200 |
| Multi-org | App is committed to single-tenant; for white-label the per-org config surface is *already* mostly in singleton DB tables (settings, system_settings, square_settings, branding, TTB permits, pricing) | n/a (audit, not LOC) |

### 3.1 The convergence

The single most valuable refactor — splitting entity configs into a **server-safe
core** and a **client-only presentation layer** — pays off three times:

1. **Kills duplication.** `src/app/api/chat/entity-map.ts` (412 LOC) exists *only*
   because `src/entities/*.tsx` are React modules that cannot be imported
   server-side. A server-safe core makes `entity-map.ts` redundant.
2. **Unlocks generic AI writes.** Entity configs already export `formSchema` (zod,
   36/39). The form persist path is trivial: zod-validate → `.insert`/`.update`.
   Once the schema is reachable server-side, one generic `createEntity` /
   `updateEntity` / `transitionEntity` tool — driven by `core[name].formSchema` —
   replaces every hand-coded write tool and covers all 40 entities. Forms and chat
   then share **one** validation contract.
3. **Creates the white-label seam.** The core/defaults layer is the natural place
   to inject per-deployment theming and configuration.

## 4. Guiding principles

1. **Behavior-preserving by default.** Every phase ends green on `bun typecheck`,
   `bun run test`, `bun run lint`. No user-facing behavior change unless explicitly
   called out and approved.
2. **Risk backloaded, value frontloaded.** Safe, high-LOC wins ship first.
3. **Each phase is independently shippable** — its own plan, its own PR(s), its own
   merge. Work can stop after any phase.
4. **Convergence over addition.** The entity refactor is the hinge — one piece of
   work, three payoffs (§3.1).
5. **knip is the dead-code authority.** A `knip.json` is now committed; future
   dead-code passes run `bun run knip`.

## 5. The phased roadmap

| Phase | Name | Risk | Est. LOC Δ | Unlocks |
|---|---|---|---|---|
| 0 | Verification baseline + dead-code removal | low | **−7,700 (done)** | safety net |
| 1 | Shared data-access helpers | low–med | −700 to −1,500 | — |
| 2 | Reports consolidation | low–med | −950 to −1,600 | — |
| 3 | Entity config core/presentation split | med–high | −4,000 to −6,000 | Phases 4 & 5 |
| 4 | Generic AI entity tools + write safety | med | −300 to −500 net | AI/voice CRUD |
| 5 | White-label hardening + integrations cleanup | low–med | −400 to −800 | per-org deploys |

Net target: **~9,000–12,000 LOC removed.** Phase 0 is complete (see §8).

### Phase 0 — Verification baseline + dead-code removal ✅ DONE

- Established green baseline: typecheck 0, lint 0, **1,116 tests pass**.
- Removed 2 unused dependencies (`media-chrome`, `@xyflow/react`) + dead `panel.tsx`.
- Removed **31 dead files (~7,693 LOC)** — verified via knip's transitive
  import-graph plus independent import-path greps.
- Added `knip.json` + `knip` script so dead-code detection is reliable.
- **Not done autonomously, deferred to review:** 293 unused *exports* (too granular
  to remove unreviewed — many are intentional public API surface); `formatDate`
  consolidation (the 6 local definitions produce genuinely different output, so
  consolidation is not behavior-preserving without a product decision — see §7).

### Phase 1 — Shared data-access helpers

- **Goal:** remove the ~228 repetitions of `const { data, error } = await …; if
  (error) throw error; return data;`.
- **Approach:** add `src/lib/supabase/query-helpers.ts` exporting `unwrap()` (and a
  maybe-variant). Roll out in bounded batches by directory, each batch verified
  green. The transformation is mechanically identical → the test suite is the gate.
- **Also:** merge the `format.ts` / `utils.ts` `formatValue` overlap; inline
  single-use hooks (`use-as-ref`, `use-callback-ref`). Each requires a behavior
  check before landing.
- **Risk:** low–med. The bulk rollout touches 100+ files — mechanical but broad;
  land it as several small PRs, not one.

### Phase 2 — Reports consolidation

- **Goal:** shrink the four large report pages (`cogs` 1,552, `ttb` 794,
  `projections` 746, `inventory-valuation` 732 LOC).
- **Approach:**
  - Extract a shared report shell: `ReportHeader`, `ReportSummaryCard`,
    `DateRangeFilter`, `QueryResult` (loading/error/empty wrapper), `useDateRange`.
  - Move heavy client-side aggregation (COGS by-period, COGS by-SKU, batch costing,
    proportional cost allocation) into Supabase SQL views / RPC functions.
- **Risk:** low–med. The shell extraction is purely presentational (low). The SQL
  migration is medium — the SQL must reproduce the client calculation exactly;
  needs migrations and verification in the worktree.
- **Decision required:** which aggregations move server-side (all, or only the
  heaviest).

### Phase 3 — Entity config core/presentation split (the keystone)

- **Goal:** eliminate ~73% boilerplate across 40 entity configs **and** make entity
  metadata reachable server-side.
- **Approach:**
  - Define `EntityCore` (server-safe, pure data: `table`, `formSchema`, field
    metadata, state machine, relations) and `EntityPresentation` (client-only:
    column renderers, section components, dialogs).
  - Add a `createEntityConfig()` helper: smart defaults + per-entity overrides.
    Plain TypeScript — **no build-time codegen** (codegen was considered and
    rejected: it adds a generated layer that is harder to debug for marginal extra
    savings).
  - `src/app/api/chat/entity-map.ts` is deleted; the core registry replaces it.
  - **Pilot** on 2–3 simple entities (`location`, `bin`, `supplier`), validate,
    then roll out the remaining 37.
- **Risk:** med–high — touches all 40 entities and the universal components. The
  pilot + per-entity verification contains it.
- **Decision required:** sign-off on the `EntityCore` / `EntityPresentation` type
  boundary (a detailed proposal accompanies the Phase 3 plan).

### Phase 4 — Generic AI entity tools + write safety

- **Goal:** AI/voice chat can create, update, and transition any of the 40 entities
  through the same validation contract the forms use.
- **Approach:**
  - Generic `createEntity` / `updateEntity` / `transitionEntity` tools driven by
    `EntityCore[name].formSchema`; replace the hand-coded per-entity write tools.
  - Consolidate the ~8 hand-written search tools into a `buildSearchTool()` factory.
  - **Write safety** — the chat route currently runs with a **service-role client
    that bypasses RLS** (`src/app/api/chat/route.ts:172`). Generic writes therefore
    need an explicit application-level layer: (a) per-entity/per-action permission
    checks, (b) a confirmation gate so a mutation is previewed and confirmed before
    execution (especially important for voice).
- **Risk:** med — security-sensitive. The permission model and confirmation UX are
  user decisions.
- **Decisions required:** the write-authorization model; the confirmation UX.

### Phase 5 — White-label hardening + integrations cleanup

- **Goal:** a fresh deployment can be stood up cleanly for a new organization.
- **Approach:**
  - Audit hardcoded single-org assumptions: hardcoded UUIDs
    (`…0001`, `…0002`), branding, env-coupled config.
  - Ensure a clean bootstrap/seed path for a new deployment; document it.
  - Centralize per-org config access (theming seam from Phase 3).
  - Integrations cleanup: QBO `syncEntity` factory (~200 LOC), consolidate the
    MongoDB/QBO sync-log helpers, audit the Square integration for dead code.
- **Risk:** low–med.
- **Decision required:** what is genuinely per-org configurable vs build-time fixed.

## 6. Verification strategy

- **Gate for every commit:** `bun run typecheck`, `bun run test`, `bun run lint`
  all green.
- **Additional gate for phases that touch routes or the build:** `bun run build`.
- **Phase 2/5 migrations:** applied and verified in the worktree only — never on
  `main` (per repo policy).
- **Phase 3:** per-entity verification; pilot entities first.
- **Phase 4:** explicit tests for permission denial and the confirmation gate.

## 7. Out of scope / explicitly deferred

- Shared-DB SaaS multi-tenancy (`org_id` columns, RLS rewrite) — excluded by the
  white-label decision.
- Removing the 293 knip-flagged unused *exports* — needs case-by-case review;
  many are intentional public API.
- `formatDate` consolidation — the 6 local definitions differ in output (year vs
  no-year; `"-"` vs `"—"` vs `""` null placeholder). Consolidation needs a product
  decision (standard date format + null placeholder), then it is a ~10-minute
  change. Listed for review.
- Refactoring `prompt-input.tsx` (1,266 LOC) — no upstream package to adopt; hook
  extraction only, low priority.
- Build-time codegen for entity configs — considered and rejected (§Phase 3).

## 8. Status at time of writing

Phase 0 is **complete and committed** on `refactor/simplify-phase-0-1`:
~7,700 LOC removed, all checks green. Phases 1–5 await user review of this spec and
per-phase planning.

## 9. Open decisions for the user

1. Approve the 6-phase roadmap and ordering.
2. Phase 2: which report aggregations move into SQL.
3. Phase 3: sign off on the `EntityCore` / `EntityPresentation` type boundary.
4. Phase 4: the AI write-authorization model and confirmation UX.
5. Phase 5: the per-org configuration surface.
6. `formatDate`: the standard date format and null placeholder (§7).
