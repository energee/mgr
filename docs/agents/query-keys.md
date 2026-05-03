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
