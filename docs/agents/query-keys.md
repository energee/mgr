# Query keys (MUST FOLLOW)

All React Query cache keys MUST come from factory functions in
[`src/lib/query-keys.ts`](../../src/lib/query-keys.ts). No exceptions —
including portal queries, one-off queries, and any `useQuery` call.

## CORRECT

```typescript
import { entityKeys, dashboardKeys } from "@/lib/query-keys";

useQuery({
  queryKey: entityKeys.list("batches", filters),
  // ...
});

useQuery({
  queryKey: dashboardKeys.batchCounts(),
  // ...
});
```

## WRONG

```typescript
// Hardcoded array — no.
useQuery({
  queryKey: ["batches", "list", filters],
  // ...
});
```

## Available factories

- `entityKeys` — generic CRUD operations (list, detail, options)
- `batchRecordInvalidationKeys(id)` — every cache the batch record lives in
  (domain detail key + the `batches_with_brew_info` view). Loop-invalidate
  these after any batch mutation; `batchKeys.detail` alone misses the
  unified detail page, which caches under the entity's `viewTable` key
  (issue #560). Same rule applies to any entity with a `viewTable`:
  invalidate the view key, not just the base table.

  **This rule is enforced.** `src/lib/__tests__/entity-key-table-names.test.ts`
  scans `src/` and fails CI when either:
  (a) an `entityKeys.*` call names a string that is not a real entity table or
  view — a key no query can ever match (this is how `entityKeys.all("user_profile")`,
  the entity *name* rather than the `user_profiles` table, went unnoticed); or
  (b) an `invalidateQueries` names the base table of an entity that has a
  `viewTable` without also invalidating the view in the same file.
  If it fails, fix the call site; only extend `NON_ENTITY_RELATIONS` when the
  name really is a relation with no entity config.

  Mutations that write an entity table *outside* `entityService` must hand-roll
  this pair — derive both names from the entity core
  (`entityKeys.all(inventoryLotCore.table)` / `…viewTable`) rather than typing
  literals, so a view rename cannot desynchronize them (issue #615).
- `dashboardKeys` — dashboard metrics and summaries
- `notificationKeys` — user notifications
- `catalogKeys` — catalog / lookup data
- `recipeKeys`, `batchKeys`, `orderKeys` — domain-specific queries

When adding new queries, add a factory to `src/lib/query-keys.ts` first, then
use it. Never inline a query key array.

## Why

Centralized factories keep cache invalidation correct. If a key string changes,
all consumers update; if a query is added without a factory, invalidation in
mutations will silently miss it.
