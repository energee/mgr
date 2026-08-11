/**
 * COGS Report Calculations
 *
 * Pure aggregation / business logic for the Cost of Goods Sold report
 * (src/app/(app)/reports/cogs/page.tsx). All functions are data-in → data-out
 * with no Supabase calls, so the math is unit-testable in isolation
 * (see src/lib/__tests__/cogs.test.ts). The page owns the queries and passes
 * the fetched rows here.
 *
 * Covers:
 * - generic cost/unit aggregation helpers,
 * - proportional SKU cost allocation (batch cost split across SKUs by the
 *   share of the batch's packaged units each SKU represents),
 * - period bucketing (monthly/quarterly) with ingredient-category breakdown.
 */

import { format, parseISO, startOfMonth, startOfQuarter } from "date-fns";

// =============================================================================
// Types
// =============================================================================

/** Allocation row shape consumed by the COGS calculations */
export type CogsAllocationRow = {
  destination_id: string | null;
  quantity: number;
  unit_cost: number | null;
  source_id?: string | null;
  source_type?: string | null;
}

/** Finished goods row shape used for unit aggregation */
export type CogsFinishedGoodRow = {
  batch_id: string | null;
  quantity: number | null;
}

/** Finished goods row with brand/format joins, used for SKU allocation */
export type SkuFinishedGoodRow = CogsFinishedGoodRow & {
  brands: { name: string } | null;
  selling_formats: {
    name: string;
    containers: { name: string } | null;
  } | null;
}

/** Cost grouped by brand + selling format (SKU) */
export type CogsSkuRow = {
  sku_name: string;
  brand_name: string;
  format_name: string;
  container_name: string;
  batch_count: number;
  total_units: number;
  total_cost: number;
  avg_cost_per_unit: number | null;
  avg_cost_per_bbl: number | null;
  batches: { id: string; batch_code: string; cost: number; units: number }[];
}

/** Cost breakdown by time period with ingredient category split */
export type CogsPeriodRow = {
  period: string;
  /** ISO date used for chronological sorting (not displayed). */
  _sortKey: string;
  total_cogs: number;
  malt_cost: number;
  hop_cost: number;
  yeast_cost: number;
  adjunct_cost: number;
  other_cost: number;
  batch_count: number;
}

export type CogsGranularity = "monthly" | "quarterly";

// =============================================================================
// Aggregation helpers
// =============================================================================

/**
 * Aggregates numeric costs from allocations into a Map keyed by a caller-supplied
 * key function. Each allocation's line cost is `quantity * (unit_cost ?? 0)`.
 */
export function aggregateCostByKey<
  T extends { quantity: number; unit_cost: number | null },
>(allocations: T[], keyFn: (alloc: T) => string | null): Map<string, number> {
  const map = new Map<string, number>();
  for (const alloc of allocations) {
    const key = keyFn(alloc);
    if (!key) continue;
    const lineCost = alloc.quantity * (alloc.unit_cost ?? 0);
    map.set(key, (map.get(key) ?? 0) + lineCost);
  }
  return map;
}

/**
 * Aggregates quantity from finished goods rows by batch_id.
 * Returns a Map of batch_id -> total quantity.
 */
export function aggregateUnitsByBatch(
  finishedGoods: CogsFinishedGoodRow[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const fg of finishedGoods) {
    if (!fg.batch_id) continue;
    map.set(fg.batch_id, (map.get(fg.batch_id) ?? 0) + (fg.quantity ?? 0));
  }
  return map;
}

// =============================================================================
// SKU cost allocation
// =============================================================================

