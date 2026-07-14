# Beer order spreadsheet sync

Approved production workflow for reconciling spreadsheet-owned distributor orders from
`Beer orders.xlsx`. MongoDB is never consulted. Internal/taproom blocks are reported and
skipped, and spreadsheet orders missing from a later upload are reported without deletion.

## Tasks

1. **[SEQ] Track the feature and parser dependency.** Modify `docs/feature_list.json`,
   `package.json`, `bun.lock`, and `next.config.ts`; add and server-externalize
   `read-excel-file` for server-side `.xlsx` parsing. Acceptance:
   Bun resolves the dependency and F201 is the branch's only `in_progress` feature.
2. **[SEQ] Port and harden workbook parsing.** Create
   `src/integrations/beer-orders/{types,constants,parser}.ts` with `RawOrder`, `RawLine`,
   `PriceMatrix`, and normalization helpers. Support both historical layouts and the
   `Price Tiers` sheet, reject fractional quantities and malformed layouts, and report
   skipped internal blocks. Acceptance: parser Vitest coverage passes against generated
   fixtures and the current source workbook parses to 216 external orders / 1,205 lines.
3. **[SEQ] Build deterministic reconciliation planning.** Create
   `src/integrations/beer-orders/planner.ts` with `ImportPlan`, `PlannedOrder`, mapping,
   unresolved-item, summary, and reference-row types. Reuse approved aliases, stable UUIDv5
   identifiers, Distributor prices, Microstar keg ownership, draft-only creation, and
   preserved existing statuses. Acceptance: unit tests cover aliases, unresolved mappings,
   pricing, create/update/unchanged classification, and stale reporting without deletion.
4. **[SEQ] Add audited, atomic persistence.** Create migration
   `supabase/migrations/00250_beer_order_imports.sql` for `beer_order_import_runs`,
   `beer_order_customer_mappings`, and `beer_order_brand_mappings`, admin-only RLS,
   `_schema_registry` entries, and `apply_beer_order_import(uuid)`. The SECURITY INVOKER RPC
   locks and validates one server-authored preview, upserts approved customers/orders,
   replaces affected order items, and marks the run applied in one transaction. Acceptance:
   database security checks pass and stale orders are never deleted.
5. **[PAR after 3/4] Add preview, apply, and history APIs.** Create
   `src/app/api/integrations/beer-orders/{preview,apply,runs}/route.ts`; modify
   `src/lib/query-keys.ts`. Preview accepts a validated multipart file (4 MiB maximum),
   hashes it, persists a server-authored plan, and returns counts/unresolved mappings. Apply
   accepts only a preview run UUID and calls the atomic RPC. All routes require
   `integrations:manage`. Acceptance: route tests cover permission-safe validation, failed
   previews, immutable apply payloads, and surfaced database errors.
6. **[PAR after 3] Build the integration UI.** Create
   `src/components/domain/beer-orders/beer-order-sync-panel.tsx` and
   `src/app/(app)/settings/integrations/beer-orders/{layout,page}.tsx`; modify
   `src/app/(app)/settings/integrations/page.tsx`. The page provides upload, dry-run summary,
   saved mapping resolution, explicit apply confirmation, and history. Acceptance: component
   tests prove Apply remains disabled while mappings are unresolved and refreshes history
   after success.
7. **[SEQ after 5/6] Document the supported contract.** Modify
   `scripts/migration/README.md` and `docs/knowledge/entity-model.md` to identify the Settings
   integration as the normal path and the Python script as an emergency CLI. Correct stale
   MongoDB integration copy that still claims orders. Acceptance: docs explicitly state
   Mongo exclusion, internal-row skipping, and non-destructive stale handling.
8. **[SEQ] Verify end to end.** Run focused Vitest suites, `make check`,
   `make verify-feature ID=F201`, and use the browser verification workflow against the
   running application. Mark F201 `passing` only after the feature verifier exits zero.
9. **[SEQ] Land the work.** Add `docs/progress/2026-07-14-beer-order-spreadsheet-sync.md`,
   commit with a conventional subject, rebase, push `feat/beer-order-sync`, and open a stacked
   PR targeting `fix/repair-beer-orders` (PR #426). Acceptance: Git reports the branch fully
   pushed and the PR URL is recorded in the handoff.

## Dependency order

Tasks 1–4 are sequential because parsing and the server-authored plan define the database
contract. Tasks 5 and 6 may proceed in parallel after that contract is stable. Tasks 7–9 are
sequential gates. No automatic deletion or MongoDB fallback is in scope.
