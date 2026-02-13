# WCAG 2.1 AA+ Accessibility Compliance

## Target

WCAG 2.1 AA with select AAA criteria (enhanced contrast, reduced motion).

## Approach

Universal-first: fix the core components that render all entity pages, then mop up domain-specific components. ~12 files touched, fixes propagate to all 15+ entity pages.

## Decisions

- **Contrast:** Bump `--muted-foreground` globally (not per-usage audit)
- **Charts:** aria-label + visually-hidden data table
- **Testing:** Stricter eslint-plugin-jsx-a11y rules (no axe-core integration tests)

---

## Section 1: Global CSS & Layout

### `globals.css`
- Bump `--muted-foreground` from `oklch(0.50 ...)` to ~`oklch(0.42 ...)` (light mode)
- Bump `--muted-foreground` from `oklch(0.65 ...)` to ~`oklch(0.70 ...)` (dark mode)
- Verify status badge color combos (orange-on-orange `info` variant) meet 4.5:1, adjust if needed
- Add `@media (prefers-reduced-motion: reduce)` block disabling `caret-blink`, `animate-spin`, dialog transitions, and `transition-*` utilities

### `layout.tsx` (root)
- Add skip-to-content link as first child of `<body>`: `<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to main content</a>`

### `(app)/layout.tsx` (authenticated)
- Content area uses `<main id="main-content">` landmark
- Sidebar wrapped in `<nav aria-label="Main navigation">`

## Section 2: Forms & Inputs (`field-input.tsx`)

- Generate IDs: `${field.name}-error`, `${field.name}-description`
- Add `aria-describedby` to every input (pointing to error and/or description)
- Add `aria-invalid={!!error}` when error present
- Add `aria-required="true"` when `field.required`
- Error `<p>` gets `id` and `role="alert"`
- Required `*` gets `<span className="sr-only">(required)</span>`

Propagates to all input types (text, textarea, number, select, relation, switch, date, datetime, unit) via `renderFieldInput`.

## Section 3: Entity Data Table (`entity-data-table.tsx`)

- View toggle buttons: `aria-label="Table view"` / `"Board view"` + `aria-pressed`
- Loading spinner: wrap in `<div role="status"><span className="sr-only">Loading...</span></div>`
- Decorative icons: `aria-hidden="true"`
- `<Kbd>` shortcut hints: wrap in `aria-hidden="true"`

## Section 4: Entity Detail Unified (`entity-detail-unified.tsx`)

- Validation error summary: `<div role="alert" aria-live="assertive">` at top of form with anchor links to fields, focus moves here on failure
- Fix `aria-hidden` to `aria-hidden="true"` (explicit string)
- `<dl>` in view mode: no change (semantically correct for label-value pairs)

## Section 5: Domain Components

### `chat-panel.tsx`
- Maximize/minimize toggle: `aria-label={isMaximized ? "Minimize chat" : "Maximize chat"}`

### `notification-bell.tsx`
- Priority dots: add `<span className="sr-only">{priority} priority</span>`
- Action buttons: `title` → `aria-label`
- Decorative bell icon: `aria-hidden="true"`

### `batch-readings-chart.tsx`
- Wrap chart in `<figure role="figure" aria-label="Batch readings over time">`
- Add visually-hidden `<table className="sr-only">` with chart data

### `app-header.tsx`
- Brewery logo: meaningful `alt` text (brewery name)

### `app-sidebar.tsx`
- `<nav aria-label="Main navigation">` wrapper (deduplicate with layout changes)

## Section 6: ESLint

- Change `eslint-plugin-jsx-a11y` from `recommended` to `strict`
- Fix any new errors surfaced by stricter rules

## Summary

| Layer | Files | Issues Fixed |
|-------|-------|-------------|
| Global CSS + Layout | `globals.css`, `layout.tsx`, `(app)/layout.tsx` | Contrast, skip link, landmarks, reduced motion |
| Forms | `field-input.tsx` | Error association, aria-invalid, aria-required |
| Data table | `entity-data-table.tsx` | Icon labels, loading announcement, toggle state |
| Detail page | `entity-detail-unified.tsx` | Error summary, aria-hidden fix |
| Domain components | 4 files | Labels, alt text, chart data table, priority text |
| Sidebar | `app-sidebar.tsx` | Nav landmark |
| ESLint | config file | Strict jsx-a11y rules |
