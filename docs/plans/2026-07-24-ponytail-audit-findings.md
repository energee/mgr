# Ponytail over-engineering audit — candidate cuts (2026-07-24)

Repo-wide "what can we delete / de-over-engineer" sweep. 10 area-hunter agents +
knip completed; the **adversarial verification pass did not run** (hit the Fable 5
usage limit). So every item below is a HUNTER CANDIDATE, not yet confirmed.

> **STATUS 2026-07-25: verification pass complete.** See
> `docs/progress/2026-07-25-ponytail-audit-cuts.md` and the twelve commits on
> `chore/harness-gaps` (−6,147 lines, −4 deps). Items 1–4, 6, 7, 10–14, 25–29,
> 32–36, 38, 39, 40 (nanoid half), 42 and 43 were confirmed and cut. Rejected on
> verification: 35's `getYearOptions`, 11's `ConcurrentModificationError`, 28's
> `InventoryOverview` type, 38's `isTokenExpired` class, 41 (radix umbrella —
> `react-slot` resolves to two versions, so the swap is not behaviour-neutral),
> 44 (the streamdown plugins are capabilities, not bloat), 45 (the
> `src/lib/__tests__` suites are supersets of the `src/domain/__tests__` ones,
> not copies), 37's gravity half (different formulas — documented in place), 5
> (documented REST surface in docs/spec/api-layer.md, not accidental
> duplication), 30, 31 and 36 (all have live consumers, or are the tested seam
> for unit conversion). Also cut in the second pass: 8, 9, 16, 17, 20 and 31's
> `filterable`. Still open: 15, 18, 19, 21–24.

> **STATUS 2026-08-21: items 18, 19, 20 worked** (branch
> `refactor/ponytail-datatable-cuts`, scope limited to
> `src/components/data-table/`). See
> `docs/progress/2026-08-21-ponytail-datatable-cuts.md`. Net −4 lines.
>
> - **18 — mostly stale, one cut.** `debounceMs`/`shallow` props,
>   `TableMeta.queryKeys`, column-meta `placeholder`/`icon` and
>   `Option.icon`/`count` were **already absent** (the second pass took them;
>   `Option` is now just `{ label, value }`). The only survivor was the
>   `disabled` prop on `DataTableSortList` — no call site passed it. **Cut.**
>   `throttleMs: 50` in `data-table-filter-list.tsx` is **rejected**: nuqs'
>   default throttle is not a constant — `getDefaultThrottle()` returns 120ms
>   (Safari ≥17) or 320ms to stay under Safari's `history.replaceState` rate
>   limit — so removing the pin changes behaviour on Safari. `shallow: true` is
>   redundant only because `<NuqsAdapter>` sets no `defaultOptions`; left in
>   place as intent documentation, not configurability.
> - **19 — rejected, premise wrong.** There is no drag-to-reorder in the filter
>   popover; `data-table-filter-list.tsx` has no `Sortable`, grip handle or drag
>   overlay. The `Sortable`/`SortableOverlay`/`SortableItemHandle` usage is in
>   `data-table-sort-list.tsx`, where row order **is** multi-column sort
>   precedence — load-bearing semantics, not decoration. Nothing to cut.
> - **20 — rejected.** The "reserved for future use" `table` prop is already
>   gone (props are now plain `React.ComponentProps<"div">`). What remains is not
>   a no-op wrapper: it supplies `role="toolbar"` + `aria-orientation="horizontal"`
>   and the inner `flex-1 flex-wrap` track. It has one live consumer
>   (`entity-data-table.tsx:1218`) and is referenced as a landmark in
>   `entity-mobile-filter-sheet.tsx`. Inlining would also require editing
>   `src/components/universal/`, which was out of scope this session.
>
> Drag-kit deps stay: `@/components/ui/sortable` is still live via the sort list.
> Still open after this session: 15, 21–24.

