# REST API Layer

> Audited 2026-02-26. 34 route files, 44 handler methods.

## Architecture

MGR uses a **hybrid data access model**:

1. **PostgREST (Supabase client)** — Primary data layer. All entity CRUD from the frontend goes directly through the Supabase JS client. RLS policies enforce permissions at the database level.

2. **Next.js API routes** — Used for operations that need server-side logic: auth flows, integrations (OAuth, webhooks), AI chat streaming, operations that need the admin client, and entity CRUD exposed for external consumers.

3. **AI tooling** — Uses the authenticated user's Supabase client directly (PostgREST), NOT API routes. 32 tools defined in `src/app/api/chat/tools.ts` inherit RLS from the user session.

**Key principle:** PostgREST + RLS is the primary access control layer. API routes exist for operations that can't be done client-side, not as a wrapper around PostgREST.

## Infrastructure (`src/lib/api/`)

### Middleware

| Wrapper | Auth | Permission | Context Provided |
|---------|------|------------|------------------|
| `withAuth(handler)` | Session required (401) | None | `{ user, supabase, params }` |
| `withPermission(perm, handler)` | Session + role check (403) | Checked against `user_profiles.roles` | `{ user, supabase, params, roles, permissions }` |
| None | Route handles its own auth | N/A | N/A |

### Response Format

```typescript
// Success
successResponse(data)           // { data: T }
successResponse(data, meta)     // { data: T, meta: PaginationMeta }
paginatedResponse(data, page, perPage, total)

// Error
errorResponse(code, message, details?, status?)
// { error: { code, message, details? } }
```

### Error Codes (standard)

`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `INTERNAL_ERROR`

Postgres errors are auto-mapped: unique violation → 409, FK violation → 409, not-null → 422, check violation → 422.

### Validation

```typescript
validateBody(zodSchema, request)      // Parse JSON body, throw 422 on failure
validateParams(zodSchema, params)     // Validate route params
validateSearchParams(zodSchema, req)  // Validate URL query params
```

## Route Inventory

### Entity CRUD (standard pattern)

Only **batches** and **recipes** have full REST API routes. All other entities use PostgREST directly.

| Entity | List | Create | Read | Update | Delete | Permission |
|--------|------|--------|------|--------|--------|------------|
| Batches | GET `/api/batches` | POST `/api/batches` | GET `/api/batches/[id]` | PATCH `/api/batches/[id]` | DELETE `/api/batches/[id]` | `batches:read/write` |
| Recipes | GET `/api/recipes` | POST `/api/recipes` | GET `/api/recipes/[id]` | PATCH `/api/recipes/[id]` | DELETE `/api/recipes/[id]` | `recipes:read/write` |

PATCH and DELETE contracts:

- **PATCH is a field-update surface only.** `PATCH /api/batches/[id]` rejects a
  `status` field with `400 VALIDATION_ERROR`; batch state changes must go
  through `POST /api/batches/[id]/transfer`, which runs
  `transition_entity_atomic` so the status write and its side effects (vessel
  release, ingredient-allocation completion, loss reconciliation) share one
  transaction. Both PATCH routes apply only the fields the caller submitted —
  the request schemas drop the `.default()`s that would otherwise reset
  `batches.status`, `recipes.status`, and `recipes.is_active`.
- **DELETE returns `204 No Content`** with an empty body. `DELETE
  /api/recipes/[id]` still returns `409 CONFLICT` when batches reference the
  recipe.

### Specialized Operations

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/batches/[id]/transfer` | POST | `batches:write` | State transition with optimistic concurrency |
| `/api/orders/[id]/change-requests/[rid]/approve` | POST | `orders:write` | Approve order change request (RPC) |
| `/api/orders/[id]/change-requests/[rid]/reject` | POST | `orders:write` | Atomically reject a pending request scoped to the URL order |
| `/api/users/invite` | POST | `users:manage` | Invite user by email with roles |
| `/api/users/[id]` | DELETE | `users:manage` | Delete inactive user |
| `/api/customers/[id]/invite` | POST | `customers:write` | Invite customer to portal |

