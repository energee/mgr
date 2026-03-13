# Linear-Inspired UI Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform MGR from a warm/brewery-themed aesthetic to a sleek, monochromatic Linear-style UI across both light and dark modes.

**Architecture:** Four parallel workstreams targeting: (1) CSS variables and base components, (2) data table density and toolbar, (3) micro-animations, (4) detail page layout. All changes are CSS/component-level — no database or API changes.

**Tech Stack:** Tailwind CSS v4, shadcn/ui, motion/react (framer-motion), TanStack Table, React

---

## Parallelism Map

Tasks 1-4 can run in parallel (independent files).
Task 5 depends on Task 1 (needs new color tokens).
Tasks 6-8 can run in parallel after Task 1.
Task 9 depends on Tasks 6-8.
Task 10 (final validation) depends on all.

---

### Task 1: Color System Overhaul

**Files:**
- Modify: `src/app/globals.css`

**Step 1: Replace color tokens**

Replace the `:root` block (lines 70-131) with cool monochromatic tokens:

```css
:root {
  --radius: 0.375rem;

  /* Near-white background */
  --background: oklch(0.99 0 0);
  --foreground: oklch(0.145 0.005 260);

  /* Cards: same as background, separated by borders */
  --card: oklch(0.99 0 0);
  --card-foreground: oklch(0.145 0.005 260);

  --popover: oklch(0.995 0 0);
  --popover-foreground: oklch(0.145 0.005 260);

  /* Primary: Indigo/violet accent */
  --primary: oklch(0.45 0.18 265);
  --primary-foreground: oklch(0.98 0 0);

  /* Secondary: Cool light gray */
  --secondary: oklch(0.955 0.005 260);
  --secondary-foreground: oklch(0.20 0.005 260);

  /* Muted: Subtle cool gray */
  --muted: oklch(0.955 0.005 260);
  --muted-foreground: oklch(0.55 0.01 260);

  /* Accent: Same as muted for hover states */
  --accent: oklch(0.94 0.005 260);
  --accent-foreground: oklch(0.145 0.005 260);

  /* Destructive */
  --destructive: oklch(0.55 0.22 25);

  /* Borders: very subtle */
  --border: oklch(0.92 0.005 260);
  --input: oklch(0.92 0.005 260);
  --ring: oklch(0.45 0.18 265);

  /* Chart colors: cool-toned */
  --chart-1: oklch(0.55 0.18 265);
  --chart-2: oklch(0.55 0.12 200);
  --chart-3: oklch(0.60 0.15 145);
  --chart-4: oklch(0.65 0.12 85);
  --chart-5: oklch(0.50 0.10 310);

  /* Sidebar: near-white in light mode */
  --sidebar: oklch(0.97 0.005 260);
  --sidebar-foreground: oklch(0.145 0.005 260);
  --sidebar-primary: oklch(0.45 0.18 265);
  --sidebar-primary-foreground: oklch(0.98 0 0);
  --sidebar-accent: oklch(0.93 0.005 260);
  --sidebar-accent-foreground: oklch(0.145 0.005 260);
  --sidebar-border: oklch(0.92 0.005 260);
  --sidebar-ring: oklch(0.45 0.18 265);

  /* Status colors: cool-toned */
  --status-planned: oklch(0.55 0.10 260);
  --status-active: oklch(0.55 0.18 265);
  --status-success: oklch(0.55 0.15 155);
  --status-warning: oklch(0.65 0.15 70);
  --status-error: oklch(0.55 0.22 25);
}
```

**Step 2: Replace dark mode tokens**

Replace the `.dark` block (lines 133-185) with:

```css
.dark {
  --background: oklch(0.13 0.005 260);
  --foreground: oklch(0.93 0 0);

  --card: oklch(0.155 0.005 260);
  --card-foreground: oklch(0.93 0 0);

  --popover: oklch(0.155 0.005 260);
  --popover-foreground: oklch(0.93 0 0);

  --primary: oklch(0.65 0.18 265);
  --primary-foreground: oklch(0.13 0.005 260);

  --secondary: oklch(0.20 0.005 260);
  --secondary-foreground: oklch(0.93 0 0);

  --muted: oklch(0.20 0.005 260);
  --muted-foreground: oklch(0.55 0.01 260);

  --accent: oklch(0.20 0.005 260);
  --accent-foreground: oklch(0.93 0 0);

  --destructive: oklch(0.65 0.20 25);

  --border: oklch(0.24 0.005 260);
  --input: oklch(0.22 0.005 260);
  --ring: oklch(0.65 0.18 265);

  --chart-1: oklch(0.65 0.18 265);
  --chart-2: oklch(0.60 0.12 200);
  --chart-3: oklch(0.65 0.16 145);
  --chart-4: oklch(0.70 0.12 85);
  --chart-5: oklch(0.58 0.10 310);

  --sidebar: oklch(0.11 0.005 260);
  --sidebar-foreground: oklch(0.85 0 0);
  --sidebar-primary: oklch(0.65 0.18 265);
  --sidebar-primary-foreground: oklch(0.11 0.005 260);
  --sidebar-accent: oklch(0.20 0.005 260);
  --sidebar-accent-foreground: oklch(0.85 0 0);
  --sidebar-border: oklch(0.24 0.005 260);
  --sidebar-ring: oklch(0.65 0.18 265);
}
```

