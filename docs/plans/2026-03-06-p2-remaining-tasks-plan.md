# P2 Remaining Tasks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the final 2 open P2 tasks — CI vulnerability scanning on PRs and full mobile-responsive redesigns for Gantt timeline, pricing matrix, and data tables.

**Architecture:** Task 30 is a CI config change. Task 34 adds responsive mobile layouts below the `md` (768px) breakpoint using the existing `useIsMobile()` hook. Each component gets a dedicated mobile view that conditionally renders alongside the desktop view. Task 35 (brew event aria-labels) was verified as already complete.

**Tech Stack:** GitHub Actions YAML, React/TypeScript, Tailwind CSS, existing `useIsMobile()` hook from `src/hooks/use-mobile.ts`.

---

## Task 1: CI Vulnerability Scanning on PRs

**Files:**
- Modify: `.github/workflows/test.yml`

**Step 1: Fix merge conflict and add audit step to quality job**

The file has merge conflict markers starting at line 49. Fix by:
1. Removing the conflict markers (`<<<<<<< HEAD`, `=======`, `>>>>>>> ...`)
2. Keeping the e2e job content
3. Adding `pnpm audit` as the final step in the `quality` job (not just e2e)

```yaml
# Add after the Build step (line 47) in the quality job:
      - name: Check for dependency vulnerabilities
        run: pnpm audit --audit-level=high
        continue-on-error: true
```

The e2e job should also be kept intact (lines 50-93) with its own audit step removed (since quality job now handles it).

**Step 2: Verify YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))"`
Expected: No error output

**Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add dependency vulnerability scanning to PR quality checks"
```

---

## Task 2: Mobile Card View for Data Tables

This is the highest-impact task — it affects every entity list page. Build this first so the pattern is established.

**Files:**
- Create: `src/components/universal/entity-mobile-card-list.tsx`
- Modify: `src/components/universal/entity-data-table.tsx`

**Step 1: Create `entity-mobile-card-list.tsx`**

This component renders entity data as stacked cards on mobile. It reads `listColumns` from the entity config to determine which fields to show.

```tsx
"use client";

/**
 * Mobile Card List for Entity Data
 *
 * Renders entity rows as tappable cards on mobile (< md breakpoint).
 * Shows the first 3 listColumns from entity config: typically name, status, date.
 * Tapping a card navigates to the detail page.
 */

