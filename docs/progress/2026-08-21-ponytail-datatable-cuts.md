- **2026-08-21 (ponytail audit items 18–20: data-table).** Worked items 18, 19 and
  20 of `docs/plans/2026-07-24-ponytail-audit-findings.md` against
  `src/components/data-table/`. Almost all of the candidate surface was already
  gone — cut only the genuinely dead `disabled` prop on `DataTableSortList`
  (no call site passed it). Item 19 rejected: there is no drag-to-reorder in the
  filter popover at all; the `Sortable` wrapper lives in the *sort* list, where
  row order is sort precedence and is therefore load-bearing. Item 20 rejected:
  `DataTableAdvancedToolbar` carries real `role="toolbar"` /
  `aria-orientation` semantics, its "reserved for future use" `table` prop is
  already gone, and its one consumer is in `src/components/universal/`, which was
  off-limits this session. Also rejected the `throttleMs: 50` pin in
  `data-table-filter-list.tsx`: nuqs' default throttle is **not** a constant
  (`getDefaultThrottle()` returns 120/320ms on Safari to dodge the
  `history.replaceState` rate limit), so dropping it is a behaviour change, not
  a dead-config cleanup. No drag-kit dependency was removed —
  `@/components/ui/sortable` is still live via the sort list.
  `make check` green.
