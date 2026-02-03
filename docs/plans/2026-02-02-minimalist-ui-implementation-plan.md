# Minimalist UI Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Strip decorative icons, flatten visual chrome, and simplify content pages to follow "text is the interface" design philosophy.

**Architecture:** Pure UI refactoring across 5 files. Universal components (EntityList, EntityDetail) propagate changes to all entity pages. Dashboards are modified individually. No data model, API, or behavioral changes.

**Tech Stack:** React, Next.js, Tailwind CSS, lucide-react, shadcn/ui components

**Design doc:** `docs/plans/2026-02-02-minimalist-ui-redesign.md`

---

### Task 1: EntityList — Remove decorative icons and simplify chrome

**Files:**
- Modify: `src/components/universal/entity-list.tsx`

**Step 1: Remove unused icon imports**

Replace the lucide-react import block (lines 65-74):

```tsx
// BEFORE (line 65-74):
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Filter,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from "lucide-react";

// AFTER:
import {
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
```

Remove: `ChevronsUpDown`, `Filter`, `Plus`. Keep: `Search` (earns its place in input), `MoreHorizontal` (row actions), `X` (filter badge dismiss), `ChevronDown`/`ChevronUp` (active sort).

**Step 2: Remove subtitle from page header**

At line 481, remove the description paragraph:

```tsx
// BEFORE (lines 478-498):
<div className="flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-bold">{entity.displayNamePlural}</h1>
    <p className="text-muted-foreground">{entity.description}</p>
  </div>
  {showCreate && (
    <Button asChild={!onCreateClick} onClick={onCreateClick}>
      {onCreateClick ? (
        <>
          <Plus className="h-4 w-4 mr-2" />
          New {entity.displayName}
        </>
      ) : (
        <Link href={`${path}/new`}>
          <Plus className="h-4 w-4 mr-2" />
          New {entity.displayName}
        </Link>
      )}
    </Button>
  )}
</div>

// AFTER:
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold">{entity.displayNamePlural}</h1>
  {showCreate && (
    <Button asChild={!onCreateClick} onClick={onCreateClick}>
      {onCreateClick ? (
        <>New {entity.displayName}</>
      ) : (
        <Link href={`${path}/new`}>
          New {entity.displayName}
        </Link>
      )}
    </Button>
  )}
</div>
```

Changes: Remove `<p>` subtitle, remove `<Plus>` icon from both create button variants, remove wrapping `<div>` around h1 since subtitle is gone.

**Step 3: Remove Filter icon from filter bar**

At line 518, remove the standalone Filter icon:

```tsx
// BEFORE (line 517-518):
<div className="flex flex-wrap items-center gap-2">
  <Filter className="h-4 w-4 text-muted-foreground" />

// AFTER:
<div className="flex flex-wrap items-center gap-2">
```

**Step 4: Remove Filter icon from multiselect trigger**

At line 558, remove the Filter icon inside the multiselect popover trigger:

```tsx
// BEFORE (line 558):
<Filter className="mr-2 h-4 w-4" />

// AFTER: (delete this line entirely)
```

**Step 5: Replace "Clear" button with text link**

At lines 645-655, replace the ghost button with a text link:

```tsx
// BEFORE (lines 645-655):
{hasActiveQuickFilters && (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => setQuickFilters({})}
    className="h-9"
  >
    <X className="h-4 w-4 mr-1" />
    Clear
  </Button>
)}

// AFTER:
{hasActiveQuickFilters && (
  <button
    type="button"
    onClick={() => setQuickFilters({})}
    className="text-sm text-muted-foreground hover:text-foreground underline"
  >
    Clear filters
  </button>
)}
```

**Step 6: Remove ChevronsUpDown from unsorted columns**

At lines 736-744, only show sort indicator when column is actively sorted:

```tsx
// BEFORE (lines 736-744):
{canSort && (
  <span className="text-muted-foreground">
    {header.column.getIsSorted() === "asc" ? (
      <ChevronUp className="h-4 w-4" />
    ) : header.column.getIsSorted() === "desc" ? (
      <ChevronDown className="h-4 w-4" />
    ) : (
      <ChevronsUpDown className="h-4 w-4" />
    )}
  </span>
)}

// AFTER:
{canSort && header.column.getIsSorted() && (
  <span className="text-muted-foreground">
    {header.column.getIsSorted() === "asc" ? (
      <ChevronUp className="h-4 w-4" />
    ) : (
      <ChevronDown className="h-4 w-4" />
    )}
  </span>
)}
```