import Link from "next/link";
import type { EntityConfig, EntityColumnDef } from "@/types/entity";
import { StatusBadge } from "@/components/universal/status-badge";
import { cn } from "@/lib/utils";
import { format as formatDate } from "date-fns";
import { Search, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EntityMobileCardListProps<T = Record<string, unknown>> {
  entity: EntityConfig<T>;
  data: T[];
  basePath: string;
  showCreate?: boolean;
  onCreateClick?: () => void;
  hasActiveFilters?: boolean;
}

/**
 * Format a cell value for display in a mobile card.
 * Handles dates, numbers, currency, and falls back to string conversion.
 */
function formatValue(value: unknown, col: EntityColumnDef<unknown>): string {
  if (value == null || value === "") return "—";

  switch (col.format) {
    case "date":
      return formatDate(new Date(value as string), "MMM d, yyyy");
    case "datetime":
      return formatDate(new Date(value as string), "MMM d, yyyy h:mm a");
    case "currency":
      return `$${Number(value).toFixed(2)}`;
    case "number":
      return Number(value).toLocaleString();
    case "percentage":
      return `${Number(value).toFixed(1)}%`;
    default:
      return String(value);
  }
}

export function EntityMobileCardList<T = Record<string, unknown>>({
  entity,
  data,
  basePath,
  showCreate = true,
  onCreateClick,
  hasActiveFilters = false,
}: EntityMobileCardListProps<T>) {
  // Take the first 3 listColumns for card display
  const displayColumns = entity.listColumns.slice(0, 3);

  // Find the status column (if entity has a state machine)
  const stateField = entity.stateMachine?.stateField;
  const stateDisplay = entity.stateMachine?.stateDisplay;

  // Determine the "title" column — first column, or detailHeader.title
  const titleField = (entity.detailHeader?.title ?? displayColumns[0]?.accessorKey ?? "name") as string;

  // Remaining columns after title (for subtitle area)
  const subtitleColumns = displayColumns.filter(
    (col) => col.accessorKey !== titleField
  );

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        {hasActiveFilters ? (
          <Search className="size-10 text-muted-foreground/30" />
        ) : (
          <Inbox className="size-10 text-muted-foreground/30" />
        )}
        <div className="text-muted-foreground text-center">
          {hasActiveFilters ? (
            <>
              <p className="font-medium">
                No matching {entity.displayNamePlural.toLowerCase()}
              </p>
              <p className="text-sm">Try adjusting your search or filters</p>
            </>
          ) : (
            <>
              <p className="font-medium">
                No {entity.displayNamePlural.toLowerCase()} yet
              </p>
              <p className="text-sm">
                Get started by creating your first{" "}
                {entity.displayName.toLowerCase()}
              </p>
            </>
          )}
        </div>
        {showCreate && !hasActiveFilters && (
          <>
            {onCreateClick ? (
              <Button size="sm" onClick={onCreateClick}>
                Create {entity.displayName}
              </Button>
            ) : (
              <Button size="sm" asChild>
                <Link href={`${basePath}/new`}>
                  Create {entity.displayName}
                </Link>
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((row) => {
        const record = row as Record<string, unknown>;
        const id = record.id as string;
        const title = record[titleField];
        const status = stateField ? (record[stateField] as string) : null;

        return (
          <Link
            key={id}
            href={`${basePath}/${id}`}
            className={cn(
              "block rounded-lg border bg-card p-3 transition-colors",
              "active:bg-muted/50 hover:bg-muted/30"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">
                  {title != null ? String(title) : "—"}
                </div>
                {subtitleColumns.length > 0 && (
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    {subtitleColumns.map((col) => {
                      const key = col.accessorKey as string;
                      // Skip status field in subtitle — it's shown as a badge
                      if (key === stateField) return null;

                      const value = record[key];
                      if (col.render) {
                        return (
                          <span key={key} className="truncate">
                            {col.render(value, row)}
                          </span>
                        );
                      }
                      return (
                        <span key={key} className="truncate">
                          {formatValue(value, col as EntityColumnDef<unknown>)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              {status && stateDisplay && (
                <StatusBadge
                  status={status}
                  stateDisplay={stateDisplay}
                />
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
```

**Step 2: Integrate into entity-data-table.tsx**

In `src/components/universal/entity-data-table.tsx`, add the mobile card list as an alternative view when `useIsMobile()` returns true.

At the top of the file, add imports:
```tsx
import { useIsMobile } from "@/hooks/use-mobile";
import { EntityMobileCardList } from "./entity-mobile-card-list";
```

Inside the `EntityDataTable` component, after the existing hooks (around line 106), add:
```tsx
const isMobile = useIsMobile();
```

Then in the render section (around line 693), wrap the `DataTable` rendering to conditionally show the mobile card list. Replace the `DataTable` block with:

```tsx
) : isMobile ? (
  <EntityMobileCardList
    entity={entity as EntityConfig<Record<string, unknown>>}
    data={(data || []) as Record<string, unknown>[]}
    basePath={path}
    showCreate={showCreate}
    onCreateClick={onCreateClick}
    hasActiveFilters={!!hasActiveFilters}
  />
) : (
  <DataTable
    // ... existing DataTable props unchanged
```

Keep the toolbar (search, filters, sort, pagination) visible above the mobile cards — they still work since filtering is server-side.

**Step 3: Verify typecheck passes**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/implementation && pnpm typecheck`
Expected: Zero errors

**Step 4: Commit**

```bash
git add src/components/universal/entity-mobile-card-list.tsx src/components/universal/entity-data-table.tsx
git commit -m "feat: mobile card view for entity data tables

Below md breakpoint, entity list pages render rows as tappable
cards showing title, subtitle fields, and status badge. Desktop
table layout unchanged."
```

---

## Task 3: Pricing Matrix Mobile Card Layout

**Files:**
- Modify: `src/app/(app)/settings/pricing/page.tsx`

**Step 1: Add useIsMobile import and hook**

At the top of the file, add:
```tsx
import { useIsMobile } from "@/hooks/use-mobile";
```

Inside `PricingPage`, after the existing state declarations (around line 414), add:
```tsx
const isMobile = useIsMobile();
```

**Step 2: Add mobile pricing card component**

Add a new component `PricingMobileCards` inside the same file (before the main `PricingPage` component, around line 400):

```tsx
function PricingMobileCards({
  tiers,
  formats,
  formatGroups,
  priceMap,
  activeChannelId,
  onSave,
}: {
  tiers: PricingTier[];
  formats: SellingFormatWithContainer[];
  formatGroups: { containerName: string; containerType: string; formats: SellingFormatWithContainer[] }[];
  priceMap: Map<string, Map<string, PricingTierPrice>>;
  activeChannelId: string;
  onSave: (tierId: string, formatId: string, channelId: string, value: number | null) => void;
}) {
  return (
    <div className="space-y-4">
      {tiers.map((tier) => (
        <div key={tier.id} className="rounded-lg border bg-card">
          <div className="px-3 py-2 border-b bg-muted/30">
            <div className="font-medium text-sm">{tier.name}</div>
            {tier.cogs_max != null && (
              <div className="text-[10px] text-muted-foreground">
                &le; ${Number(tier.cogs_max).toFixed(2)}/unit
              </div>
            )}
          </div>
          <div className="divide-y">
            {formatGroups.map((group) => (
              <div key={group.containerName}>
                {formatGroups.length > 1 && (
                  <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/20">
                    {group.containerName}
                  </div>
                )}
                {group.formats.map((fmt) => {
                  const priceObj = priceMap.get(tier.id)?.get(fmt.id);
                  return (
                    <div
                      key={fmt.id}
                      className="flex items-center justify-between px-3 py-1.5"
                    >
                      <span className="text-sm text-muted-foreground truncate mr-2">
                        {fmt.name}
                      </span>
                      <div className="w-24 shrink-0">
                        <PriceCell
                          price={priceObj?.price ?? null}
                          tierId={tier.id}
                          formatId={fmt.id}
                          channelId={activeChannelId}
                          rowIndex={0}
                          colIndex={0}
                          onSave={onSave}
                          onNavigate={() => {}}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Step 3: Conditionally render mobile vs desktop in matrix view**

In the matrix rendering section (around line 984), wrap the existing table in a desktop-only check and add the mobile alternative:

Replace:
```tsx
{!!tiers?.length && !!formats.length && (
  <div ref={tableRef} className="overflow-x-auto border rounded-lg">
    <Table className="table-fixed">
      {/* ... existing table ... */}
    </Table>
  </div>
)}
```

With:
```tsx
{!!tiers?.length && !!formats.length && (
  isMobile ? (
    <PricingMobileCards
      tiers={tiers}
      formats={formats}
      formatGroups={formatGroups}
      priceMap={priceMap}
      activeChannelId={activeChannelId!}
      onSave={handleSave}
    />
  ) : (
    <div ref={tableRef} className="overflow-x-auto border rounded-lg">
      <Table className="table-fixed">
        {/* ... existing table unchanged ... */}
      </Table>
    </div>
  )
)}
```

**Step 4: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: Zero errors

**Step 5: Commit**

```bash
git add src/app/\(app\)/settings/pricing/page.tsx
git commit -m "feat: mobile card layout for pricing matrix

Below md breakpoint, pricing matrix renders as tier cards with
format/price pairs. Desktop table layout unchanged."
```

---

## Task 4: Gantt Timeline Mobile Responsive Layout

**Files:**
- Modify: `src/app/(app)/production/planning/timeline/page.tsx`

**Step 1: Add useIsMobile import and hook**

At the top of the file, add:
```tsx
import { useIsMobile } from "@/hooks/use-mobile";
```

Inside `ProductionTimelinePage`, after the existing state declarations (around line 142), add:
```tsx
const isMobile = useIsMobile();
```

**Step 2: Make header controls stack on mobile**

The header already uses `flex-wrap` (line 339, 359) which helps. Make the filter selects full-width on mobile:

Replace fixed-width selects (lines 369, 384, 399):
- `className="w-[140px] h-8"` -> `className="w-full md:w-[140px] h-8"`
- `className="w-[160px] h-8"` -> `className="w-full md:w-[160px] h-8"`
- `className="w-[120px] h-8"` -> `className="w-full md:w-[120px] h-8"`

Wrap the filter selects in a responsive container. Replace the `<div className="flex flex-wrap items-center gap-3">` (line 359) with:
```tsx
<div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
```

**Step 3: Make vessel sidebar narrower on mobile**

The vessel sidebar already has responsive width: `w-28 md:w-40` (line 448). This is already handled.

**Step 4: Use smaller day columns on mobile**

The day column width is hardcoded to 48px (w-12) in both CSS and JS calculations. Make this responsive:

Add a constant at the top of the component:
```tsx
const dayWidth = isMobile ? 40 : 48;
const dayWidthClass = isMobile ? "w-10" : "w-12";
```

Replace all `w-12` references with `dayWidthClass` in the JSX (date headers line 501, grid lines lines 543, 612):
```tsx
className={cn(
  dayWidthClass, "flex-none border-r border-border/30 ...",
  ...
)}
```

Replace all hardcoded `48` in JS calculations (lines 303, 321, 322, 490, 629) with `dayWidth`:
```tsx
// Line 303
const dayWidth_ = dayWidth; // use the computed value
scrollContainerRef.current.scrollLeft = Math.max(0, (todayIndex - 3) * dayWidth);

// Line 321-322
const left = Math.max(0, startOffset) * dayWidth;
const width = Math.min(duration, days.length - Math.max(0, startOffset)) * dayWidth;

// Line 490
<div style={{ width: days.length * dayWidth }} className="min-h-full">

// Line 629
const left = offset * dayWidth;
```

**Step 5: Increase touch targets for batch bars on mobile**

Change batch bar height on mobile (line 564):
```tsx
className={cn(
  "absolute top-1 rounded-md border-2 flex items-center px-2 gap-1.5",
  "cursor-pointer transition-all hover:scale-[1.02] hover:z-20",
  "shadow-sm",
  isMobile ? "h-[44px]" : "h-12",
  colors.bg,
  colors.border,
  colors.text
)}
```

And adjust the row height to accommodate (line 533):
```tsx
className={cn(
  "border-b relative",
  isMobile ? "h-[52px]" : "h-16",
  vesselName === "unassigned" && "bg-muted/20"
)}
```

Match in the vessel label sidebar (line 459):
```tsx
className={cn(
  "border-b px-3 flex items-center",
  isMobile ? "h-[52px]" : "h-16",
  vesselName === "unassigned" && "bg-muted/50"
)}
```

**Step 6: Hide legend on mobile to save vertical space**

Wrap the legend div (line 426) with a responsive class:
```tsx
<div className="hidden md:flex items-center gap-4 mt-3 text-xs">
```

**Step 7: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: Zero errors

**Step 8: Commit**

```bash
git add src/app/\(app\)/production/planning/timeline/page.tsx
git commit -m "feat: mobile-responsive Gantt timeline

Full-width filter controls, narrower day columns (40px vs 48px),
44px touch targets for batch bars, hidden legend on mobile.
Fully interactive — drag/tap behaviors preserved."
```

---

## Task 5: Final Validation and Doc Update

**Files:**
- Modify: `docs/plans/2026-02-26-remaining-tasks-productionization.md`

**Step 1: Run full validation**

```bash
cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/implementation
pnpm typecheck
pnpm lint
pnpm test
```

All must pass with zero errors.

**Step 2: Update the productionization doc**

Update task statuses:
- Task 30: Change to "Done" — `pnpm audit` in quality job (PRs) + e2e job (main)
- Task 34: Change to "Done" — mobile card view for data tables, card layout for pricing, responsive Gantt
- Task 35: Already marked "Mostly done" — note the only remaining gap is brew event buttons (verified as already fixed)

Update the remaining items summary and completion percentage.

**Step 3: Commit**

```bash
git add docs/plans/2026-02-26-remaining-tasks-productionization.md
git commit -m "docs: mark all P2 tasks complete in productionization audit"
```

---

## Parallelism

| Task | Dependencies | Can parallelize? |
|------|-------------|-----------------|
| Task 1 (CI) | None | Yes — independent |
| Task 2 (Data tables mobile) | None | Yes — independent |
| Task 3 (Pricing mobile) | None | Yes — independent |
| Task 4 (Gantt mobile) | None | Yes — independent |
| Task 5 (Validation) | Tasks 1-4 | No — must run after all others |

Tasks 1-4 are fully independent and can run in parallel.

---

## Summary

| Task | Files | Scope |
|------|-------|-------|
| 1. CI Audit | `.github/workflows/test.yml` | Fix merge conflict, add audit to quality job |
| 2. Data Table Cards | `entity-mobile-card-list.tsx` (new), `entity-data-table.tsx` | Mobile card view for all entity lists |
| 3. Pricing Cards | `pricing/page.tsx` | Mobile card layout for pricing matrix |
| 4. Gantt Responsive | `timeline/page.tsx` | Responsive controls, smaller columns, touch targets |
| 5. Validation | `remaining-tasks-productionization.md` | Full test suite, doc update |