**Step 3: Remove warm backdrop textures**

Delete the `.bg-background` gradient rules (lines 201-211). Replace with:

```css
/* Clean background — no texture overlay */
```

**Step 4: Update card-refined class**

Replace the `.card-refined` block (lines 238-253) with:

```css
@layer components {
  .card-refined {
    @apply bg-card rounded-md border;
  }
}
```

**Step 5: Update status badge utilities**

Replace `status-active` (lines 262-269) with cool indigo:

```css
.status-active {
  background-color: oklch(0.95 0.04 265);
  color: oklch(0.40 0.18 265);
}

.dark .status-active {
  background-color: oklch(0.20 0.06 265);
  color: oklch(0.75 0.18 265);
}
```

**Step 6: Update the comment header**

Replace lines 6-14 with:

```css
/* ============================================================================
   MGR Design System — Linear-Inspired Monochromatic

   A sleek, monochromatic aesthetic with:
   - Cool gray tones (slight blue shift)
   - Indigo/violet accent color (used sparingly)
   - Dense, information-rich layouts
   - Minimal chrome, maximum content
   ============================================================================ */
```

**Step 7: Add shimmer animation keyframes**

Add after the `caret-blink` keyframes (after line 68):

```css
@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}
```

**Step 8: Update scrollbar colors to cool gray**

Replace scrollbar thumb colors (lines 323-337):

```css
::-webkit-scrollbar-thumb {
  background: oklch(0.70 0.005 260 / 0.3);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: oklch(0.60 0.005 260 / 0.5);
}

.dark ::-webkit-scrollbar-thumb {
  background: oklch(0.50 0.005 260 / 0.3);
}

.dark ::-webkit-scrollbar-thumb:hover {
  background: oklch(0.60 0.005 260 / 0.5);
}
```

**Step 9: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-3 && bun typecheck`
Expected: PASS (CSS-only changes)

**Step 10: Commit**

```bash
git add src/app/globals.css
git commit -m "style: overhaul color system to Linear-inspired monochromatic palette"
```

---

### Task 2: Card Component — Remove Shadows, Reduce Padding

**Files:**
- Modify: `src/components/ui/card.tsx`

**Step 1: Update Card component**

Replace the Card className (line 10-13) with:

```typescript
"bg-card text-card-foreground flex flex-col gap-4 rounded-md border py-4",
```

Remove the shadow lines entirely (the two `shadow-[...]` lines).

**Step 2: Update CardHeader padding**

Replace `px-6` with `px-4` in the CardHeader className (line 26). Also replace `[.border-b]:pb-6` with `[.border-b]:pb-4`.

**Step 3: Update CardContent padding**

Replace `px-6` with `px-4` in CardContent (line 71).

**Step 4: Update CardFooter padding**

Replace `px-6` with `px-4` in CardFooter (line 82). Replace `[.border-t]:pt-6` with `[.border-t]:pt-4`.

**Step 5: Commit**

```bash
git add src/components/ui/card.tsx
git commit -m "style: remove card shadows, reduce padding for Linear-style minimal chrome"
```

---

### Task 3: Table Component — Density and Header Styling

**Files:**
- Modify: `src/components/ui/table.tsx`

**Step 1: Update TableHead for Linear-style headers**

Replace TableHead className (line 73) with:

```typescript
"text-muted-foreground h-8 px-3 text-left align-middle font-medium text-[11px] uppercase tracking-wider whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
```

**Step 2: Update TableCell for density**

Replace TableCell className (line 85-86) with:

```typescript
"px-3 py-1.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
```

**Step 3: Update TableRow hover**

Replace TableRow className (line 60) with:

```typescript
"hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors duration-150",
```

**Step 4: Commit**

```bash
git add src/components/ui/table.tsx
git commit -m "style: increase table density with compact rows and uppercase headers"
```

---

### Task 4: Skeleton Component — Shimmer Animation

**Files:**
- Modify: `src/components/ui/skeleton.tsx`

**Step 1: Replace skeleton with shimmer effect**

Replace the Skeleton component with:

```typescript
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md bg-muted",
        "bg-[length:200%_100%] bg-[linear-gradient(90deg,transparent_0%,oklch(0.90_0.005_260/0.5)_50%,transparent_100%)] animate-[shimmer_1.5s_ease-in-out_infinite]",
        "dark:bg-[linear-gradient(90deg,transparent_0%,oklch(0.30_0.005_260/0.5)_50%,transparent_100%)]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