**Step 7: Remove Plus icon from empty state create buttons**

At lines 790-800, remove Plus icons from both create button variants:

```tsx
// BEFORE (line 791):
<Plus className="h-4 w-4 mr-1" />
Create {entity.displayName}

// AFTER:
Create {entity.displayName}

// BEFORE (line 797):
<Plus className="h-4 w-4 mr-1" />
Create {entity.displayName}

// AFTER:
Create {entity.displayName}
```

**Step 8: Verify the app compiles**

Run: `cd /Users/tedslesinski/Repos/mgr && npx next build --no-lint 2>&1 | head -30`

If TypeScript errors about unused imports, remove them.

**Step 9: Commit**

```
git add src/components/universal/entity-list.tsx
git commit -m "refactor: strip decorative icons from EntityList"
```

---

### Task 2: EntityDetail — Remove decorative icons and simplify

**Files:**
- Modify: `src/components/universal/entity-detail.tsx`

**Step 1: Update icon imports**

Replace the lucide-react import (line 41):

```tsx
// BEFORE (line 41):
import { ArrowLeft, MoreHorizontal, Pencil, Plus } from "lucide-react";

// AFTER:
import { ChevronDown, MoreHorizontal } from "lucide-react";
```

Remove: `ArrowLeft` (replaced by unicode), `Pencil` (removed from Edit button), `Plus` (removed from Add buttons). Add: `ChevronDown` (for Actions dropdown).

**Step 2: Replace back button with text link**

At lines 194-201, replace the ghost button:

```tsx
// BEFORE (lines 194-201):
<div className="flex items-center gap-2">
  <Button variant="ghost" size="sm" asChild>
    <Link href={backUrl || path}>
      <ArrowLeft className="h-4 w-4 mr-1" />
      Back
    </Link>
  </Button>
</div>

// AFTER:
<Link
  href={backUrl || path}
  className="text-sm text-muted-foreground hover:text-foreground"
>
  ← Back
</Link>
```

**Step 3: Remove Pencil icon from Edit button**

At lines 220-225:

```tsx
// BEFORE (lines 220-225):
<Button variant="outline" asChild>
  <Link href={`${path}/${id}/edit`}>
    <Pencil className="h-4 w-4 mr-2" />
    Edit
  </Link>
</Button>

// AFTER:
<Button variant="outline" asChild>
  <Link href={`${path}/${id}/edit`}>
    Edit
  </Link>
</Button>
```

**Step 4: Replace MoreHorizontal with ChevronDown on Actions dropdown**

At line 233:

```tsx
// BEFORE (line 233):
<MoreHorizontal className="h-4 w-4 ml-2" />

// AFTER:
<ChevronDown className="h-4 w-4 ml-2" />
```

Note: `MoreHorizontal` is still needed for the row-action pattern in EntityList, but in EntityDetail it's only used in the Actions trigger. Check if MoreHorizontal is still used elsewhere in this file — if not, it can be removed from the import. Actually, MoreHorizontal is NOT used elsewhere in entity-detail.tsx after this change, but keep it in the import since the file may be used by other components. Actually, review: it's only imported and used on line 233 in this file. After replacing it, remove from import if unused.

Update import to:
```tsx
import { ChevronDown } from "lucide-react";
```

**Step 5: Remove Plus icon from relation "Add" button**

At lines 522-524:

```tsx
// BEFORE (lines 522-524):
<Plus className="h-4 w-4 mr-1" />
Add

// AFTER:
Add
```

**Step 6: Verify the app compiles**

Run: `cd /Users/tedslesinski/Repos/mgr && npx next build --no-lint 2>&1 | head -30`

**Step 7: Commit**

```
git add src/components/universal/entity-detail.tsx
git commit -m "refactor: strip decorative icons from EntityDetail"
```

---

### Task 3: Production Dashboard — Strip visual chrome

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

**Step 1: Simplify imports**

Replace the lucide-react import block (lines 20-31):

```tsx
// BEFORE (lines 20-31):
import {
  Beer,
  FlaskConical,
  Package,
  CheckCircle,
  Clock,
  AlertTriangle,
  Container,
  ArrowRight,
  Activity,
  CalendarClock,
} from "lucide-react";

// AFTER:
// (remove entire lucide-react import — no icons needed)
```

All icons in this file are decorative. None survive the redesign.

**Step 2: Simplify statusConfig**

At lines 70-76, remove icon references:

