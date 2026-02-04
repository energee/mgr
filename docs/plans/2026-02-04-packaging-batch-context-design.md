# Packaging Session Batch Context Design

## Problem

Packaging sessions don't reference batches. The `session_line_items.source_batches` JSONB field exists in the schema and the completion trigger reads from it to create finished goods, but the UI never exposes it. Users have no way to:
- See which batches are available when planning packaging
- Link a line item to a specific batch
- Get batch context (status, volume, vessel) during packaging

## Solution

Add interactive batch selection to the session line items editor. When a user selects a brand for a line item, show a batch dropdown filtered to that brand's batches (via batch -> recipe -> brand). Write the selection to `source_batches` JSONB.

## Architecture

**No schema changes needed.** The data model already supports this:
- `session_line_items.source_batches` JSONB: `[{batch_id, planned_qty, actual_qty}]`
- Completion trigger reads `source_batches[0].batch_id` to create finished goods
- Batch -> Recipe -> Brand gives brand linkage

**Single batch per line item.** If packaging from multiple batches, create multiple line items. Matches the trigger which reads `source_batches[0]`.

## UI Changes

### Session Line Items Editor

Add a **Batch** column between Brand and Package Type:

| Brand | Batch | Package Type | Planned Qty | Actual Qty | |
|-------|-------|-------------|-------------|------------|--|

**Batch dropdown behavior:**
- Disabled until a brand is selected
- Queries `batches_with_brew_info` joined through `recipes` to filter by brand
- Shows all active batches (planned, fermenting, conditioning, packaging)
- Sorted by readiness: conditioning first, then packaging, fermenting, planned
- Each option: `{batch_number} - {name} [{StatusBadge}] {volume_bbl} bbl`
- Status badges use existing batch state machine colors
- Optional (not required) - some line items may not have a batch yet

**Data flow:**
- On batch selection: write `source_batches = [{batch_id: <id>, planned_qty: null, actual_qty: null}]`
- On quantity changes: also update the corresponding field in `source_batches[0]`
- On save: `source_batches` persisted to DB alongside other fields

### Existing Line Items Display

For existing line items that already have `source_batches` populated, show the batch info in a read-only badge or link.

## Query

```sql
-- Batches available for a brand (via recipe)
SELECT b.id, b.batch_number, b.name, b.status, b.volume_bbl,
       bwi.current_vessel_name
FROM batches b
JOIN recipes r ON b.recipe_id = r.id
LEFT JOIN batches_with_brew_info bwi ON bwi.id = b.id
WHERE r.brand_id = :brand_id
  AND b.status IN ('planned', 'fermenting', 'conditioning', 'packaging')
ORDER BY
  CASE b.status
    WHEN 'conditioning' THEN 1
    WHEN 'packaging' THEN 2
    WHEN 'fermenting' THEN 3
    WHEN 'planned' THEN 4
  END,
  b.planned_start_date DESC;
```

## Components Modified

1. `src/components/domain/session-line-items-editor.tsx` - Add batch dropdown column and source_batches write logic
2. `src/lib/query-keys.ts` - Add `packagingKeys.batchesForBrand(brandId)` factory
3. `src/components/domain/session-line-items-display.tsx` - Show batch info for existing items (read-only view)
