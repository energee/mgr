# UI rules (MUST FOLLOW)

Two rules every UI change must respect. Full reference in
[`docs/spec/architecture.md`](../spec/architecture.md) (DEC-007, DEC-008).

## DEC-007: Status display from entity configs

Never hardcode status colors, labels, or state arrays. Derive everything from
the entity's `stateMachine` config.

```typescript
// CORRECT — StatusBadge with entity config
import { StatusBadge } from "@/components/universal/status-badge";

<StatusBadge status={value} config={orderEntity.stateMachine?.stateDisplay} />

// CORRECT — derive state lists from config
const states = Object.keys(orderEntity.stateMachine?.states ?? {});
```

```typescript
// WRONG — hardcoded labels / colors / state arrays
const labels = { available: "Available" };
const colors = { draft: "bg-muted text-muted-foreground" };
const STATE_RANKS = ["draft", "confirmed", "scheduled", ...];
```

If you find yourself duplicating a status map, the entity config is missing a
`stateDisplay` entry — add it there.

## DEC-008: No empty strings in Select option values

Radix Select reserves `""` for "no selection". Using it as an option value
breaks the component.

```typescript
// WRONG
{ value: "", label: "All" }
```

For "All" filters, **don't add the option** — `entity-list.tsx` adds them
automatically.

For "None" / clear-selection, use a sentinel:

```typescript
// CORRECT
{ value: "_none", label: "None" }
```