```tsx
// BEFORE (lines 70-76):
const statusConfig = {
  planned: { label: "Planned", icon: Clock, color: "bg-slate-500" },
  fermenting: { label: "Fermenting", icon: FlaskConical, color: "bg-blue-500" },
  conditioning: { label: "Conditioning", icon: Beer, color: "bg-cyan-500" },
  packaging: { label: "Packaging", icon: Package, color: "bg-amber-500" },
  completed: { label: "Completed", icon: CheckCircle, color: "bg-green-500" },
};

// AFTER:
const statusConfig = {
  planned: { label: "Planned", color: "bg-slate-500" },
  fermenting: { label: "Fermenting", color: "bg-blue-500" },
  conditioning: { label: "Conditioning", color: "bg-cyan-500" },
  packaging: { label: "Packaging", color: "bg-amber-500" },
  completed: { label: "Completed", color: "bg-green-500" },
};
```

**Step 3: Simplify page header**

At lines 208-216:

```tsx
// BEFORE (lines 208-216):
<div>
  <h1 className="text-2xl font-bold flex items-center gap-2">
    <Activity className="h-6 w-6" />
    Production Dashboard
  </h1>
  <p className="text-muted-foreground">
    Overview of production status and vessel utilization
  </p>
</div>

// AFTER:
<h1 className="text-2xl font-bold">Production Dashboard</h1>
```

**Step 4: Remove icon circles from batch status cards**

At lines 224-239, remove the icon circle div:

```tsx
// BEFORE (lines 220-240):
{Object.entries(statusConfig).map(([status, config]) => {
  const Icon = config.icon;
  const count = batchCounts[status as keyof BatchStatusCounts] || 0;

  return (
    <Card key={status}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{config.label}</CardTitle>
        <div className={`p-2 rounded-full ${config.color}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{count}</div>
        <p className="text-xs text-muted-foreground">
          {count === 1 ? "batch" : "batches"}
        </p>
      </CardContent>
    </Card>
  );
})}

