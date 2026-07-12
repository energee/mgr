# Mobile-First UX Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure navigation (36 links/7 collapsible sections → ~26 links/4 always-open sections + 2 direct links), add a mobile bottom tab bar, and make dialogs + entity detail pages mobile-first — per `docs/superpowers/specs/2026-07-12-mobile-ux-simplification-design.md`.

**Architecture:** `nav-items.ts` stays the single source of truth (sidebar + command palette + new tab bar). Mobile behavior lands in shared primitives (`ui/dialog.tsx`, `ui/input.tsx`, `entity-detail-unified.tsx`) so every screen inherits it. Three floor screens get targeted verification/fixes.

**Tech Stack:** Next.js App Router, Tailwind v4 (`max-sm:` variants), radix-ui dialog, shadcn sidebar (mobile sheet reused for "More"), vitest.

## Global Constraints

- Work in a NEW worktree under `.claude/worktrees/` (repo convention), branch `feat/mobile-ux-simplification`. Run `bun install` after creating the worktree. NEVER work on main.
- Gates before every commit: `bun run lint`, `bun run typecheck`, `bun run test` (vitest — never `bun test`). Suite baseline ~2100 tests green.
- NO new dependencies. NO route/URL changes. NO Co-Authored-By lines in commits. Commit prefixes: feat/fix/docs/refactor.
- Test idiom: this repo has NO `@testing-library/react`; component tests use `createRoot`+`act`. Prefer pure-function tests (no DOM) where possible.
- `useIsMobile` breakpoint is 768px; Tailwind `max-sm:` is <640px. Dialogs/tab bar use CSS breakpoints; JS checks use the hooks in `src/hooks/use-mobile.ts`.
- Update stale module comments in every file you touch (repo rule: docs in the same commit).

---

### Task 1: Restructure nav-items + both consumers (sidebar, command palette)

**Files:**
- Modify: `src/components/domain/shared/nav-items.ts` (full rewrite below)
- Modify: `src/components/domain/shared/app-sidebar.tsx` (remove Collapsible machinery, render `NavEntry[]`)
- Modify: `src/components/domain/shared/command-palette.tsx:367-381` (nav rendering block only)
- Test: `src/components/domain/shared/__tests__/nav-items.test.ts` (new)

**Interfaces:**
- Produces: `export type NavEntry = NavItem | NavSection`, `export function isNavSection(entry: NavEntry): entry is NavSection`, `export const navigation: NavEntry[]`. Task 3's tab bar links to hrefs asserted in the test.

- [ ] **Step 1: Write the failing test**

Create `src/components/domain/shared/__tests__/nav-items.test.ts`:

```ts
/**
 * Structural tests for the simplified navigation (spec 2026-07-12).
 * Pins: 2 direct links + 4 sections, unique rooted hrefs, the cut links
 * stay cut, and the floor destinations the mobile tab bar targets exist.
 */
import { describe, expect, it } from "vitest";
import {
  navigation,
  isNavSection,
  type NavItem,
} from "@/components/domain/shared/nav-items";

const flat: NavItem[] = navigation.flatMap((e) =>
  isNavSection(e) ? e.items : [e]
);
const hrefs = flat.map((i) => i.href);

describe("navigation structure", () => {
  it("has exactly 2 direct links and 4 sections, in order", () => {
    const kinds = navigation.map((e) => (isNavSection(e) ? "section" : "link"));
    expect(kinds).toEqual(["link", "section", "section", "section", "section", "link"]);
    expect(navigation.filter(isNavSection).map((s) => s.label)).toEqual([
      "Production", "Inventory", "Purchasing", "Sales",
    ]);
  });

  it("every href is unique and rooted", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href).toMatch(/^\//);
  });

  it("cut links stay out of the nav (reachable in-page instead)", () => {
    for (const gone of [
      "/production/planning/backward",
      "/dashboard/inventory",
      "/dashboard/sales",
      "/reports/ttb",
      "/reports/production-summary",
      "/reports/inventory-valuation",
      "/reports/batch-cost",
      "/reports/projections",
      "/reports/cogs",
      "/reports/trace",
    ]) {
      expect(hrefs).not.toContain(gone);
    }
  });

  it("keeps the floor destinations the mobile tab bar targets", () => {
    for (const kept of [
      "/dashboard",
      "/production/batches",
      "/production/packaging",
      "/inventory/items",
      "/sales/pick-lists",
      "/reports",
    ]) {
      expect(hrefs).toContain(kept);
    }
  });

  it("every entry has a label and an icon", () => {
    for (const entry of navigation) {
      expect(entry.label).toBeTruthy();
      expect(entry.icon).toBeTruthy();
      if (isNavSection(entry)) expect(entry.items.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test nav-items`
