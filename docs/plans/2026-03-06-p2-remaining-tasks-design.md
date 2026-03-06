# P2 Remaining Tasks — Design

**Date**: 2026-03-06
**Branch**: `implementation`
**Scope**: 3 remaining P2 tasks from productionization audit

---

## Task 30: CI Vulnerability Scanning on PRs

**Problem**: `pnpm audit --audit-level=high` only runs on main branch pushes (e2e job), not during PR review.

**Solution**: Add `pnpm audit --audit-level=high` step to the `quality` job in `.github/workflows/test.yml` after the build step. Use `continue-on-error: true` (informational, non-blocking). Also fix any merge conflict markers in the file.

---

## Task 35: Brew Event Accessibility

**Problem**: Edit and delete icon-only buttons in `brew-event-timeline.tsx` (lines 348-363) lack `aria-label` attributes.

**Solution**: Add `aria-label="Edit event"` and `aria-label="Delete event"` to the respective `<Button>` components.

---

## Task 34: Mobile Responsiveness — Full Redesign

**Breakpoint**: `md` (768px). Below this, mobile layouts activate. Above, existing layouts unchanged.

### 34a. Gantt Timeline (`/production/planning/timeline`)

**Current issues**: Fixed `w-40` vessel sidebar, fixed `w-12` day columns, no responsive breakpoints.

**Mobile layout (below md):**
- **Vessel sidebar**: Collapse to a horizontal scrollable tab bar at the top. Vessel names render as pills/chips. Tapping a vessel scrolls the timeline to that row.
- **Day columns**: Reduce from `w-12` (48px) to `w-10` (40px). Keep horizontal scroll with momentum scrolling.
- **Batch bars**: Keep drag-to-reschedule. Increase touch target height to minimum 44px (Apple HIG). Add long-press to open detail dialog (prevents conflict with drag gesture).
- **Header controls**: Stack date range selector, view mode toggle, and navigation buttons vertically. Use full-width selects instead of fixed `w-[140px]`.
- **Today indicator and date headers**: No changes needed.

### 34b. Pricing Matrix (`/settings/pricing`)

**Current issues**: `table-fixed` layout with hardcoded `w-[120px]` columns, no responsive fallback.

**Mobile layout (below md):**
- Replace the wide table with a tier card list.
- Each tier becomes a card:
  - Tier name as card header
  - Format/price pairs in a 2-column grid (format name | price input)
  - Grouped by container type with section dividers
- Edit behavior: Tap a price to edit inline (same as current cell editing).
- Above `md`: Keep current sticky table layout unchanged.

### 34c. Data Tables (`entity-data-table.tsx`)

**Current issues**: No mobile fallback, relies on horizontal scroll in Dice UI DataTable.

**Mobile layout (below md):**
- Render rows as stacked cards instead of table rows.
- Each card shows the first 3 `listColumns` from the entity config (typically: name, status, date).
- Status shown as `StatusBadge` in the card header.
- Tap card navigates to detail page (same as current row click).
- Search, filters, and pagination remain above the card stack.
- Board/kanban view unchanged (already card-based).
- Above `md`: Keep current table layout unchanged.

**Implementation**: Add a `useMediaQuery("md")` hook. Conditionally render `<MobileCardList>` vs `<DataTable>` in `entity-data-table.tsx`. Card component reads from entity config's `listColumns` to determine displayed fields.

---

## Decisions

- Gantt is fully interactive on mobile (drag-to-reschedule preserved)
- Data tables use card stack layout (recommended over condensed table or list view)
- CI audit is informational only (non-blocking)
- All mobile layouts activate below `md` (768px)