```

**Step 2: Commit**

```bash
git add src/components/ui/skeleton.tsx
git commit -m "style: replace pulse skeleton with shimmer sweep animation"
```

---

### Task 5: Status Badge — Dot + Text Variant

**Files:**
- Modify: `src/components/universal/status-badge.tsx`

**Step 1: Add dot color map and update component**

Replace the entire file with:

```typescript
/**
 * Status Badge
 *
 * Universal badge for displaying entity status.
 * Linear-inspired: small colored dot + text label, minimal chrome.
 */

import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string | null | undefined;
  variant?: "default" | "success" | "warning" | "error" | "info";
  config?: Record<string, { label: string; color: "default" | "success" | "warning" | "error" | "info" }>;
  /** Use compact dot-only display (no text) */
  dotOnly?: boolean;
}

const defaultColors: Record<string, "default" | "success" | "warning" | "error" | "info"> = {
  draft: "default",
  planned: "default",
  active: "info",
  in_progress: "info",
  fermenting: "info",
  conditioning: "info",
  completed: "success",
  packaged: "success",
  fulfilled: "success",
  out_the_door: "success",
  confirmed: "info",
  scheduled: "info",
  picking: "info",
  packed: "success",
  cancelled: "error",
  warning: "warning",
  error: "error",
};

const dotColors: Record<string, string> = {
  default: "bg-muted-foreground",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
  info: "bg-primary",
};

export function StatusBadge({ status, variant, config, dotOnly }: StatusBadgeProps) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={cn("size-1.5 rounded-full shrink-0", dotColors.default)} />
        {!dotOnly && <span>—</span>}
      </span>
    );
  }

  const label = config?.[status]?.label || formatStatus(status);
  const color = variant || config?.[status]?.color || defaultColors[status] || "default";

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={cn("size-1.5 rounded-full shrink-0", dotColors[color])} />
      {!dotOnly && <span>{label}</span>}
    </span>
  );
}