Expected: FAIL — `isNavSection` is not exported / structure mismatch.

- [ ] **Step 3: Rewrite `nav-items.ts`**

Replace the whole file with:

```ts
/**
 * Navigation Items
 *
 * Single source of truth for the app's main navigation structure.
 * Consumed by the sidebar (AppSidebar), the cmd+K command palette
 * (CommandPalette), and the mobile bottom tab bar (MobileTabBar)
 * so the three never drift apart.
 *
 * Shape (2026-07-12 mobile-UX spec): direct links + always-open sections.
 * Dashboard and Reports are direct links — their sub-pages are reached via
 * in-page switchers (DashboardSwitcher pills, /reports index), not the nav.
 */

import {
  AnimatedLayoutDashboard,
  AnimatedFlask,
  AnimatedDollarSign,
  AnimatedFileText,
  AnimatedUsers,
  AnimatedClipboardList,
  AnimatedBarChart3,
  AnimatedTruck,
  AnimatedShoppingCart,
  AnimatedTrendingUp,
  AnimatedChartColumn,
  AnimatedPackageCheck,
  AnimatedWarehouse,
  AnimatedBuilding2,
  AnimatedCalendarClock,
  AnimatedArrowRightLeft,
  AnimatedContainer,
  AnimatedBatches,
  AnimatedUpload,
  AnimatedDownload,
  AnimatedDroplet,
  AnimatedFileStack,
  AnimatedWaypoints,
  AnimatedDrum,
  AnimatedRoute,
  AnimatedShip,
  AnimatedFileCheck,
  AnimatedCheckCheck,
  AnimatedBoxes,
} from "@/components/icons/animated";
import type { AnimatedIconProps } from "@/components/icons/animated";

export type AnimatedIcon = React.ComponentType<AnimatedIconProps>;

export type NavItem = {
  label: string;
  href: string;
  icon: AnimatedIcon;
}

export type NavSection = {
  label: string;
  icon: AnimatedIcon;
  items: NavItem[];
}

/** A top-level nav entry: either a direct link or a section of links. */
export type NavEntry = NavItem | NavSection;

export function isNavSection(entry: NavEntry): entry is NavSection {
  return "items" in entry;
}

export const navigation: NavEntry[] = [
  { label: "Dashboard", href: "/dashboard", icon: AnimatedLayoutDashboard },
  {
    label: "Production",
    icon: AnimatedFlask,
    items: [
      { label: "Batches", href: "/production/batches", icon: AnimatedBatches },
      { label: "Recipes", href: "/production/recipes", icon: AnimatedFileText },
      { label: "Planning", href: "/production/planning", icon: AnimatedCalendarClock },
      { label: "Cellar", href: "/production/cellar", icon: AnimatedWarehouse },
      { label: "Vessels", href: "/production/vessels", icon: AnimatedContainer },
      { label: "Vessel Transfers", href: "/production/vessel-transfers", icon: AnimatedArrowRightLeft },
      { label: "Brew Logs", href: "/production/brew-logs", icon: AnimatedClipboardList },
      { label: "Yeast Pitches", href: "/production/yeast-pitches", icon: AnimatedDroplet },
      { label: "Packaging", href: "/production/packaging", icon: AnimatedPackageCheck },
    ],
  },
  {
    label: "Inventory",
    icon: AnimatedWarehouse,
    items: [
      { label: "Raw Materials", href: "/inventory/items", icon: AnimatedUpload },
      { label: "Finished Goods", href: "/inventory/finished-goods", icon: AnimatedDownload },
      { label: "Lots", href: "/inventory/lots", icon: AnimatedFileStack },
      { label: "Kegs", href: "/inventory/kegs", icon: AnimatedDrum },
      { label: "Bins", href: "/inventory/bins", icon: AnimatedBoxes },
      { label: "Transfers", href: "/inventory/transfers", icon: AnimatedRoute },
      { label: "Allocations", href: "/inventory/allocations", icon: AnimatedWaypoints },
    ],
  },
  {
    label: "Purchasing",
    icon: AnimatedTruck,
    items: [
      { label: "Purchase Orders", href: "/purchasing/pos", icon: AnimatedShoppingCart },
      { label: "Suppliers", href: "/purchasing/suppliers", icon: AnimatedBuilding2 },
      { label: "Material Planning", href: "/purchasing/material-planning", icon: AnimatedChartColumn },
      { label: "Ingredient Demand", href: "/purchasing/demand", icon: AnimatedTrendingUp },
    ],
  },
  {
    label: "Sales",
    icon: AnimatedDollarSign,
    items: [
      { label: "Orders", href: "/sales/orders", icon: AnimatedFileCheck },
      { label: "Pick Lists", href: "/sales/pick-lists", icon: AnimatedCheckCheck },
      { label: "Deliveries", href: "/inventory/deliveries", icon: AnimatedShip },
      { label: "Customers", href: "/sales/customers", icon: AnimatedUsers },
    ],
  },
  { label: "Reports", href: "/reports", icon: AnimatedBarChart3 },
];
```