> **STATUS 2026-08-21: universal-engine pass (items 15, 21–24).** See
> `docs/progress/2026-08-21-ponytail-universal-cuts.md` and the branch
> `refactor/ponytail-universal-cuts`. **Cut: 22 and 23** — both were rejected as
> "stale" in the 2026-07-25 third pass, and that rejection was wrong: it looked
> only *inside* `entity-data-table.tsx`, where each construct does appear once,
> and missed that the second copy lives in a sibling file. The empty-state JSX
> was byte-identical between `entity-data-table`'s `noResultsContent` and
> `entity-mobile-card-list`, and is now one `EntityEmptyState`; the
> bulk-transition intersection ran in `entity-data-table` *and*
> `bulk-status-action-bar`, verified to compute the same thing, and is now one
> exported `commonBulkTransitions`. Both gained focused tests; neither path had
> any, which is how the copies drifted apart unnoticed in the first place.
> **Already done: 15 and 21. Rejected: 24.**
> - **15 — already done (2026-07-25 third pass), and the remaining pair must
>   stay split.** `src/lib/utils.ts` is 15 lines (`cn`,
>   `getCurrentDateTimeLocal`) and contains neither helper; no `escapeLike`
>   exists anywhere in the tree. What remains is `escapeIlikePattern`
>   (`src/lib/supabase/query-helpers.ts`, escapes `` [\%_*] ``) and
>   `escapeLikePrefix` (`src/components/domain/order/reorder.ts`, escapes
>   `` [\%_] ``). The `*` difference is deliberate and documented at both sites:
>   escaping `*` makes a value fail CLOSED, which is right for an identity match
>   but wrong for the reorder probe, where an empty result makes
>   `nextDuplicateOrderNumber` hand back an order number that already exists.
>   Merging the two would be a correctness bug.
> - **21 — already done.** No `withEntityErrorBoundary` and no `onRetry` remain
>   in `entity-error-boundary.tsx`; both went in the first pass (dfe0f667,
>   #590). The item was stale, not actionable.
> - **24 — rejected, confirming the 2026-07-25 rejection independently.** The
>   two formatters are not equivalent.
>   `formatCardFieldValue` and `formatValue` differ in four user-visible ways:
>   `date` renders `"Jul 15, 2026"` vs `"7/15/2026"`; `datetime`
>   `"Jul 15, 2026 2:14 PM"` vs `"7/15/2026, 2:14:00 PM"`; null/empty renders
>   `"-"` vs `"—"`/`""`; and an unparseable date falls back to the raw string
>   vs `"Invalid Date"`. Not theoretical — the `order` and `batch` kanban
>   configs both use `format: "date"` (`order_date`, `requested_date`,
>   `planned_start_date`), so the swap would restyle every kanban card date.
>   Left in place: unifying it is a deliberate design change, not a dedup.

**Next session: verify each candidate before cutting.** For each, ref-count with
`rg` and check the registry (`src/entities/index.ts`, `src/entities/cores.ts`),
entity presentation configs, `z.infer` usage, `Makefile`, `.github/workflows`,
`package.json` scripts, and docs. If genuinely dead → cut. Group into small
typed commits (`refactor:`/`chore:`), run `make check` between groups.

Hunt areas that DID NOT complete (re-run these): `src/components/rest`,
`automation` (scripts/Makefile/workflows), `meta` (root config + docs + agents),
`knip`. These may surface more.

## Ranked candidates (biggest cut first)

### Big deletes (whole modules / features)
1. **delete** `src/services/transition-side-effects.ts` — deprecated module + its 1547-line test (~2313 lines). Superseded by `transition_entity_atomic` RPC (migration 00256). [src/services/transition-side-effects.ts]
2. **delete** entire Resend email stack — client wrapper, 3 HTML template builders, admin-only `/api/email/send` route + test (~901 lines, −1 dep `resend`?). Prod email flows DB trigger → `dispatch_email_notification()` → pg_net → `supabase/functions/send-email` edge fn (plain fetch, no npm dep). Verify `resend` isn't imported elsewhere before dropping dep. [src/integrations/email.ts, src/app/api/email/send/route.ts]
3. **delete** unused water-chemistry surface: `COMMON_PROFILES`, `STYLE_TARGETS`, `calculateResidualAlkalinity`, `estimateMashPH`, `getIonRecommendations` (~360 lines). Sole app importer uses only the salt-addition path. [src/domain/water-chemistry.ts]
4. **delete** unreachable numeric range-filter chain: `DataTableRangeFilter`, number/range variants, `numericOperators`, `isRelativeToToday` (~150 lines). No entity filter def uses `type: number/range`. [src/components/data-table/data-table-range-filter.tsx]

### App routes & pages
5. **delete** REST CRUD routes for recipes + batches (list/create/read/update/delete + batch transfer) — duplicate PostgREST/RLS access the client already uses. [src/app/api/recipes, src/app/api/batches]
6. **delete** `/api/dev/confirm-user` — dev route for a self-signup flow that no longer exists (signup is invite-only magic link; e2e uses `/api/auth/dev-login`). [src/app/api/dev/confirm-user/route.ts]
7. **delete** `/api/integrations/quickbooks/sync/batch` bulk-sync route nothing calls — hand-rolled 600ms rate-limit sleep loop + a third copy of the `SYNC_FUNCTIONS` map. UI uses `/sync` (single) and `/sync/retry`. [src/app/api/integrations/quickbooks/sync/batch/route.ts]
8. **yagni** 9 near-identical error boundaries — `(app)/error.tsx` is a 49-line copy of `RouteError`; 8 domain `error.tsx` files only pass a domain-name string. Collapse to one. [src/app/(app)/error.tsx]
9. **shrink** 55 metadata-only pass-through `layout.tsx` files (~19 lines each) → the 5-line compact form already used at `reports/projections/layout.tsx`. [src/app]

### src/lib
10. **delete** dead error classes/type-guards/wrapper in errors.ts (~89 lines) — keep `parseUnknownError`, `parsePostgresErrorDetailed`, `CONSTRAINT_MESSAGES`, `PG_ERROR_CODES`. [src/lib/errors.ts]
11. **delete** `updateWithOptimisticLockOrThrow` + `ConcurrentModificationError` (0 refs; keep `updateWithOptimisticLock`). [src/lib/optimistic-lock.ts]
12. **delete** unused 11-field `totals` param on both TTB print functions (`generateTTBPrintHTML`, `openTTBPrintView`) + call site. [src/lib/report-export.ts]
13. **delete** column-pinning style machinery computed for every header/cell of every table (no entity pins columns). [src/lib/data-table.ts]
14. **yagni** 27-key `ENUM_TYPES` map, one consumer uses 2 keys — inline the two literals, delete file. [src/lib/enums.ts → src/hooks/use-brew-enums.ts]
15. **shrink** two hand-rolled LIKE-escape helpers (`escapeLike` / `escapeIlikePattern`) → one. [src/lib/utils.ts]

### Universal component engine
16. **delete** `EntityDetailUnified` props no page passes: `backUrl`, `showEdit`, `disabledFields` (threaded through 7 components). [src/components/universal/entity-detail-unified.tsx]
17. **delete** `filters` prop (`propFilters`) plumbing through the whole list-query stack. [src/components/universal/list-query-options.ts]
18. **delete** dead configurability on vendored filter/sort components: `debounceMs`/`throttleMs`/`shallow`/`disabled` props, `TableMeta.queryKeys`, column-meta `placeholder`/`icon`, `Option.icon`/`count`. [src/components/data-table/data-table-filter-list.tsx]
19. **delete** drag-to-reorder of filter rows (Sortable wrapper, per-row grip, drag overlay) in the filter popover. [src/components/data-table/data-table-filter-list.tsx]
20. **yagni** `DataTableAdvancedToolbar` — whole file wraps one div; `table` prop is "reserved for future use". [src/components/data-table/data-table-advanced-toolbar.tsx]
21. **delete** `withEntityErrorBoundary` HOC + `EntityErrorBoundary` `onRetry` prop (unused). [src/components/universal/entity-error-boundary.tsx]
22. **shrink** empty-state JSX duplicated verbatim between desktop `noResultsContent` and mobile card list. [src/components/universal/entity-data-table.tsx]
23. **shrink** common-bulk-transition intersection algorithm implemented twice. [src/components/universal/entity-data-table.tsx]
24. **shrink** `entity-kanban` private `formatCardFieldValue` re-implements `lib/format` `formatValue`. [src/components/universal/entity-kanban.tsx]

### Entities / services / types
25. **delete** `queryExamples` AI-metadata field defined by 38 entity cores (nobody reads it). [src/entities]
26. **delete** 194 `sortable: true` lines restating the consumer's default. [src/entities]
27. **delete** required `EntityCore.description` field ("Brief description for AI context") nobody reads. [src/entities, src/types/entity.ts]
28. **delete** `inventoryService.getOverview` + `InventoryOverview` type (0 prod callers). [src/services/inventory-service.ts]
29. **delete** `stateMachine.hooks.validate` machinery for hooks no entity defines. [src/services/entity-service.ts]
30. **yagni** `EntityRelationDef.showInDetail` — derivable from `detailTab` presence. [src/types/entity.ts]
31. **yagni** dead entity-type knobs: `EntityColumnDef.filterable`, `editable:"create-only"`, `TransitionFieldDef` `"text"`/`"select"`/`dynamicOptions` variants. [src/types/entity.ts]

### src/domain
32. **delete** never-called yeast estimators: `estimateCellsFromPackage`, `estimateCellsFromSlurry` (+`SLURRY_CELLS_BILLION_PER_ML`), `estimateHarvestVolume`, `estimatePostHarvestViability`, `CellCountEstimate`. [src/domain/yeast-calculations.ts]
33. **delete** `getDemandSummary()` — aggregate no page/service calls. [src/domain/purchasing/demand-calculator.ts]
34. **delete** `createDraftPOFromShortfall()` — fully dead, not even a test refs it. [src/domain/purchasing/po-generator.ts]
35. **delete** dead ttb-utils exports: `bblToGallons`, `gallonsToBbl`, `sumBatchVolumes`, `getYearOptions`. [src/domain/ttb-utils.ts]
36. **shrink** 8 one-line unit-wrapper exports (`parseVolumeInput`, `volumeToDisplay`, `parseRetailVolumeInput`, `parseWeightInput`, `weightToDisplay`, `parseTemperatureInput`, `parseGravityInput`, `formatRetailVolume`). [src/domain/units.ts]
37. **shrink** duplicate gravity/temp converters — `batch-readings.ts` has its own `convertGravity`/`convertTemperature` parallel to `units.ts`. Note: formulas differ (Lincoln vs ASBC cubic) — verify which is canonical before merging. [src/domain/batch-readings.ts]

### Integrations
38. **delete** dead half of `quickbooks/token-manager.ts`: a second full `refreshAccessToken` + `saveClientCredentials` + `isTokenExpired`. [src/integrations/quickbooks/token-manager.ts]
39. **delete** `square/utils.ts` exports orphaned by the webhook's move to `ingest_square_sale_atomic` RPC: `buildSquareDraftSaleInsert`, `SquareDraftSaleInsert`, `STANDARD_POUR_OZ`, `calculateVolumeOz`. Keep only `dollarsToCents`, inline into `pricing.ts` (its sole consumer), kill the file. [src/integrations/square/utils.ts]

### Dependencies (verify import counts, then drop)
40. **stdlib** three ID libs installed — `uuid` (2 sites) + `nanoid` (2 sites) + `crypto.randomUUID` already in use. Move nanoid sites to `crypto.randomUUID()`; uuid-v5 sites to a ~15-line `node:crypto` sha1 helper. −2 deps. [src/lib/id.ts]
41. **shrink** 9 individual `@radix-ui/react-*` packages duplicate the already-installed `radix-ui` umbrella — switch ~10 files to named imports from `radix-ui`, drop the 9 deps. [package.json]
42. **stdlib** `@testing-library/jest-dom` carried for 3 matcher calls in 2 test files → plain vitest expects. −1 dep. [src/test/setup.ts]
43. **native** `dotenv-cli` used by a single package.json script → Bun's automatic `.env` loading or inline `set -a; . ./.env`. −1 dep. [package.json]
44. **yagni** AI-chat markdown plugins — `@streamdown/mermaid`, `@streamdown/math`, `@streamdown/cjk` each 1 import site; keep `code` (syntax highlight), drop the other three. −3 deps. Verify chat never renders diagrams/math. [src/components/ai-elements/message.tsx]

### Tests
45. **delete** duplicate test suites in `src/lib/__tests__` (units, water-chemistry, consumption-planning, inventory-units) that also exist in `src/domain/__tests__`. Verify they're true copies, not testing different modules. [src/lib/__tests__]