function formatStatus(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
```

**Step 2: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-3 && bun typecheck`

StatusBadge previously used Badge component. Search for all usages to make sure no callers depend on the Badge wrapper behavior. The `StatusBadge` is used via:
- `entity-detail-unified.tsx` line 824: `<StatusBadge status={...} config={...} />`
- `data-table-adapter.tsx`: renders StatusBadge in table cells
- Various entity configs

The interface stays the same (`status`, `variant`, `config`), just adds optional `dotOnly`. The Badge dependency is removed but the rendered output is a `<span>` instead — all consumers pass the same props. Typecheck should pass.

**Step 3: Commit**

```bash
git add src/components/universal/status-badge.tsx
git commit -m "style: replace status badges with Linear-style dot + text"
```

---

### Task 6: Data Table — Toolbar Simplification

**Files:**
- Modify: `src/components/data-table/data-table-advanced-toolbar.tsx`

**Step 1: Simplify toolbar — remove view options button from default**

Replace the toolbar component (entire file) with:

```typescript
"use client";

import type { Table } from "@tanstack/react-table";
import type * as React from "react";

import { cn } from "@/lib/utils";

interface DataTableAdvancedToolbarProps<TData>
  extends React.ComponentProps<"div"> {
  table: Table<TData>;
}

export function DataTableAdvancedToolbar<TData>({
  table,
  children,
  className,
  ...props
}: DataTableAdvancedToolbarProps<TData>) {
  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      className={cn(
        "flex w-full items-center gap-2",
        className,
      )}
      {...props}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
```

This removes the `DataTableViewOptions` column visibility button from the default toolbar. (Columns are already configured per-entity.) The `justify-between` is changed to plain `gap-2` since there's no right-side content.

**Step 2: Commit**

```bash
git add src/components/data-table/data-table-advanced-toolbar.tsx
git commit -m "style: simplify data table toolbar, remove column visibility toggle"
```

---

### Task 7: Data Table — Minimal Pagination

**Files:**
- Modify: `src/components/data-table/data-table-pagination.tsx`

**Step 1: Replace with minimal pagination**

Replace the entire component with:

```typescript
import type { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DataTablePaginationProps<TData> extends React.ComponentProps<"div"> {
  table: Table<TData>;
  pageSizeOptions?: number[];
}

export function DataTablePagination<TData>({
  table,
  className,
  ...props
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const totalRows = table.getFilteredRowModel().rows.length;
  const start = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <div
      className={cn(
        "flex items-center justify-between text-xs text-muted-foreground",
        className,
      )}
      {...props}
    >
      <span>
        {start}–{end} of {totalRows}
      </span>
      <div className="flex items-center gap-1">
        <Button
          aria-label="Go to previous page"
          variant="ghost"
          size="icon-xs"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          <ChevronLeft />
        </Button>
        <Button
          aria-label="Go to next page"
          variant="ghost"
          size="icon-xs"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/data-table/data-table-pagination.tsx
git commit -m "style: minimal pagination — range text + prev/next arrows only"
```

---

### Task 8: Entity List — Header and Search Refinement

**Files:**
- Modify: `src/components/universal/entity-data-table.tsx`

**Step 1: Update header section**

Replace the header div (lines 590-633) with:

```tsx
{/* Header */}
<div className="flex items-center justify-between">
  <h1 className="text-lg font-medium">{entity.displayNamePlural}</h1>
  <div className="flex items-center gap-2">
    {entity.stateMachine && entity.kanbanConfig && (
      <div className="flex gap-0.5">
        <Button
          variant={viewMode === "table" ? "secondary" : "ghost"}
          size="icon-xs"
          onClick={() => setViewMode("table")}
          aria-label="Table view"
          aria-pressed={viewMode === "table"}
        >
          <LayoutList className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={viewMode === "board" ? "secondary" : "ghost"}
          size="icon-xs"
          onClick={() => setViewMode("board")}
          aria-label="Board view"
          aria-pressed={viewMode === "board"}
        >
          <KanbanIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    )}
    {showCreate && (
      <Button variant="ghost" size="sm" asChild={!onCreateClick} onClick={onCreateClick}>
        {onCreateClick ? (
          <>
            <span className="text-lg leading-none">+</span>
            New
          </>
        ) : (
          <Link href={`${path}/new`}>
            <span className="text-lg leading-none">+</span>
            New
          </Link>
        )}
      </Button>
    )}
  </div>
</div>
```

**Step 2: Update search input to borderless style**

Replace the search input section (lines 733-749) with:

```tsx
{entity.searchableFields &&
  entity.searchableFields.length > 0 && (
    <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:max-w-sm">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        placeholder={`Search ${entity.displayNamePlural.toLowerCase()}...`}
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.target.value)}
        className="pl-8 pr-8 h-7 text-xs border-transparent bg-transparent focus-visible:border-border focus-visible:bg-background"
      />
      {!globalFilter && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
          <Kbd>/</Kbd>
        </div>
      )}
    </div>
  )}
```

**Step 3: Update the outer container spacing**

Replace `className="space-y-4"` (line 588) with `className="space-y-3"`.

**Step 4: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-3 && bun typecheck`

**Step 5: Commit**

```bash
git add src/components/universal/entity-data-table.tsx
git commit -m "style: Linear-style list header — compact title, ghost create button, borderless search"
```

---

### Task 9: Detail Page — Flat Sections and Compact Header

**Files:**
- Modify: `src/components/universal/entity-detail-unified.tsx`

**Step 1: Update the detail header**

Find the header section (around line 806-938 in the persisted output). Replace the header `<div>` with:

```tsx
{/* Header */}
<div className="flex items-start justify-between">
  <div className="space-y-1">
    <Link
      href={backUrl || path}
      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
    >
      <span aria-hidden="true"><Kbd>⌫</Kbd></span>
      Back
    </Link>
    <div className="flex items-center gap-2">
      <h1 className="text-lg font-medium">
        {isCreateMode
          ? `Create ${entity.displayName}`
          : header?.title || `${entity.displayName} ${id}`}
      </h1>
      {!isCreateMode && stateInfo && (
        <StatusBadge
          status={stateInfo.currentState}
          config={entity.stateMachine?.stateDisplay}
        />
      )}
    </div>
    {!isCreateMode && header?.subtitle && (
      <p className="text-sm text-muted-foreground">{header.subtitle}</p>
    )}
  </div>

  <div className="flex items-center gap-1.5">
    {editing && !isCreateMode && (
      <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isSubmitting}>
        Cancel
        <span aria-hidden="true"><Kbd>Esc</Kbd></span>
      </Button>
    )}

    {editing && (
      <Button
        size="sm"
        onClick={handleSave}
        disabled={isSubmitting}
      >
        {isSubmitting ? "Saving..." : "Save"}
        <span aria-hidden="true"><Kbd>⌘↵</Kbd></span>
      </Button>
    )}

    {canEdit && !editing && !isCreateMode && (
      <Button variant="ghost" size="sm" onClick={startEditing}>
        <Pencil className="h-3.5 w-3.5" />
        Edit
        <span aria-hidden="true"><Kbd>E</Kbd></span>
      </Button>
    )}

    {!editing &&
      !isCreateMode &&
      (availableActions.length > 0 ||
        (stateInfo && stateInfo.validTransitions.length > 0)) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              Actions
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          {/* Keep existing DropdownMenuContent unchanged */}
```

Only change the outer wrapper buttons' `variant` and `size` — keep the DropdownMenuContent contents as-is.

**Step 2: Update section title styling**

In `InlineFieldSection` (around line 1436), find the section title rendering. The `h3` for field sections should use:

```tsx
<h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
  {section.title}
</h3>
```

In `UnifiedSectionCard`, update `CardTitle` usage to use the same compact style for section titles:

```tsx
<CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
  {section.title}
</CardTitle>
```

**Step 3: Update outer spacing**

Change `className="space-y-6"` to `className="space-y-4"` on the main wrapper div (line 806).

**Step 4: Run typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-3 && bun typecheck`

**Step 5: Commit**

```bash
git add src/components/universal/entity-detail-unified.tsx
git commit -m "style: Linear-style detail page — compact header, flat sections, uppercase titles"
```

---

### Task 10: Input Component — Refined Focus Ring

**Files:**
- Modify: `src/components/ui/input.tsx`

**Step 1: Update input styling**

Replace the input className (line 11-12) with:

```typescript
"file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-8 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm shadow-none transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
"focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-1",
"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
```

Key changes:
- Height: `h-9` -> `h-8` (32px)
- Text: always `text-sm` (removed `text-base` / `md:text-sm` split)
- Focus ring: `ring-[3px]` -> `ring-1` and `ring-ring/50` -> `ring-ring/30` (subtler)
- Shadow: `shadow-xs` -> `shadow-none`

**Step 2: Commit**

```bash
git add src/components/ui/input.tsx
git commit -m "style: compact inputs with subtle focus ring"
```

---

### Task 11: App Header — Minimal Chrome

**Files:**
- Modify: `src/components/domain/app-header.tsx`

**Step 1: Update header styling**

Replace the header element className (line 54) with:

```typescript
<header className="h-12 border-b flex items-center justify-between px-4">
```

Key change: `h-16` -> `h-12`, removed `bg-card` (inherits background), removed `md:px-6`.

**Step 2: Update brewery name**

Replace the h1 (line 65) with:

```typescript
<span className="text-sm font-medium">{breweryName}</span>
```

**Step 3: Commit**

```bash
git add src/components/domain/app-header.tsx
git commit -m "style: compact header — reduced height, minimal brewery name"
```

---

### Task 12: App Sidebar — Update header height to match

**Files:**
- Modify: `src/components/domain/app-sidebar.tsx`

**Step 1: Update sidebar header height**

Replace `h-16` (line 235) with `h-12` to match the updated app header.

**Step 2: Commit**

```bash
git add src/components/domain/app-sidebar.tsx
git commit -m "style: match sidebar header height to compact app header"
```

---

### Task 13: Final Validation

**Step 1: Run full typecheck**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-3 && bun typecheck`
Expected: 0 errors

**Step 2: Run lint**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-3 && bun lint`
Expected: 0 errors (or only pre-existing warnings)

**Step 3: Run tests**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-3 && bun test`
Expected: All pass (UI-only changes shouldn't break logic tests)

**Step 4: Build**

Run: `cd /Users/tedslesinski/Repos/mgr/.claude/worktrees/workstream-3 && bun build`
Expected: Successful build
