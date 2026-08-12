/**
 * Material-planning domain math — packaging/shipping BOM rollups and shortfalls.
 *
 * React-free by construction: every function here is a plain calculation over
 * plain rows, so a non-React caller (a server route, an AI tool, a future
 * frontend) can plan materials without importing a hook. The Supabase reads
 * that feed these functions live in `src/services/material-planning-service.ts`;
 * the React-Query wrappers over that service live in
 * `src/hooks/use-material-planning.ts`.
 *
 * The whole-unit rule this module implements is the same one described in
 * `src/test/whole-unit-parity-fixtures.ts`: `quantity_per_unit` is stored as
 * `DECIMAL(10,4)`, so a "1 per 24" BOM line persists as `0.0417` — strictly
 * greater than 1/24 — and multiplying the decimal before ceiling books a
 * phantom extra unit. Recover the exact integer ratio first, then ceil.
 *
 * Deliberately NOT merged with `computeBomConsumption`
 * (`src/domain/consumption-planning.ts`), which looks almost identical. That
 * one is the *actual*-quantity depletion path and differs in three ways this
 * one must not adopt: it skips non-positive quantities, it drops zero-valued
 * results, and it returns bare totals rather than display metadata. This one
 * is the *planned*-quantity preview and keeps zero rows so the operator sees
 * every material a session will touch. Both are pinned to
 * WHOLE_UNIT_PARITY_CASES so the shared ratio/ceiling rule cannot drift apart.
 */

import { isWholeUnit, ratioFromDecimal } from "@/domain/inventory-units";

// =============================================================================
// Row shapes
// =============================================================================

/** Display fields joined from `inventory_items` onto a material row. */
export type MaterialInventoryItem = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string | null;
};

/** A single line item in a selling format's bill of materials. */
export type SellingFormatMaterial = {
  id: string;
  selling_format_id: string;
  inventory_item_id: string;
  quantity_per_unit: number;
  notes: string | null;
  inventory_item: MaterialInventoryItem | null;
};

/**
 * A material shortfall row from `calculate_material_shortfalls()`.
 * Covers brewing ingredients, packaging materials, and shipping materials.
 */
export type MaterialShortfall = {
  inventory_item_id: string;
  inventory_item_name: string;
  category: string | null;
  demand_source: string | null;
  needed_by_date: string | null;
  quantity_needed: number;
  on_hand: number;
  incoming_po: number;
  shortfall: number;
  unit: string | null;
  best_supplier_id: string | null;
  best_supplier_name: string | null;
  lead_time_days: number | null;
  drop_dead_date: string | null;
  is_past_due: boolean;
  source_count: number;
};

/** Material requirement for a specific order. */
export type OrderMaterial = {
  id: string;
  order_id: string;
  inventory_item_id: string;
  /** Auto-calculated estimated quantity based on BOM x order items. */
  estimated_qty: number;
  /** User-overridable actual quantity; null means "use estimated_qty". */
  actual_qty: number | null;
  inventory_item: MaterialInventoryItem | null;
};

/** A packaging-session line item, as the preview rollup needs it. */
export type SessionMaterialLineItem = {
  selling_format_id: string | null;
  planned_quantity: number | null;
  batch_id: string | null;
};

/** A BOM row for the preview rollup (a subset of `SellingFormatMaterial`). */
export type SessionMaterialBomLine = {
  selling_format_id: string;
  inventory_item_id: string;
  quantity_per_unit: number;
  inventory_item: MaterialInventoryItem | null;
};

/** An on-hand lot row; multiple lots per item are summed. */
export type MaterialOnHandRow = {
  inventory_item_id: string;
  remaining_quantity: number;
};

/**
 * A material requirement for a session, before on-hand is known.
 * `total_required` is already per-batch-ceiled for whole-unit materials.
 */
export type SessionMaterialRequirement = {
  inventory_item_id: string;
  inventory_item_name: string;
  sku: string | null;
  category: string | null;
  unit: string | null;
  total_required: number;
  is_whole_unit: boolean;
};

/**
 * Aggregated material preview for a packaging session, display-ready.
 *
 * Whole-unit rows (each, case) have `total_required` ceiled and
 * `on_hand_quantity` floored — fractional consumption is meaningless for
 * trays/lids/etc. Bulk rows retain decimal precision.
 */
export type SessionMaterialPreview = SessionMaterialRequirement & {
  on_hand_quantity: number;
  shortfall: number;
};

// =============================================================================
// Shortfalls
// =============================================================================

/**
 * Narrow shortfall rows to one demand source. `undefined` and the sentinel
 * `"all"` both mean "no filter" — the caller fetches every source once per
 * horizon and slices client-side rather than refetching per source.
 */
export function filterShortfallsByDemandSource(
  rows: MaterialShortfall[],
  demandSource?: string,
): MaterialShortfall[] {
  if (demandSource && demandSource !== "all") {
    return rows.filter((r) => r.demand_source === demandSource);
  }
  return rows;
}

// =============================================================================
// Session material preview
// =============================================================================

/** Unique, non-null selling format ids referenced by the line items. */
export function collectSellingFormatIds(
  lineItems: readonly SessionMaterialLineItem[],
): string[] {
  return [
    ...new Set(
      lineItems
        .map((li) => li.selling_format_id)
        .filter((id): id is string => !!id),
    ),
  ];
}