// AFTER:
{Object.entries(statusConfig).map(([status, config]) => {
  const count = batchCounts[status as keyof BatchStatusCounts] || 0;

  return (
    <Card key={status}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{config.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{count}</div>
        <p className="text-xs text-muted-foreground">
          {count === 1 ? "batch" : "batches"}
        </p>
      </CardContent>
    </Card>
  );
})}
```

**Step 5: Simplify production planning alert**

At lines 244-276, strip icons and simplify:

```tsx
// BEFORE (lines 244-276): Full card with icons and styled button

// AFTER:
{shortfalls.length > 0 && (
  <Card className={urgentShortfalls.length > 0 ? "border-destructive" : "border-amber-500"}>
    <CardContent className="flex items-center justify-between py-4">
      <div className="flex items-center gap-6">
        <div>
          <span className="text-2xl font-bold">{shortfalls.length}</span>
          <span className="text-sm text-muted-foreground ml-2">shortfalls</span>
        </div>
        {urgentShortfalls.length > 0 && (
          <span className="font-medium text-destructive">
            {urgentShortfalls.length} urgent
          </span>
        )}
      </div>
      <Link
        href="/production/planning"
        className="text-sm text-muted-foreground hover:text-foreground underline"
      >
        View Planning
      </Link>
    </CardContent>
  </Card>
)}
```

**Step 6: Replace "View All" buttons with text links for Active Batches and Vessel Utilization**

For Active Batches (lines 287-292):
```tsx
// BEFORE:
<Link href="/production/batches">
  <Button variant="outline" size="sm">
    View All
    <ArrowRight className="ml-2 h-4 w-4" />
  </Button>
</Link>

// AFTER:
<Link
  href="/production/batches"
  className="text-sm text-muted-foreground hover:text-foreground underline"
>
  View All
</Link>
```

Same pattern for Vessel Utilization (lines 344-349).

**Step 7: Remove empty state icon**

At lines 297-299:
```tsx
// BEFORE:
<div className="text-center py-6 text-muted-foreground">
  <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-50" />
  <p>No active batches</p>
</div>

// AFTER:
<div className="text-center py-6 text-muted-foreground">
  <p>No active batches</p>
</div>
```

**Step 8: Remove icon from inside batch status badges**

At lines 323-324:
```tsx
// BEFORE:
<Badge variant="secondary" className="flex items-center gap-1">
  {config && <config.icon className="h-3 w-3" />}
  {config?.label || batch.status}
</Badge>

// AFTER:
<Badge variant="secondary">
  {config?.label || batch.status}
</Badge>
```

**Step 9: Replace vessel stats grid with inline text**

At lines 372-388, replace the 3-column icon grid:

```tsx
// BEFORE (lines 372-388): Grid with Container, CheckCircle, AlertTriangle icons

// AFTER:
<div className="flex items-center gap-4 mb-4 text-sm">
  <span><span className="font-bold">{vesselStats.inUse}</span> in use</span>
  <span className="text-muted-foreground">·</span>
  <span><span className="font-bold">{vesselStats.available}</span> available</span>
  <span className="text-muted-foreground">·</span>
  <span><span className="font-bold">{vesselStats.maintenance}</span> maintenance</span>
</div>
```

**Step 10: Remove Container icon from vessel list rows**

At lines 398-400:
```tsx
// BEFORE:
<div className="flex items-center gap-2">
  <Container className="h-4 w-4 text-muted-foreground" />
  <span className="font-medium text-sm">{vessel.name}</span>
</div>

// AFTER:
<span className="font-medium text-sm">{vessel.name}</span>
```

**Step 11: Clean up unused imports**

Remove `Button` import if no longer used (check — the "View All" buttons are gone, but check if Button is used elsewhere in the file). Remove `CardDescription` if unused after changes. Remove the lucide-react import entirely.

**Step 12: Verify the app compiles**

Run: `cd /Users/tedslesinski/Repos/mgr && npx next build --no-lint 2>&1 | head -30`

**Step 13: Commit**

```
git add src/app/(app)/dashboard/page.tsx
git commit -m "refactor: strip decorative icons from production dashboard"
```

---

### Task 4: Inventory Dashboard — Strip visual chrome

**Files:**
- Modify: `src/app/(app)/dashboard/inventory/page.tsx`

Apply the same patterns as the production dashboard:

**Step 1: Simplify imports**

Remove all lucide-react icon imports (lines 19-30). Keep only what's functionally needed — in this case, none of the icons survive.

**Step 2: Remove `categoryConfig` object**

Lines 66-72 — this entire object exists to map categories to icons. After the redesign, it's unused. Delete it.

**Step 3: Simplify page header**

Lines 226-234: Remove Package icon and subtitle paragraph.

```tsx
// AFTER:
<h1 className="text-2xl font-bold">Inventory Dashboard</h1>
```

**Step 4: Remove icons from summary stat cards**

Lines 239-276: Remove `AlertTriangle`, `Calendar`, and `Boxes` icons from the three stat card headers. Keep the Card structure, just delete the icon elements.

```tsx
// BEFORE (e.g., line 241):
<AlertTriangle className={`h-5 w-5 ${lowStockCount > 0 ? "text-amber-500" : "text-muted-foreground"}`} />

// AFTER: (delete line)
```

Repeat for Calendar (line 254) and Boxes (line 267).

**Step 5: Remove icons from section CardTitles**

Lines 284-285 and 349-350: Remove TrendingDown and Calendar from CardTitle.

```tsx
// BEFORE:
<CardTitle className="flex items-center gap-2">
  <TrendingDown className="h-5 w-5 text-amber-500" />
  Low Stock Items
</CardTitle>

// AFTER:
<CardTitle>Low Stock Items</CardTitle>
```

Same for "Expiring Lots" CardTitle.

**Step 6: Replace "View All" button with text link**

Lines 290-295:
```tsx
// AFTER:
<Link
  href="/inventory/items"
  className="text-sm text-muted-foreground hover:text-foreground underline"
>
  View All
</Link>
```

**Step 7: Remove empty state icons**

Lines 300-303 and 359-362: Remove Package and Calendar icons from empty states.

**Step 8: Remove category icon circles from low stock item rows**

Lines 317-320: Remove the colored circle with category icon from each row.

```tsx
// BEFORE (lines 317-320):
<div className="flex items-center gap-3">
  <div className={`p-2 rounded-full ${config.color}`}>
    <Icon className="h-4 w-4 text-white" />
  </div>
  <div>

// AFTER:
<div>
```

Also remove the `config` and `Icon` variables from the map callback (lines 307-308).

**Step 9: Replace category summary grid with inline stats**

Lines 401-420: Replace the icon-circle grid with inline text:

```tsx
// BEFORE: Grid with icon circles per category

// AFTER:
<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
  {inventorySummary.map((summary) => (
    <span key={summary.category} className="text-sm">
      <span className="font-bold">{summary.item_count}</span>
      <span className="text-muted-foreground ml-1 capitalize">{summary.category}</span>
    </span>
  ))}
</div>
```

**Step 10: Clean up unused imports**

Remove `Button` if unused. Remove all lucide-react imports. Remove `categoryConfig`.

**Step 11: Verify and commit**

Run: `cd /Users/tedslesinski/Repos/mgr && npx next build --no-lint 2>&1 | head -30`

```
git add src/app/(app)/dashboard/inventory/page.tsx
git commit -m "refactor: strip decorative icons from inventory dashboard"
```

---

### Task 5: Sales Dashboard — Strip visual chrome

**Files:**
- Modify: `src/app/(app)/dashboard/sales/page.tsx`

**Step 1: Simplify imports**

Remove all lucide-react imports (lines 19-33). None survive.

**Step 2: Simplify statusConfig**

Lines 77-85: Remove `icon` property from each entry. Keep `label` and `color`.

**Step 3: Simplify page header**

Lines 335-343: Remove TrendingUp icon and subtitle.

```tsx
// AFTER:
<h1 className="text-2xl font-bold">Sales Dashboard</h1>
```

**Step 4: Remove icons from summary stat cards**

Lines 347-399: Remove ShoppingCart, Clock, DollarSign, BarChart3 icons from the four stat card headers.

**Step 5: Replace "View All" buttons with text links**

Lines 410-415, 451-455, 507-511: Replace all three "View All" / "View All Orders" buttons with text links.

**Step 6: Remove icon circles from order pipeline**

Lines 420-437: Remove the colored icon circle from each pipeline status item. Keep the clickable card but just show number + label without icon.

```tsx
// BEFORE (lines 430-431):
<div className={`p-2 rounded-full ${config.color} mb-2`}>
  <Icon className="h-4 w-4 text-white" />
</div>

// AFTER: (delete these lines)
```

Remove the `const Icon = config.icon;` line too (line 421).

**Step 7: Remove empty state icons**

Lines 461-463, 517-519, 564-566: Remove ShoppingCart, Users, and Package icons from empty states.

**Step 8: Remove icons from section CardTitles**

Lines 501-502 and 556-557: Remove Users and BarChart3 from CardTitles.

```tsx
// BEFORE:
<CardTitle className="flex items-center gap-2">
  <Users className="h-5 w-5" />
  Top Customers
</CardTitle>

// AFTER:
<CardTitle>Top Customers</CardTitle>
```

**Step 9: Clean up unused imports**

Remove all lucide-react imports, `Button` if unused.

**Step 10: Verify and commit**

Run: `cd /Users/tedslesinski/Repos/mgr && npx next build --no-lint 2>&1 | head -30`

```
git add src/app/(app)/dashboard/sales/page.tsx
git commit -m "refactor: strip decorative icons from sales dashboard"
```

---

### Task 6: Audit pass — Check for remaining decorative icons

**Files:**
- Search across `src/components/domain/` and `src/app/`

**Step 1: Search for icon patterns in domain components**

Run: `grep -rn "className=\"h-[0-9] w-[0-9].*opacity-50" src/components/domain/ src/app/` to find faded empty-state icons.

Run: `grep -rn "rounded-full.*bg-" src/components/domain/ src/app/ | grep -v sidebar | grep -v node_modules` to find colored icon circles.

**Step 2: Review results and fix any remaining decorative patterns**

For each hit, evaluate whether the icon is functional (drag handle, delete button) or decorative (category icon, status icon in badge). Only remove decorative ones.

**Step 3: Final build verification**

Run: `cd /Users/tedslesinski/Repos/mgr && npx next build --no-lint 2>&1 | tail -10`

Expected: Build succeeds with no errors.

**Step 4: Visual spot-check**

Run: `cd /Users/tedslesinski/Repos/mgr && npx next dev`

Navigate to:
- `/dashboard` — verify stat cards have no icon circles, planning alert is compact, vessel stats are inline
- `/dashboard/inventory` — verify no category icons, inline category summary
- `/dashboard/sales` — verify no pipeline icons, no stat card icons
- `/production/batches` — verify no Plus icon on create button, no Filter icon, sort columns clean
- `/production/batches/{id}` — verify back link is text, no Pencil on Edit, Actions has ChevronDown

**Step 5: Commit any remaining fixes**

```
git add -A
git commit -m "refactor: audit pass for remaining decorative icons"
```