### AI & Chat

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/chat` | POST | Manual auth check | Streaming AI chat (Vercel AI SDK) |
| `/api/settings/api-key` | GET/POST | `settings:manage` | Manage Anthropic API keys |
| `/api/settings/api-key/test` | POST | `settings:manage` | Test stored API key |

### Integrations

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/slack/send` | POST | Custom (X-Slack-Secret) | Internal: pg_net → Slack webhook |
| `/api/slack/settings` | GET/PUT | `integrations:manage` | Slack configuration |
| `/api/slack/test` | POST | `integrations:manage` | Send test Slack message |
| `/api/square/sync` | POST | `integrations:manage` | Full Square catalog+inventory sync |
| `/api/square/sync/catalog` | POST | `integrations:manage` | Push catalog to Square |
| `/api/square/sync/inventory` | POST | `integrations:manage` | Push inventory to Square |
| `/api/square/sync/status` | GET/POST | `integrations:manage` | Square status + toggle |
| `/api/square/webhook` | POST | HMAC signature | Receive Square events |
| `/api/integrations/quickbooks/auth` | GET | `integrations:manage` | QBO OAuth URL; state bound to initiating user |
| `/api/integrations/quickbooks/callback` | GET | Manual auth + `integrations:manage` | QBO OAuth callback; rechecks initiating identity and permission |
| `/api/integrations/quickbooks/disconnect` | POST | `integrations:manage` | Revoke QBO tokens |
| `/api/integrations/quickbooks/status` | GET/POST | `integrations:manage` | QBO connection status |
| `/api/integrations/quickbooks/accounts` | GET/PUT | `integrations:manage` | QBO account mappings |
| `/api/integrations/quickbooks/sync` | POST | `integrations:manage` | Single entity sync |
| `/api/integrations/quickbooks/sync/retry` | POST | `integrations:manage` | Retry failed sync |
| `/api/integrations/quickbooks/sync-log` | GET | `integrations:manage` | Query sync log (500 `DB_ERROR` on a failed read — never an empty list) |

### System

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/auth/callback` | GET | None (public) | Supabase PKCE auth-code exchange |
| `/api/auth/confirm` | GET | None (public) | Supabase email token-hash exchange with same-origin redirect |
| `/api/health` | GET | None (public) | Health check |

## Known Inconsistencies

### 1. Non-standard error codes
~15 routes use error codes not in `ApiErrorCode`: `"BAD_REQUEST"`, `"INVALID_INPUT"`, `"DB_ERROR"`, `"INTEGRATION_DISABLED"`, `"SYNC_FAILED"`, `"CATALOG_SYNC_FAILED"`, `"CONFIGURATION_ERROR"`.

### 2. Raw response format
~10 routes return `NextResponse.json(...)` directly instead of `successResponse`/`errorResponse`. Clients see `{ hasKey, keyHint }` instead of `{ data: { hasKey, keyHint } }`.

Affected: settings API key routes, Slack settings/test, chat route, dev route.

### 3. Missing body validation
~12 routes skip `validateBody` for POST/PUT bodies, using `req.json()` with type assertions instead of Zod schemas.

### 4. Manual auth (justified)
- Chat route: needs streaming response format, not `NextResponse`
- QBO callback: OAuth redirect flow; manually enforces `integrations:manage`
- Slack send: called by pg_net, uses shared secret
- Square webhook: called by Square, uses HMAC

## Why Not More Entity CRUD Routes?

Adding REST routes for every entity (vessels, orders, customers, suppliers, etc.) would create **three-way drift**:

1. **Entity configs** (`src/entities/*.tsx`) — define fields, validation, state machines
2. **API routes** — would duplicate field lists, validation schemas, query logic
3. **AI tools** (`src/app/api/chat/tools.ts`) — define query patterns for the chat assistant

When an entity config changes (new field, modified state machine), all three locations need updating. Currently only entity configs + AI tools need to stay in sync. Adding a full REST layer doubles the maintenance surface.

**Recommendation:** Only add API routes for operations that:
- Need server-side logic (admin client, external API calls, streaming)
- Are consumed by external systems (webhooks, integrations)
- Require cross-entity transactions not possible via PostgREST

For standard entity CRUD, PostgREST + RLS is sufficient and stays in sync with the database schema automatically.
