# Mobile-First UX Simplification — Design

**Date:** 2026-07-12
**Status:** Approved direction (brainstorm complete), pending spec review
**Scope decisions (user):** mobile personas = brewers in the brewhouse + warehouse/packaging staff; restructure navigation for both desktop and mobile; depth = nav + floor workflows (dashboards/reports get "don't break" responsiveness only); implementation = shared-primitives pass (no dedicated floor mode, no new routes).

## Problem

- Navigation is 7 collapsible sections / 36 links. On mobile it takes three interactions (hamburger → expand section → tap link) to go anywhere. Several sections are noise: "Packaging" holds one item; "Dashboards" and "Reports" spend 11 nav slots on pages that already have (or can trivially have) in-page navigation.
- Entity **list** pages already have real mobile treatment (`EntityMobileCardList`, filter bottom sheet, FAB — from the 2026-06 audit). The gaps are **navigation**, **dialogs** (~28 domain dialogs render as centered desktop modals), **entity detail pages** (single `max-sm:` class in `entity-detail-unified.tsx`), and a few **floor workflow screens**.

## Goals

1. Any primary destination reachable in ≤2 interactions on mobile, ≤1 on desktop.
2. Floor workflows (log readings, transfers, pitches, picks, PO receiving, packaging, counts) comfortably usable one-handed on a phone.
3. No new routes, no second UI surface, no new dependencies. URLs unchanged.

## Non-goals

- Dedicated "floor mode" routes.
- Mobile redesign of dashboards, reports, settings, or the recipe editor (they only must not break: no horizontal body scroll, no inaccessible controls).
- Changes to the customer portal.

## 1. Navigation structure

`src/components/domain/shared/nav-items.ts` stays the single source of truth, consumed by the sidebar, the command palette, and the new mobile tab bar.

New shape — 2 direct links + 4 sections (~26 links):

| Entry | Type | Contents |
|---|---|---|
| Dashboard | direct link | `/dashboard` |
| Production | section | Batches, Recipes, Planning, Cellar, Vessels, Vessel Transfers, Brew Logs, Yeast Pitches, Packaging Sessions |
| Inventory | section | Raw Materials, Finished Goods, Lots, Kegs, Bins, Transfers, Allocations |
| Purchasing | section | Purchase Orders, Suppliers, Material Planning, Ingredient Demand |
| Sales | section | Orders, Pick Lists, Deliveries, Customers |
| Reports | direct link | `/reports` (index page already lists every report) |

Type change: `navigation` becomes `NavEntry[]` where `NavEntry = NavItem | NavSection`. All three consumers updated in the same commit.

Removed from nav, kept in the app:
- **Backward Planning** (`/production/planning/backward`) → linked from the Planning page header.
- **7 report sub-links** → already on the `/reports` index.
- **Inventory/Sales dashboards** → segmented switcher (link pills) rendered on all three dashboard pages (`/dashboard`, `/dashboard/inventory`, `/dashboard/sales`).

Sidebar behavior: sections render **always open** — the Collapsible wrapper goes away; the sidebar scrolls. Permission gating (e.g., `settings:manage` for the footer Settings link) unchanged.

## 2. Mobile shell

- New `MobileTabBar` client component rendered in `src/app/(app)/layout.tsx`, `md:hidden`, `position: fixed` bottom, `padding-bottom: env(safe-area-inset-bottom)`.
- Tabs: **Batches** (`/production/batches`), **Inventory** (`/inventory/items`), **Picks** (`/sales/pick-lists`), **More**. Active state by pathname prefix. Each target ≥44px tall.
- **More** opens the existing shadcn sidebar mobile sheet (`useSidebar().setOpenMobile(true)`) showing the full simplified nav — reused, not rebuilt.
- The header's `SidebarTrigger` (hamburger, `md:hidden`) is removed; More replaces it.
- Main content gets bottom padding on mobile equal to the tab bar height so nothing hides behind it (including the existing mobile FAB, which moves up accordingly).

## 3. Shared-component mobile behavior

- **`ui/dialog.tsx`** — on `max-sm`: bottom-anchored, full-width, `rounded-t-lg` (square bottom), `max-h-[90dvh]`, internal `overflow-y-auto`, slide-up animation. Desktop rendering unchanged. One file → all ~28 domain dialogs become thumb-reachable bottom sheets.
- **`universal/entity-detail-unified.tsx`** — on mobile: header stacks vertically; action buttons collapse into a single dropdown menu; `TabsList` becomes a horizontally scrollable strip (no wrap, no overflow clipping); relation tables (`entity-relation-table`) wrap in `overflow-x-auto`.
- **Touch targets** — on touch devices (`useIsTouch` exists in `src/hooks/use-mobile`), interactive controls inside dialogs and detail pages get ≥44px hit areas. Implemented at the primitive level (button/input sizing on `max-sm`), not per-screen.

## 4. Targeted floor screens

Per-screen verification and fixes (only these):

1. **Pick lists** — `domain/order/pick-list-items.tsx` (+ order-pick-list): single-column card flow on mobile, check-off targets ≥44px.
2. **Packaging day view** — `domain/packaging/packaging-day-view.tsx` + `session-line-items-editor.tsx` (already partially responsive): line-item entry usable without horizontal scrolling.
3. **PO receiving** — `domain/purchasing/po-accept-inventory-dialog.tsx` (already partially responsive): verify under new bottom-sheet dialog behavior.

Brew-log / gravity / transfer / pitch dialogs are covered by the shared dialog change; they get verification, not bespoke work.

## 5. Error handling

No new data paths, mutations, or error surfaces. Navigation and layout changes only. Existing dialogs keep their own submit/error handling.

## 6. Testing & verification

- `bun run lint`, `bun run typecheck`, `bun run test` stay green; update existing tests that assert on nav structure or dialog markup.
- New unit coverage: nav-items shape (direct links + sections resolve for all three consumers), MobileTabBar active-state logic.
- Browser verification (verify skill) at 390×844: tab bar navigation, More sheet, one dialog as bottom sheet, one entity detail page, and the three targeted screens.
- A11y: tab bar is a `<nav aria-label="Primary">` with links (not buttons), visible focus, `aria-current="page"` on the active tab.

## 7. Rollout

Single feature branch/worktree, one PR. Suggested build order: (1) nav-items restructure + sidebar/palette, (2) mobile tab bar + shell, (3) dialog bottom-sheet + detail-page mobile layout, (4) targeted screens + browser verification. No migrations, no data changes.
