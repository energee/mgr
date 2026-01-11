# API Structure

## API Routes (Next.js App Router)

```
app/
├── api/
│   ├── auth/
│   │   └── [...supabase]/route.ts
│   ├── batches/
│   │   ├── route.ts (GET list, POST create)
│   │   ├── [id]/route.ts (GET, PATCH, DELETE)
│   │   ├── [id]/readings/route.ts
│   │   ├── [id]/additions/route.ts
│   │   └── [id]/transfer/route.ts
│   ├── recipes/
│   │   ├── route.ts
│   │   ├── [id]/route.ts
│   │   └── [id]/clone/route.ts
│   ├── packaging/
│   │   ├── sessions/route.ts
│   │   ├── sessions/[id]/route.ts
│   │   └── sessions/[id]/complete/route.ts
│   ├── inventory/
│   │   ├── finished-goods/route.ts
│   │   ├── bins/route.ts
│   │   ├── transfers/route.ts
│   │   └── kegs/route.ts
│   ├── orders/
│   │   ├── route.ts
│   │   ├── [id]/route.ts
│   │   ├── [id]/allocate/route.ts
│   │   └── [id]/fulfill/route.ts
│   ├── purchasing/
│   │   ├── pos/route.ts
│   │   ├── pos/[id]/route.ts
│   │   ├── pos/[id]/receive/route.ts
│   │   └── generate/route.ts
│   ├── reports/
│   │   ├── ttb/route.ts
│   │   ├── projections/route.ts
│   │   └── cogs/route.ts
│   └── webhooks/
│       └── qbo/route.ts
```

## API Response Format

```typescript
// Success
{
  data: T,
  meta?: {
    page?: number,
    per_page?: number,
    total?: number
  }
}

// Error
{
  error: {
    code: string,
    message: string,
    details?: any
  }
}
```

## Authentication

All API routes (except webhooks) require authentication:

```typescript
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export async function GET(request: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  // Check user roles for authorization
  const { data: userData } = await supabase
    .from('users')
    .select('roles')
    .eq('id', user.id)
    .single();

  if (!userData || !hasRequiredRole(userData.roles, requiredRoles)) {
    return Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  }

  // ... rest of handler
}
```

---

## Related Documents

- [Auth](./auth.md) - Roles and permissions
- [Architecture](./architecture.md) - Tech stack
- [Workflows](./workflows.md) - Error handling patterns
