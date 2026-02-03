# Minimalist UI Redesign

## Philosophy

**Text is the interface. Decoration earns its place.**

Icons should only appear when they encode information that text cannot. Cards should group content, not wrap every metric. Links should be links, not icon-decorated buttons. Numbers speak for themselves.

The current UI follows the "SaaS dashboard template" aesthetic: every metric in a card, every card has an icon in a colored circle, every button has an icon prefix, every list item has a leading icon. This makes everything feel equally important and visually noisy.

## Scope

Content pages only. The sidebar navigation is out of scope.

Affected areas:
- Production dashboard (`src/app/(app)/dashboard/page.tsx`)
- Inventory dashboard (`src/app/(app)/dashboard/inventory/page.tsx`)
- Sales dashboard (`src/app/(app)/dashboard/sales/page.tsx`)
- Universal EntityList (`src/components/universal/entity-list.tsx`)
- Universal EntityDetail (`src/components/universal/entity-detail.tsx`)
- Any domain components that follow the same patterns

## Decisions

### Status badges: keep, but remove icons from inside them
Badges provide quick scanability for status. Remove the icon that appears inside badges (e.g., FlaskConical inside a "Fermenting" badge). Text-only badges are sufficient.

### Search icon in inputs: keep
The search icon inside an input is a universal convention that aids usability. This icon earns its place.

### Row action dots (MoreHorizontal): keep
Standard three-dot menu pattern per row. Functional, not decorative.

### Cards: keep for grouping
Cards provide useful visual separation, especially on detail pages and dashboard sections. But simplify what goes inside them — no icon circles, no icon-decorated headers.

## Changes by Component

### 1. All Page Headers

**Before:** Icon + h1 title + subtitle paragraph
**After:** h1 title only

- Remove the icon from all page headers (Activity, Package, DollarSign, etc.)
- Remove subtitle paragraphs ("Overview of production status..." etc.) — these restate what's obvious from context

### 2. Dashboard Stat Cards

**Before:** Card > CardHeader with title + colored-circle-icon > CardContent with big number + description
**After:** Card > CardHeader with title > CardContent with big number + description

- Remove the icon element (the colored circle with white icon inside) from stat card headers
- Keep the Card wrapper and layout structure

### 3. Dashboard Section Headers

**Before:** CardTitle with inline icon + CardDescription + Button with ArrowRight
**After:** CardTitle text only + CardDescription + plain text link

- Remove icons from CardTitle (TrendingDown, Calendar, etc.)
- Replace "View All" buttons (outlined, with ArrowRight icon) with plain text links styled as `text-sm text-muted-foreground hover:text-foreground underline`

### 4. Dashboard List Items

**Before:** Colored-circle-with-category-icon + item text + data
**After:** Item text + data (no leading icon)

- Remove per-row entity icons (Container for vessels, category icons for inventory items)
- Remove colored icon circles from low-stock items, category summaries, etc.

### 5. Dashboard Status Badges (in lists)

**Before:** Badge with icon + status text
**After:** Badge with status text only

- Remove the icon from inside status badges (e.g., `<config.icon className="h-3 w-3" />` inside batch status badges)

### 6. Dashboard Empty States

**Before:** Large faded icon + text message
**After:** Text message only

- Remove the centered icons from empty states (FlaskConical, Package, Calendar, etc.)

### 7. Dashboard Vessel Stats

**Before:** 3 mini-cards with centered icon + number + label
**After:** Inline text row: `4 in use · 2 available · 1 maintenance`

- Replace the 3-column grid of icon-stat-cards with a single line of inline stats
- Keep the utilization progress bar — it's useful visual information

### 8. Production Planning Alert

**Before:** Full Card with CalendarClock icon, title, AlertTriangle icon, ArrowRight button
**After:** Compact alert line or slim card: `3 shortfalls — 1 urgent` with link to planning page

- Remove CalendarClock and AlertTriangle icons
- Replace the full-width card with a more compact presentation
- Keep the destructive/amber border for urgency signaling

### 9. Category Summary (Inventory Dashboard)

**Before:** Grid of icon-circle + number + category name
**After:** Inline stats or simple list: `Malt: 12 · Hops: 8 · Yeast: 4`

- Remove the colored icon circles per category

### 10. EntityList — Create Button

**Before:** `<Plus icon> New {Entity}`
**After:** `New {Entity}` (text only)

- Remove Plus icon from all "New" / "Create" buttons

### 11. EntityList — Filter Bar

**Before:** `<Filter icon>` prefix + dropdowns + `<X icon> Clear` button
**After:** Dropdowns only + "Clear filters" text link

- Remove the Filter icon that precedes the filter dropdowns
- Replace the "Clear" button (with X icon) with a plain text link "Clear filters"

### 12. EntityList — Sort Indicators

**Before:** Every sortable column shows ChevronsUpDown when unsorted
**After:** Only the currently sorted column shows a chevron (up or down)

- Remove the ChevronsUpDown icon from unsorted columns
- Keep ChevronUp/ChevronDown on the active sort column

### 13. EntityList — Empty State Create Button

**Before:** `<Plus icon> Create {Entity}` button
**After:** `Create {Entity}` button (no icon)

### 14. EntityDetail — Back Navigation

**Before:** Ghost button with `<ArrowLeft icon> Back`
**After:** Text link with `← Back` (unicode left arrow)

- Change from Button component to a plain Link styled as text

### 15. EntityDetail — Edit Button

**Before:** Outlined button with `<Pencil icon> Edit`
**After:** Outlined button with `Edit` (text only)

- Remove Pencil icon from Edit button

### 16. EntityDetail — Actions Dropdown

**Before:** `Actions <MoreHorizontal dots>`
**After:** `Actions <ChevronDown>`

- Replace MoreHorizontal with ChevronDown on the actions dropdown trigger — ChevronDown communicates "dropdown" more clearly

### 17. EntityDetail — Relation "Add" Buttons

**Before:** `<Plus icon> Add {Related Entity}`
**After:** `Add {Related Entity}` (text only)

## Implementation Order

1. **EntityList** — widest impact, changes propagate to all list pages
2. **EntityDetail** — second widest impact
3. **Production Dashboard** — most visible page
4. **Inventory Dashboard** — same patterns as production
5. **Sales Dashboard** — same patterns
6. **Audit pass** — grep for remaining decorative icon usage in domain components

## Files to Modify

### Universal components (propagate everywhere)
- `src/components/universal/entity-list.tsx`
- `src/components/universal/entity-detail.tsx`

### Dashboards
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/dashboard/inventory/page.tsx`
- `src/app/(app)/dashboard/sales/page.tsx`

### Possible domain component audit
- Any component in `src/components/domain/` that uses decorative icons
- Entity configs that embed icons in status displays

## What NOT to Change

- Sidebar navigation icons (out of scope)
- Search icon in input fields (earns its place)
- MoreHorizontal on row action menus (standard pattern)
- Loading spinners (Loader2)
- Functional icons in editors (Trash2 for delete, GripVertical for drag)
- Toast/notification icons