/** BOM row plus its loop-invariant whole-unit facts, computed once. */
type EnrichedBomLine = SessionMaterialBomLine & {
  whole: boolean;
  ratio: { numerator: number; denominator: number } | null;
};

/** Index BOM lines by selling format, precomputing whole-unit facts per row. */
function indexBomByFormat(
  bomLines: readonly SessionMaterialBomLine[],
): Map<string, EnrichedBomLine[]> {
  const byFormat = new Map<string, EnrichedBomLine[]>();
  for (const bom of bomLines) {
    const whole = isWholeUnit(bom.inventory_item?.unit ?? null);
    const enriched: EnrichedBomLine = {
      ...bom,
      whole,
      ratio: whole ? ratioFromDecimal(bom.quantity_per_unit) : null,
    };
    const existing = byFormat.get(bom.selling_format_id);
    if (existing) existing.push(enriched);
    else byFormat.set(bom.selling_format_id, [enriched]);
  }
  return byFormat;
}

/**
 * Roll planned line-item quantities up against the BOM into per-item
 * requirements.
 *
 * Whole-unit materials are ceiled PER BATCH before summing, mirroring the
 * completion path: `consumePackagingMaterials`
 * (`src/services/consumption-service.ts`) groups line items by batch and ceils
 * each batch's whole-unit need on its own, because a partial case/tray cannot
 * be shared across two different batches. Line items with no batch share one
 * bucket. Bulk materials just sum. (M8: per-batch is the canonical ceiling
 * semantic.)
 *
 * Within a batch, whole-unit quantities are accumulated through the exact
 * integer ratio recovered from the stored decimal where one exists, so 4800
 * cans at a stored `0.0417` do not sum to 200.16 and ceil to 201 trays.
 *
 * Line items without a selling format or planned quantity contribute nothing.
 */
export function computeSessionMaterialRequirements(
  lineItems: readonly SessionMaterialLineItem[],
  bomLines: readonly SessionMaterialBomLine[],
): SessionMaterialRequirement[] {
  const bomByFormat = indexBomByFormat(bomLines);

  const perBatch = new Map<string, Map<string, number>>();
  const itemMeta = new Map<string, Omit<SessionMaterialRequirement, "total_required">>();
  for (const li of lineItems) {
    if (!li.selling_format_id || li.planned_quantity == null) continue;
    const batchKey = li.batch_id ?? "nobatch";
    let byItem = perBatch.get(batchKey);
    if (!byItem) {
      byItem = new Map<string, number>();
      perBatch.set(batchKey, byItem);
    }
    for (const bom of bomByFormat.get(li.selling_format_id) ?? []) {
      const required = bom.ratio
        ? (li.planned_quantity * bom.ratio.numerator) / bom.ratio.denominator
        : bom.quantity_per_unit * li.planned_quantity;
      byItem.set(
        bom.inventory_item_id,
        (byItem.get(bom.inventory_item_id) ?? 0) + required,
      );
      if (!itemMeta.has(bom.inventory_item_id)) {
        itemMeta.set(bom.inventory_item_id, {
          inventory_item_id: bom.inventory_item_id,
          inventory_item_name: bom.inventory_item?.name ?? bom.inventory_item_id,
          sku: bom.inventory_item?.sku ?? null,
          category: bom.inventory_item?.category ?? null,
          unit: bom.inventory_item?.unit ?? null,
          is_whole_unit: bom.whole,
        });
      }
    }
  }

  // Collapse to per-item totals: ceil each batch's whole-unit contribution
  // (`Math.ceil(raw - 1e-9)`, matching computeBomConsumption), then sum across
  // batches. Bulk contributions sum unchanged.
  const aggregated = new Map<string, SessionMaterialRequirement>();
  for (const byItem of perBatch.values()) {
    for (const [itemId, raw] of byItem) {
      const meta = itemMeta.get(itemId)!;
      const contribution = meta.is_whole_unit ? Math.ceil(raw - 1e-9) : raw;
      const existing = aggregated.get(itemId);
      if (existing) existing.total_required += contribution;
      else aggregated.set(itemId, { ...meta, total_required: contribution });
    }
  }

  return [...aggregated.values()];
}

/**
 * Attach on-hand and shortfall to each requirement, sorted by shortfall
 * descending.
 *
 * On-hand is summed across every lot of an item, then floored for whole-unit
 * materials so consumers can render integers directly (`total_required` was
 * already ceiled upstream). Shortfall is clamped at zero.
 */
export function applyOnHandToRequirements(
  requirements: readonly SessionMaterialRequirement[],
  onHandRows: readonly MaterialOnHandRow[],
): SessionMaterialPreview[] {
  const onHandByItem = new Map<string, number>();
  for (const row of onHandRows) {
    const prev = onHandByItem.get(row.inventory_item_id) ?? 0;
    onHandByItem.set(row.inventory_item_id, prev + (row.remaining_quantity ?? 0));
  }

  return requirements
    .map((entry) => {
      const raw = onHandByItem.get(entry.inventory_item_id) ?? 0;
      const on_hand_quantity = entry.is_whole_unit ? Math.floor(raw) : raw;
      return {
        ...entry,
        on_hand_quantity,
        shortfall: Math.max(0, entry.total_required - on_hand_quantity),
      };
    })
    .sort((a, b) => b.shortfall - a.shortfall);
}