/**
 * Groups finished goods by SKU (brand + selling format) and allocates each
 * batch's total ingredient cost across its SKUs proportionally to the units
 * packaged: `(batch cost * SKU units from batch) / total batch units`.
 *
 * `totalUnitsByBatch` is the denominator and MUST represent each batch's
 * complete packaged-unit count, not just the units present in `fgRows`. A
 * caller that windows `fgRows` by date (e.g. a report's from/to filter) but
 * leaves `allocations` unwindowed — so `costByBatch` is the batch's full
 * cost — must pass an unwindowed `totalUnitsByBatch` too, or the proportional
 * cost is inflated by `totalUnits / unitsInWindow` and double-counted across
 * adjacent report windows. When `fgRows` is already unwindowed (contains
 * every finished-goods row for every batch referenced), pass
 * `aggregateUnitsByBatch(fgRows)`.
 *
 * For batches whose finished goods are all in `fgRows`, the proportional
 * costs of a batch sum back to that batch's total cost.
 *
 * Rows missing a batch_id are skipped. Batches with zero packaged units
 * contribute zero cost. Result is sorted by total_cost descending.
 */
export function buildSkuCostRows(
  fgRows: SkuFinishedGoodRow[],
  allocations: CogsAllocationRow[],
  batchInfo: { id: string; batch_code: string }[],
  totalUnitsByBatch: Map<string, number>
): CogsSkuRow[] {
  // Aggregate total cost per batch
  const costByBatch = aggregateCostByKey(allocations, (a) => a.destination_id);

  const batchNumberMap = new Map<string, string>();
  for (const b of batchInfo) {
    batchNumberMap.set(b.id, b.batch_code);
  }

  // Group by SKU key (brand_name + format_name)
  const skuMap = new Map<
    string,
    {
      brand_name: string;
      format_name: string;
      container_name: string;
      total_units: number;
      total_cost: number;
      batchSet: Set<string>;
      batches: { id: string; batch_code: string; cost: number; units: number }[];
    }
  >();

  for (const fg of fgRows) {
    if (!fg.batch_id) continue;

    const brandName = fg.brands?.name ?? "Unknown";
    const formatName = fg.selling_formats?.name ?? "Unknown";
    const containerName = fg.selling_formats?.containers?.name ?? "";
    const skuKey = `${brandName}||${formatName}`;

    const batchTotalCost = costByBatch.get(fg.batch_id) ?? 0;
    const batchTotalUnits = totalUnitsByBatch.get(fg.batch_id) ?? 0;
    const fgQuantity = fg.quantity ?? 0;

    // Proportional cost: (batch cost * fg units from this SKU) / total batch units
    const proportionalCost =
      batchTotalUnits > 0 ? (batchTotalCost * fgQuantity) / batchTotalUnits : 0;

    const existing = skuMap.get(skuKey) ?? {
      brand_name: brandName,
      format_name: formatName,
      container_name: containerName,
      total_units: 0,
      total_cost: 0,
      batchSet: new Set<string>(),
      batches: [],
    };

    existing.total_units += fgQuantity;
    existing.total_cost += proportionalCost;

    if (!existing.batchSet.has(fg.batch_id)) {
      existing.batchSet.add(fg.batch_id);
      existing.batches.push({
        id: fg.batch_id,
        batch_code: batchNumberMap.get(fg.batch_id) ?? "??",
        cost: proportionalCost,
        units: fgQuantity,
      });
    } else {
      // Update existing batch entry
      const batchEntry = existing.batches.find((b) => b.id === fg.batch_id);
      if (batchEntry) {
        batchEntry.cost += proportionalCost;
        batchEntry.units += fgQuantity;
      }
    }

    skuMap.set(skuKey, existing);
  }

  // Build result rows
  const result: CogsSkuRow[] = Array.from(skuMap.values()).map((sku) => ({
    sku_name: `${sku.brand_name} - ${sku.format_name}`,
    brand_name: sku.brand_name,
    format_name: sku.format_name,
    container_name: sku.container_name,
    batch_count: sku.batchSet.size,
    total_units: sku.total_units,
    total_cost: sku.total_cost,
    avg_cost_per_unit:
      sku.total_units > 0 ? sku.total_cost / sku.total_units : null,
    avg_cost_per_bbl: null, // Not applicable at SKU level
    batches: sku.batches,
  }));

  return result.sort((a, b) => b.total_cost - a.total_cost);
}