The removed icons (`AnimatedGauge`, `AnimatedChartLine`, `AnimatedArrowLeft`, `AnimatedLayers`, `AnimatedPackage`, `AnimatedFolderOpen`, `AnimatedShieldCheck`, `AnimatedHandCoins`, `AnimatedCircleDollarSign`, `AnimatedTelescope`, `AnimatedCog`) leave the import list — lint will flag any leftover unused import.

- [ ] **Step 4: Update `app-sidebar.tsx`**

Remove: the `Collapsible/CollapsibleContent/CollapsibleTrigger` import, `AnimatedChevronDown` from the icons import, the entire `AnimatedSectionHeader` component, the `openSections` `useState`, and the `activeSection` computation. Change the nav import to `import { navigation, isNavSection } from "@/components/domain/shared/nav-items";` and drop the `NavSection` type import if now unused.

Replace the `<SidebarContent>` nav block (currently the `navigation.map((section) => <Collapsible …>)` loop) with:

```tsx
      <SidebarContent>
        <nav aria-label="Main navigation">
        {navigation.map((entry) =>
          isNavSection(entry) ? (
            <SidebarGroup key={entry.label}>
              <SidebarGroupLabel className="flex items-center gap-2">
                <entry.icon className="h-4 w-4" />
                {entry.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {entry.items.map((item) => (
                    <AnimatedNavLink
                      key={item.href}
                      href={item.href}
                      icon={item.icon}
                      label={item.label}
                      isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : (
            <SidebarGroup key={entry.href}>
              <SidebarMenu>
                <AnimatedNavLink
                  href={entry.href}
                  icon={entry.icon}
                  label={entry.label}
                  isActive={pathname === entry.href || pathname.startsWith(entry.href + "/")}
                />
              </SidebarMenu>
            </SidebarGroup>
          )
        )}
        </nav>
      </SidebarContent>
```

Update the module comment (sections are always open — no collapse; nav is a `NavEntry[]` union). `AnimatedNavLink`, header, and footer stay as-is.

- [ ] **Step 5: Update `command-palette.tsx`**

Change the import at line 70 to `import { navigation, isNavSection } from "@/components/domain/shared/nav-items";` and add `import type { NavItem } from "@/components/domain/shared/nav-items";`. Replace the nav rendering block (lines 367–381, the `navigation.map((section) => …)` loop) with:

```tsx
        <CommandGroup heading="Pages">
          {navigation
            .filter((entry): entry is NavItem => !isNavSection(entry))
            .map((item) => (
              <CommandItem
                key={item.href}
                value={item.label}
                onSelect={() => navigate(item.href)}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </CommandItem>
            ))}
        </CommandGroup>
        {navigation.filter(isNavSection).map((section) => (
          <CommandGroup key={section.label} heading={section.label}>
            {section.items.map((item) => (
              <CommandItem
                key={item.href}
                // Include the section label so e.g. "production batches" matches.
                value={`${section.label} ${item.label}`}
                onSelect={() => navigate(item.href)}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
```

(Note the type-guard filter — a plain `!isNavSection(entry)` predicate does NOT narrow to `NavItem[]`.)

- [ ] **Step 6: Run gates**

