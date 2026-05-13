# Plan: Whole-Unit BOM Quantities

**Branch:** `feat/bom-whole-units`
**Worktree:** `.claude/worktrees/bom-whole-units`
**Goal:** Make the BOM/material-planning flow handle packaging materials like trays, quadpacks, and lids with correct integer math, and make the BOM editor + receive form intuitive without schema changes.

---

## Background

`selling_format_materials.quantity_per_unit` is `DECIMAL(10,4)` where one "unit" is one consumer item (a can/bottle). Today a single decimal field stores the ratio, the demand calc multiplies `planned_quantity * quantity_per_unit`, and the materials preview renders the raw decimal. Three problems:

1. Entering `0.0417` for "1 tray per 24 cans" is hostile UX.
2. Multiplying through a 4-decimal approximation of `1/24` gives `200.16`, not `200`.
3. Receivers buy in bundles (250 trays per stack) but the system only tracks individual units.

User decision: solve all three in the UI/calc layer. **No schema changes.**

---

## Approach

- **Whole-unit detection** is derived from `inventory_items.unit` — `each` and `case` are whole; `lb`/`oz`/`kg`/`g`/`gal` are bulk.
- **BOM input** becomes a two-field "X per Y" pair for whole-unit materials; bulk items keep the single decimal.
- **Demand calc** treats the stored decimal as a ratio for whole-unit lines and computes via integer math + aggregate ceiling. Bulk lines unchanged.
- **Materials preview** ceils whole-unit totals to integers; bulk totals format as decimals.
- **Receive dialog** gets an optional inline calculator: "Bundles × per-bundle = Qty". Pack size not persisted.

---

## Tasks

### 1. Add `src/lib/inventory-units.ts`
- Export `WHOLE_UNIT_VALUES = new Set(['each', 'case'])`.
- Export `isWholeUnit(unit: string | null | undefined): boolean`.
- Export `ratioFromDecimal(v: number, opts?: { maxDen?: number; tolerance?: number }): { numerator: number; denominator: number } | null` — finds the nearest fraction p/q with q ≤ maxDen (default 100) within tolerance (default 0.0005). Returns `null` if no clean ratio fits.
- Export `computeWholeUnitRequired(qpu: number, planned: number): number` — for a single line item under whole-unit math, returns the integer count needed:
  - `qpu >= 1`: `Math.round(qpu) * planned`
  - `qpu < 1`: `Math.ceil(planned * qpu)` — uses the decimal directly, then ceil; precision drift handled at aggregate.
- Acceptance: unit tests for each helper covering the canonical cases (lid=1, quadpack=1/4, tray=1/24, 2-per-1, bulk).

### 2. Update demand calc in `src/hooks/use-material-planning.ts`
- Inside `useSessionMaterialPreview`, after building per-line `required`, branch on the inventory_item's `unit`:
  - Whole-unit: aggregate raw `qpu * planned` decimals into `total_required` as today, but **flag the row as whole** so the consumer can ceil at render.
  - Bulk: unchanged.
- Add `is_whole_unit: boolean` to `SessionMaterialPreview` type.
- Decide on aggregation strategy: store the raw decimal `total_required`. The display layer ceils whole-unit values; the SQL RPC remains untouched.
- Acceptance: existing tests still pass; new tests cover whole vs bulk classification on the returned preview.

### 3. Update `src/components/domain/packaging-session-materials.tsx`
- Read `m.is_whole_unit` from preview rows.
- For whole-unit rows: render `Math.ceil(m.total_required).toLocaleString()` in **Needed**, and the same for **Shortfall** (`Math.max(0, Math.ceil(needed) - Math.floor(on_hand))`).
- For bulk rows: today's `.toLocaleString()` behavior unchanged.
- Acceptance: 4,800 cans × 1/24 tray renders as "200" in the Needed column, not "200.16" or "201".

### 4. Replace qty input in `src/components/domain/selling-format-bom-editor.tsx`
- Pull `item.unit` into `BOMRow` and decide whole vs bulk.
- Whole-unit: two compact `<Input type="number">` fields stacked horizontally — "**[ 1 ]** per **[ 24 ]**" with a slash separator. Use `ratioFromDecimal` on load; if it returns null, fall back to single decimal.
- Bulk: today's single decimal field.
- On blur of either whole-unit field, compute `numerator / denominator` and call the existing `updateMutation` with `quantity_per_unit`.
- Acceptance: editing a row that stores `0.25` shows "1 per 4"; saving "1 per 24" writes ≈ `0.0417`.

### 5. Add bundles calculator in `src/components/domain/po-receive-dialog.tsx`
- Add a small dismissible row above the Quantity field: a checkbox "Enter as bundles" that reveals two compact inputs `[bundles] × [per bundle]` and a read-only computed total.
- When the checkbox is on and both fields have values, the Quantity field value is set to `bundles * per_bundle` and disabled.
- Pack size is not persisted anywhere. Default: off.
- Acceptance: receiving "10 × 250" fills Quantity with "2500" and the form submits 2500 to `po_receives.quantity`.

### 6. Tests
- `src/lib/__tests__/inventory-units.test.ts` — `isWholeUnit`, `ratioFromDecimal`, `computeWholeUnitRequired`.
- Optionally: extend an existing material-planning test if one exists, otherwise skip — most logic is pure-fn in `inventory-units.ts`.

### 7. Validation
- `bun typecheck`
- `bun lint`
- `bun run test`
- Manual UI walkthrough: BOM editor → materials preview → PO receive dialog.

### 8. Commit & PR
- Single commit on `feat/bom-whole-units` with subject `feat: whole-unit math + intuitive BOM/receive UX`.
- PR description summarizing the four UI surfaces and the no-schema-changes constraint.

---

## Files touched

| File | Change |
|---|---|
| `src/lib/inventory-units.ts` | **new** — helpers |
| `src/lib/__tests__/inventory-units.test.ts` | **new** — tests |
| `src/hooks/use-material-planning.ts` | add `is_whole_unit` to type + classification in `useSessionMaterialPreview` |
| `src/components/domain/packaging-session-materials.tsx` | ceil display for whole units |
| `src/components/domain/selling-format-bom-editor.tsx` | dual-input for whole, single for bulk |
| `src/components/domain/po-receive-dialog.tsx` | bundles calculator |

No migrations, no schema changes, no RPC changes.

---

## Non-goals (deferred)

- Persisting pack size on inventory items (would unlock auto-populated bundles, but adds a column).
- Updating `calculate_packaging_material_demand` and `calculate_material_shortfalls` RPCs to do the same ceiling — current uses don't render single-format numbers, so the precision drift is small and tolerable. If/when it bites, those are pure function-body changes.
- Cases-vs-cans toggle on the session line items editor.