// =============================================================================
// Period bucketing with category breakdown
// =============================================================================

/**
 * Buckets allocation line costs into monthly or quarterly periods (by the
 * destination batch's created_at) and splits each period's total into
 * ingredient-category columns via `categoryByLotId` (allocation source_id →
 * lowercase inventory_items.category).
 *
 * Category values come from inventory_items.category in the database:
 * "grain", "hops", "yeast", "adjunct", "packaging", "other". Unmapped or
 * unknown categories fall into other_cost, so the category columns always
 * sum to total_cogs.
 *
 * Allocations whose destination batch is not in `batches` are skipped.
 * Result is sorted chronologically.
 */
export function buildPeriodRows(
  allocations: CogsAllocationRow[],
  batches: { id: string; created_at: string }[],
  categoryByLotId: Map<string, string>,
  granularity: CogsGranularity
): CogsPeriodRow[] {
  // Build a map of batch_id -> created_at for period assignment
  const batchDateMap = new Map<string, string>();
  for (const b of batches) {
    if (b.created_at) {
      batchDateMap.set(b.id, b.created_at);
    }
  }

  // Build period rows (keyed by display label, with _sortKey for ordering)
  const periodMap = new Map<
    string,
    {
      _sortKey: string;
      total_cogs: number;
      malt_cost: number;
      hop_cost: number;
      yeast_cost: number;
      adjunct_cost: number;
      other_cost: number;
      batchSet: Set<string>;
    }
  >();

  for (const alloc of allocations) {
    if (!alloc.destination_id) continue;
    const batchDate = batchDateMap.get(alloc.destination_id);
    if (!batchDate) continue;

    const date = parseISO(batchDate);
    let periodKey: string;
    let sortKey: string;
    if (granularity === "quarterly") {
      const qStart = startOfQuarter(date);
      periodKey = `Q${Math.ceil((qStart.getMonth() + 1) / 3)} ${format(qStart, "yyyy")}`;
      sortKey = format(qStart, "yyyy-MM");
    } else {
      periodKey = format(date, "MMM yyyy");
      sortKey = format(startOfMonth(date), "yyyy-MM");
    }

    const lineCost = alloc.quantity * (alloc.unit_cost ?? 0);

    // Determine category from inventory lot lookup
    const category = alloc.source_id
      ? (categoryByLotId.get(alloc.source_id) ?? "")
      : "";

    const existing = periodMap.get(periodKey) ?? {
      _sortKey: sortKey,
      total_cogs: 0,
      malt_cost: 0,
      hop_cost: 0,
      yeast_cost: 0,
      adjunct_cost: 0,
      other_cost: 0,
      batchSet: new Set<string>(),
    };

    existing.total_cogs += lineCost;
    existing.batchSet.add(alloc.destination_id);

    if (category === "grain" || category === "malt") {
      existing.malt_cost += lineCost;
    } else if (category === "hops" || category === "hop") {
      existing.hop_cost += lineCost;
    } else if (category === "yeast") {
      existing.yeast_cost += lineCost;
    } else if (category === "adjunct") {
      existing.adjunct_cost += lineCost;
    } else {
      existing.other_cost += lineCost;
    }

    periodMap.set(periodKey, existing);
  }

  // Convert to array and sort chronologically
  return Array.from(periodMap.entries())
    .map(([period, data]) => ({
      period,
      _sortKey: data._sortKey,
      total_cogs: data.total_cogs,
      malt_cost: data.malt_cost,
      hop_cost: data.hop_cost,
      yeast_cost: data.yeast_cost,
      adjunct_cost: data.adjunct_cost,
      other_cost: data.other_cost,
      batch_count: data.batchSet.size,
    }))
    .sort((a, b) => a._sortKey.localeCompare(b._sortKey));
}