Run: `bun run test nav-items` → PASS. Then `bun run lint && bun run typecheck && bun run test`
Expected: all green (existing `command-palette.test.ts` doesn't touch `navigation` — if it fails, read the failure; do not weaken it).

- [ ] **Step 7: Commit**

```bash
git add src/components/domain/shared/nav-items.ts src/components/domain/shared/app-sidebar.tsx src/components/domain/shared/command-palette.tsx src/components/domain/shared/__tests__/nav-items.test.ts
git commit -m "feat(nav): simplify navigation to 2 direct links + 4 always-open sections"
```

---

### Task 2: Dashboard switcher pills on the three dashboard pages

**Files:**
- Create: `src/components/dashboard/dashboard-switcher.tsx`
- Modify: `src/components/dashboard/index.ts` (add export)
- Modify: `src/app/(app)/dashboard/page.tsx:233-236`, `src/app/(app)/dashboard/inventory/page.tsx:153-156`, `src/app/(app)/dashboard/sales/page.tsx:273-276` (header rows)

**Interfaces:**
- Produces: `export function DashboardSwitcher(): JSX.Element` — link pills for the three dashboards, `aria-current` on the active one. No props.

- [ ] **Step 1: Create the component**

`src/components/dashboard/dashboard-switcher.tsx` (pattern copied from the Planning page's Shortfalls/Orders/Timeline pills at `src/app/(app)/production/planning/page.tsx:127-140`):

```tsx
"use client";

/**
 * DashboardSwitcher — link pills between the three dashboards.
 *
 * The nav has a single "Dashboard" entry (2026-07-12 mobile-UX spec);
 * Inventory and Sales dashboards are reached through these pills instead
 * of dedicated sidebar links. Same visual pattern as the Production
 * Planning page's Shortfalls/Orders/Timeline switcher.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const DASHBOARDS = [
  { label: "Production", href: "/dashboard" },
  { label: "Inventory", href: "/dashboard/inventory" },
  { label: "Sales", href: "/dashboard/sales" },
] as const;

export function DashboardSwitcher() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Dashboards"
      className="bg-muted flex w-fit items-center gap-1 rounded-lg p-0.5 text-sm"
    >
      {DASHBOARDS.map((d) => {
        const active = pathname === d.href;
        return (
          <Link
            key={d.href}
            href={d.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-7 items-center rounded-md px-3",
              active
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {d.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

Add to `src/components/dashboard/index.ts`:

```ts
export { DashboardSwitcher } from "./dashboard-switcher";
```

- [ ] **Step 2: Wire into the three dashboard pages**

Each page adds `DashboardSwitcher` to its existing `@/components/dashboard` import. Header edits (title row only — PeriodSelector/"View All" links untouched):

`dashboard/page.tsx` (line ~234):

```tsx
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Production Dashboard</h1>
            <DashboardSwitcher />
          </div>
```

(was `<div className="flex items-baseline justify-between">` + bare `<h1>`; the closing `</div>` for the new inner wrapper goes right after `<DashboardSwitcher />`.)

`dashboard/inventory/page.tsx` (line ~154): identical edit with `Inventory Dashboard`.

`dashboard/sales/page.tsx` (line ~274): the row is currently `flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between` — change to `flex flex-wrap items-center justify-between gap-2` and wrap `<h1>` + `<DashboardSwitcher />` in the same inner `<div className="flex flex-wrap items-center gap-3">`.

- [ ] **Step 3: Run gates**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: green (no existing tests cover these page headers).

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/dashboard-switcher.tsx src/components/dashboard/index.ts "src/app/(app)/dashboard/page.tsx" "src/app/(app)/dashboard/inventory/page.tsx" "src/app/(app)/dashboard/sales/page.tsx"
git commit -m "feat(dashboard): in-page switcher pills replace the 3 dashboard nav links"
```

---

### Task 3: Mobile bottom tab bar + shell wiring

**Files:**
- Create: `src/components/domain/shared/mobile-tab-bar.tsx`
- Modify: `src/app/(app)/layout.tsx` (render tab bar, bottom padding)
- Modify: `src/components/domain/shared/app-header.tsx:61` (remove `SidebarTrigger`)
- Modify: `src/components/universal/entity-mobile-card-list.tsx:278` (FAB clears the tab bar)
- Test: `src/components/domain/shared/__tests__/mobile-tab-bar.test.ts` (new)

**Interfaces:**
- Consumes: hrefs guaranteed by Task 1's test (`/production/batches`, `/inventory/items`, `/sales/pick-lists`); `useSidebar().setOpenMobile` from `@/components/ui/sidebar`.
- Produces: `export function isTabActive(pathname: string, href: string): boolean`; `export function MobileTabBar(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

`src/components/domain/shared/__tests__/mobile-tab-bar.test.ts`:

```ts
/** Active-state logic for the mobile bottom tab bar. */
import { describe, expect, it } from "vitest";
import { isTabActive } from "@/components/domain/shared/mobile-tab-bar";

describe("isTabActive", () => {
  it("matches the exact path", () => {
    expect(isTabActive("/production/batches", "/production/batches")).toBe(true);
  });
  it("matches nested paths", () => {
    expect(isTabActive("/production/batches/abc-123", "/production/batches")).toBe(true);
  });
  it("does not match sibling prefixes", () => {
    expect(isTabActive("/production/batches-archive", "/production/batches")).toBe(false);
  });
  it("does not match other sections", () => {
    expect(isTabActive("/inventory/items", "/production/batches")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test mobile-tab-bar`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

`src/components/domain/shared/mobile-tab-bar.tsx`:

```tsx
"use client";

/**
 * MobileTabBar — fixed bottom navigation on phones (<md).
 *
 * Three primary floor-workflow destinations (brewhouse + warehouse personas,
 * 2026-07-12 mobile-UX spec) plus "More", which opens the full nav in the
 * shadcn sidebar's mobile sheet. Hidden on md+ where the sidebar is visible.
 * z-40 sits under the mobile filter sheet (z-50) and over the FAB (z-30).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, Warehouse, ClipboardCheck, Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Batches", href: "/production/batches", icon: FlaskConical },
  { label: "Inventory", href: "/inventory/items", icon: Warehouse },
  { label: "Picks", href: "/sales/pick-lists", icon: ClipboardCheck },
] as const;

/** Active when the path is the tab target or nested under it. Exported for tests. */
export function isTabActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export function MobileTabBar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  const itemClass =
    "flex min-h-14 flex-col items-center justify-center gap-1 text-xs";

  return (
    <nav
      aria-label="Primary"
      className="bg-background fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map((tab) => {
        const active = isTabActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(itemClass, active ? "text-foreground font-medium" : "text-muted-foreground")}
          >
            <tab.icon className="h-5 w-5" aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        className={cn(itemClass, "text-muted-foreground")}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
        More
      </button>
    </nav>
  );
}
```

- [ ] **Step 4: Wire into the app shell**

`src/app/(app)/layout.tsx` — import `MobileTabBar` from `@/components/domain/shared/mobile-tab-bar` and change the render to:

```tsx
        <SidebarInset className="max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
          <ChatLayout header={<AppHeader user={user} breweryName={breweryName} breweryLogoSvg={breweryLogoSvg} />}>
            {children}
          </ChatLayout>
        </SidebarInset>
        <MobileTabBar />
```

(`MobileTabBar` must stay INSIDE `<SidebarProvider>` — it calls `useSidebar()`. `max-md:` padding matches the tab bar's `md:hidden`.)

`src/components/domain/shared/app-header.tsx` — delete line 61 (`<SidebarTrigger className="md:hidden" />`) and the now-unused `SidebarTrigger` import; update the module comment (the header no longer hosts the mobile nav trigger — the tab bar's More does).

`src/components/universal/entity-mobile-card-list.tsx` line 278 — the FAB must clear the tab bar:

```tsx
        <div className="fixed right-6 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 md:hidden">
```

(was `bottom-[calc(1.5rem+env(safe-area-inset-bottom))]`; 3.5rem tab bar + 1rem gap). Update the FAB comment block (lines ~270-276) to mention the tab-bar offset.

- [ ] **Step 5: Run gates**

Run: `bun run test mobile-tab-bar` → PASS, then `bun run lint && bun run typecheck && bun run test`
Expected: green. (`entity-mobile-card-list` has characterization tests — if one pins the old `bottom-` class, update the assertion to the new value.)

- [ ] **Step 6: Commit**

```bash
git add src/components/domain/shared/mobile-tab-bar.tsx src/components/domain/shared/__tests__/mobile-tab-bar.test.ts "src/app/(app)/layout.tsx" src/components/domain/shared/app-header.tsx src/components/universal/entity-mobile-card-list.tsx
git commit -m "feat(mobile): bottom tab bar (Batches/Inventory/Picks/More) replaces hamburger"
```

---

### Task 4: Dialogs become bottom sheets on phones; inputs sized for touch

**Files:**
- Modify: `src/components/ui/dialog.tsx:64` (DialogContent classes), `:106` (DialogFooter classes)
- Modify: `src/components/ui/input.tsx:12` (mobile height + font size)

**Interfaces:**
- Produces: no API change — pure CSS. Every `DialogContent` consumer inherits the behavior.

- [ ] **Step 1: Edit `DialogContent`**

In the `cn(...)` first argument (line 64), append these classes (keep everything existing):

```
max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-h-[90dvh] max-sm:overflow-y-auto max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:p-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))] max-sm:data-[state=open]:slide-in-from-bottom-10 max-sm:data-[state=closed]:slide-out-to-bottom-10
```

Why this works: `max-sm:` variants are emitted later in the Tailwind output than the base utilities, so on <640px `top-auto`/`bottom-0`/`translate-*-0` win over `top-[50%]`/`translate-[-50%]` and the dialog anchors to the bottom edge full-width with internal scrolling. The existing zoom/fade animation is kept; the slide-from-bottom is additive on mobile. Add one comment line above `DialogContent` documenting the mobile bottom-sheet behavior.

- [ ] **Step 2: Edit `DialogFooter`**

Line 106, append `max-sm:[&_button]:min-h-11` to the class list — primary/cancel actions get ≥44px touch targets on phones (they're already full-width there via the existing `flex-col-reverse`).

- [ ] **Step 3: Edit `Input`**

Line 12: append `max-sm:h-11 max-sm:text-base` to the class string containing `h-8 … text-sm`. `text-base` (16px) also stops iOS Safari's auto-zoom on input focus — 14px inputs zoom the whole page.

- [ ] **Step 4: Run gates**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: green. If a test pins these exact class strings, update the assertion to include the new classes — nothing else.

- [ ] **Step 5: Visual check (dev server)**

Run the app (`bun run dev`), open any entity list at 390×844 (device toolbar), trigger a dialog (e.g., a batch state transition with `transitionFields`).
Expected: dialog rises from the bottom edge, full-width, scrolls internally, close button reachable; desktop (≥640px) unchanged — centered modal.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/dialog.tsx src/components/ui/input.tsx
git commit -m "feat(mobile): dialogs render as bottom sheets on phones; 44px inputs, no iOS zoom"
```

---

### Task 5: Entity detail pages — mobile header, collapsed actions, scrollable tabs

**Files:**
- Modify: `src/components/universal/entity-detail-unified.tsx` (header ~1218-1238, actions ~1265-1360, TabsList ~1600)

**Interfaces:**
- Consumes: `useIsMobile` from `@/hooks/use-mobile` (768px breakpoint — matches where list pages switch to cards).
- Produces: no API change.

- [ ] **Step 1: Stack the header on mobile**

Line 1218: `className="flex items-start justify-between"` → `className="flex items-start justify-between max-sm:flex-col max-sm:gap-3"`.
Line 1238: `className="flex items-center gap-1.5"` → `className="flex items-center gap-1.5 max-sm:flex-wrap"`.

- [ ] **Step 2: Collapse header action buttons into the Actions menu on mobile**

Import `useIsMobile`. Near the existing `headerButtonActions`/`dropdownActions` split (~line 831), add:

```tsx
  const isMobile = useIsMobile();
  // On phones the visible header buttons fold into the Actions menu so the
  // header stays a single compact control row (mobile-UX spec §3). Save /
  // Cancel / Edit stay visible — only configured actions collapse.
  const visibleHeaderActions = isMobile ? [] : headerButtonActions;
  const menuActions = isMobile
    ? [...headerButtonActions, ...dropdownActions]
    : dropdownActions;
```

In the returned JSX: `headerButtonActions.map(…)` (line ~1269) → `visibleHeaderActions.map(…)`; the dropdown-visibility condition `(dropdownActions.length > 0 || rawTransitions.length > 0)` (line ~1290) → `(menuActions.length > 0 || rawTransitions.length > 0)`; and every use of `dropdownActions` INSIDE the `<DropdownMenuContent>` block becomes `menuActions`. Nothing else in the action-dispatch logic changes — `runAction` already handles both kinds. Update the module comment lines 10-14 (visible header buttons collapse into the menu on mobile).

- [ ] **Step 3: Make the tab strip scrollable on mobile**

Line ~1599, wrap `TabsList`:

```tsx
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <div className="max-sm:overflow-x-auto">
        <TabsList className="max-sm:w-max">
          …existing triggers unchanged…
        </TabsList>
      </div>
```

(Relation tables need NO change — `ui/table.tsx` already wraps every table in `overflow-x-auto`; just verify in Step 5.)

- [ ] **Step 4: Run gates**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: green (`useIsMobile` returns `false` in jsdom, so existing action-rendering tests keep desktop behavior).

- [ ] **Step 5: Visual check**

Dev server at 390×844: open a batch detail page.
Expected: title/badge on top, actions row below wrapping cleanly, configured actions inside the "Actions" menu, tab strip pans horizontally, relation tables scroll inside their own wrapper. Desktop unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/universal/entity-detail-unified.tsx
git commit -m "feat(mobile): entity detail pages stack header, collapse actions, scroll tabs"
```

---

### Task 6: Targeted floor screens — measure first, then minimal fixes

**Files:**
- Verify (and only modify if a check fails): `src/components/domain/order/pick-list-items.tsx`, `src/components/domain/order/order-pick-list.tsx`, `src/components/domain/packaging/packaging-day-view.tsx`, `src/components/domain/packaging/session-line-items-editor.tsx`, `src/components/domain/purchasing/po-accept-inventory-dialog.tsx`

**Interfaces:** none — behavior-preserving layout fixes only.

- [ ] **Step 1: Measure first (repo guardrail — invoke the `measure-first` skill BEFORE any edit here)**

Dev server, device toolbar 390×844, walk each screen and record pass/fail per check:

| Screen | Checks |
|---|---|
| Pick list (open an order's pick list) | No horizontal body scroll; each pick row's check-off control ≥44px; bin/location text readable without zoom |
| Packaging day view + line-item editor | Line-item add/edit possible without horizontal scrolling; numeric inputs ≥44px (Task 4's input change should cover); action buttons reachable one-handed |
| PO receive dialog (accept a PO) | Renders correctly as a bottom sheet (Task 4); per-line qty inputs usable; submit reachable without scroll traps |

- [ ] **Step 2: Fix only failing checks, smallest diff**

Allowed fix vocabulary (all `max-sm:` scoped, matching repo idiom): `max-sm:flex-col` / `max-sm:grid-cols-1` to stack columns; `max-sm:min-h-11` on tap targets; `max-sm:overflow-x-auto` wrappers. No behavior changes, no refactors. Re-measure at 390×844 after each fix (never claim fixed without re-capturing).

- [ ] **Step 3: Run gates**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: green — these files have characterization tests (`session-line-items-editor.test.tsx`); layout-only class changes must not break them.

- [ ] **Step 4: Commit**

```bash
git add -A src/components/domain
git commit -m "fix(mobile): floor-screen touch/layout fixes from 390px verification pass"
```

(If Step 1 found zero failures, skip the commit and note it in the task report.)

---

### Task 7: Full verification, docs, PR

**Files:**
- Modify: `PROGRESS.md` (milestone bullet). No code changes expected.

- [ ] **Step 1: Full gates**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: all green, suite count ≥ baseline.

- [ ] **Step 2: Browser verification sweep (verify skill) at 390×844 AND ≥1280px**

Mobile: tab bar navigates to all three targets + More opens the full nav sheet; nav sheet shows 2 direct links + 4 sections; dashboard switcher pills navigate between the three dashboards; a transition dialog renders as a bottom sheet; batch detail page per Task 5; the three floor screens per Task 6; content never hides behind the tab bar (scroll each page to the end); FAB floats above the tab bar.
Desktop: sidebar shows all sections always-open; no tab bar; no hamburger; dialogs centered; cmd+K palette shows "Pages" group + the 4 sections.

- [ ] **Step 3: Update PROGRESS.md**

Add the newest bullet under `## Current state` summarizing: branch, what shipped (nav restructure, tab bar, dialog bottom sheets, detail-page mobile pass, floor-screen fixes), suite count, and that no migrations are involved.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin feat/mobile-ux-simplification
gh pr create --title "feat(mobile): mobile-first UX simplification — nav restructure + bottom tab bar + shared-primitive mobile pass" --body "Implements docs/superpowers/specs/2026-07-12-mobile-ux-simplification-design.md. Task log: docs/superpowers/plans/2026-07-12-mobile-ux-simplification.md."
```

(No Co-Authored-By, no generated-with footer per repo rules.)
