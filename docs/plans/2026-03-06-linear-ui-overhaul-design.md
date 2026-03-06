# Linear-Inspired UI Overhaul

## Goal

Transform MGR's visual identity from warm/brewery-themed to a sleek, monochromatic Linear-style aesthetic. Brewery identity comes from the logo and product, not the color system.

## Design Pillars

1. Dense, information-rich lists
2. Smooth micro-animations
3. Minimal chrome, maximum content
4. Dark, sleek aesthetic (both modes equally polished)

## Phase 1: Color System & Chrome Reduction

### Color Palette (OkLCH)

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `background` | `oklch(0.99 0 0)` | `oklch(0.13 0.005 260)` |
| `foreground` | `oklch(0.15 0.005 260)` | `oklch(0.93 0 0)` |
| `card` | `oklch(0.99 0 0)` | `oklch(0.16 0.005 260)` |
| `muted` | `oklch(0.955 0.005 260)` | `oklch(0.20 0.005 260)` |
| `muted-foreground` | `oklch(0.55 0.01 260)` | `oklch(0.55 0.01 260)` |
| `border` | `oklch(0.92 0.005 260)` | `oklch(0.24 0.005 260)` |
| `primary` | `oklch(0.45 0.18 265)` (indigo) | `oklch(0.65 0.18 265)` |
| `accent` | `oklch(0.45 0.18 265)` | `oklch(0.65 0.18 265)` |
| `sidebar` | `oklch(0.97 0.005 260)` | `oklch(0.11 0.005 260)` |
| `sidebar-foreground` | `oklch(0.15 0.005 260)` | `oklch(0.85 0 0)` |
| `sidebar-accent` | `oklch(0.93 0.005 260)` | `oklch(0.20 0.005 260)` |
| `destructive` | `oklch(0.55 0.22 25)` | `oklch(0.65 0.22 25)` |

### Chrome Reduction

- Remove all card `box-shadow` — rely on 1px `border` only
- Reduce `border-radius` from `0.5rem` to `0.375rem` (6px)
- Strip card padding from `py-6 px-6` to `py-4 px-4`
- Remove warm radial gradient backdrop texture
- Light mode sidebar becomes near-white (not dark)
- Cards same background as page — separated by borders only

## Phase 2: List Density & Data Tables

### Row Density

- Row height: ~36px (down from ~48px)
- Cell padding: `py-1.5 px-3`
- Font size: `text-sm` (13px) for all table content
- Monospace for IDs, batch numbers, dates: `font-mono text-xs`

### Row Content

- Status: small colored dot (6px) + text label, not a full badge
- Inline secondary info in muted text
- Truncate long text with tooltip on hover

### Toolbar

- Search: borderless, icon + text, border on focus only
- Filters: compact pill-style toggles
- Column visibility: moved to `...` menu
- Active filter count as small badge
- "New" button: ghost style with `+` icon

### Table Header

- `text-[11px] font-medium uppercase tracking-wider text-muted-foreground`
- No background color, just bottom border
- Sticky on scroll

### Empty State

- Centered icon + message + action button
- Muted illustration style

### Pagination

- Minimal: "1-25 of 142" + prev/next arrows only

## Phase 3: Micro-Animations

### Hover States

- Table rows: `bg-muted/50` with 150ms ease
- Buttons: brightness shift, no scale
- Sidebar links: background slides in from left
- Universal: `transition-colors duration-150`

### Page Transitions

- Content fade-in on route change (opacity 0-1, 150ms)
- No sliding or scaling

### Loading States

- Skeleton: shimmer sweep animation (left-to-right gradient)
- Save buttons: spinner replaces text during async
- Inline loading: small spinner next to element

### Micro-Interactions

- Status dot: scale pulse on change (1-1.3-1, 200ms spring)
- Collapsible sections: smooth height with AnimatePresence
- Toasts: slide in from top-right with spring physics

### Restraint

- No page-level slide transitions
- No bounce/overshoot on navigation
- No hover scale on cards or rows

## Phase 4: Detail Pages & Forms

### Detail Header

- Flat, no card wrapper — content directly on page background
- Breadcrumb: `text-xs text-muted-foreground` with `/` separators
- Title: `text-lg font-medium` with inline status dot
- Actions: icon buttons in a row, not hidden in dropdown

### Sections

- No card wrappers — separated by `border-b` + `py-4` spacing
- Section titles: `text-xs font-medium uppercase tracking-wider text-muted-foreground`
- Fields in tight grid, labels as `text-xs text-muted-foreground`
- Related entity links: underline on hover only

### Form Inputs (Edit Mode)

- Borderless — bottom border only, full border on focus
- Height: `h-8` (32px)
- Labels: `text-xs font-medium text-muted-foreground`
- Error: red left border + red text below
- Focus: `ring-1 ring-primary/30`

### Action Bar (Edit Mode)

- Sticky bottom bar with Save/Cancel, slide-up animation when dirty
- Keyboard shortcut hints as `<Kbd>` badges

## Files to Modify

### Phase 1
- `src/app/globals.css` — color tokens, shadows, radius
- `src/components/ui/card.tsx` — remove shadows, reduce padding
- `src/app/(app)/layout.tsx` — remove backdrop texture
- `src/components/domain/app-sidebar.tsx` — light sidebar in light mode

### Phase 2
- `src/components/universal/entity-data-table.tsx` — row density, column rendering
- `src/components/data-table/data-table-advanced-toolbar.tsx` — toolbar simplification
- `src/components/universal/status-badge.tsx` — dot + text variant
- `src/components/data-table/data-table-pagination.tsx` — minimal pagination

### Phase 3
- `src/app/globals.css` — shimmer keyframes
- `src/components/ui/skeleton.tsx` — shimmer animation
- New: `src/components/ui/page-transition.tsx` — route fade-in wrapper
- Various hover state updates across components

### Phase 4
- `src/components/universal/entity-detail-unified.tsx` — flat sections, header
- `src/components/universal/field-input.tsx` — borderless inputs
- `src/components/ui/input.tsx` — base input styling
- New: `src/components/universal/sticky-action-bar.tsx` — edit mode bar
