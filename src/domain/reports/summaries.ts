/**
 * Pure summary/aggregation calculations for the report pages under
 * src/app/(app)/reports/ (cogs, batch-cost, production-summary,
 * inventory-valuation, projections).
 *
 * These were extracted verbatim from the page-level useMemo bodies so they
 * can be unit-tested (see src/domain/__tests__/report-summaries.test.ts).
 * The pages own querying and rendering; this module owns the math.
 */

import type { CogsSkuRow, CogsPeriodRow } from "@/domain/reports/cogs";

// =============================================================================
// COGS report summaries
// =============================================================================

/** Minimal batch-row shape needed by {@link computeCogsBatchSummary}. */
export type CogsBatchSummaryInput = {
  volume_bbl: number | null;
  total_ingredient_cost: number;
  units_packaged: number;
};

/** COGS "By Batch" tab summary-card metrics. */
export function computeCogsBatchSummary(
  batchCostData: CogsBatchSummaryInput[] | undefined
): {
  avgCostPerBbl: number;
  totalMaterialCost: number;
  batchCount: number;
  totalUnitsPackaged: number;
} {
  if (!batchCostData || batchCostData.length === 0) {
    return {
      avgCostPerBbl: 0,
      totalMaterialCost: 0,
      batchCount: 0,
      totalUnitsPackaged: 0,
    };
  }

  const totalMaterialCost = batchCostData.reduce(
    (sum, b) => sum + b.total_ingredient_cost,
    0
  );
  const batchesWithVolume = batchCostData.filter(
    (b) => b.volume_bbl && b.volume_bbl > 0
  );
  const totalVolume = batchesWithVolume.reduce(
    (sum, b) => sum + (b.volume_bbl ?? 0),
    0
  );
  const totalUnitsPackaged = batchCostData.reduce(
    (sum, b) => sum + b.units_packaged,
    0
  );

  return {
    avgCostPerBbl: totalVolume > 0 ? totalMaterialCost / totalVolume : 0,
    totalMaterialCost,
    batchCount: batchCostData.length,
    totalUnitsPackaged,
  };
}

/** COGS "By SKU" tab summary-card metrics. */
export function computeCogsSkuSummary(skuData: CogsSkuRow[] | undefined): {
  highestCostSku: CogsSkuRow | null;
  lowestCostSku: CogsSkuRow | null;
  weightedAvgCostPerUnit: number;
} {
  if (!skuData || skuData.length === 0) {
    return {
      highestCostSku: null,
      lowestCostSku: null,
      weightedAvgCostPerUnit: 0,
    };
  }

  const withUnits = skuData.filter((s) => s.total_units > 0);
  const sorted = [...withUnits].sort(
    (a, b) => (b.avg_cost_per_unit ?? 0) - (a.avg_cost_per_unit ?? 0)
  );

  const totalCost = withUnits.reduce((sum, s) => sum + s.total_cost, 0);
  const totalUnits = withUnits.reduce((sum, s) => sum + s.total_units, 0);

  return {
    highestCostSku: sorted[0] ?? null,
    lowestCostSku: sorted[sorted.length - 1] ?? null,
    weightedAvgCostPerUnit: totalUnits > 0 ? totalCost / totalUnits : 0,
  };
}

/** COGS "By Period" tab summary metrics including category totals. */
export function computeCogsPeriodSummary(
  periodData: CogsPeriodRow[] | undefined
): {
  totalCogs: number;
  periodChange: number | null;
  avgCogsPerBatch: number;
  totalMalt: number;
  totalHop: number;
  totalYeast: number;
  totalAdjunct: number;
  totalOther: number;
  totalBatches: number;
} {
  if (!periodData || periodData.length === 0) {
    return {
      totalCogs: 0,
      periodChange: null,
      avgCogsPerBatch: 0,
      totalMalt: 0,
      totalHop: 0,
      totalYeast: 0,
      totalAdjunct: 0,
      totalOther: 0,
      totalBatches: 0,
    };
  }

  // Single-pass aggregation across all period rows
  let totalCogs = 0;
  let totalBatches = 0;
  let totalMalt = 0;
  let totalHop = 0;
  let totalYeast = 0;
  let totalAdjunct = 0;
  let totalOther = 0;
  for (const p of periodData) {
    totalCogs += p.total_cogs;
    totalBatches += p.batch_count;
    totalMalt += p.malt_cost;
    totalHop += p.hop_cost;
    totalYeast += p.yeast_cost;
    totalAdjunct += p.adjunct_cost;
    totalOther += p.other_cost;
  }

  // Period-over-period change (compare last 2 periods)
  let periodChange: number | null = null;
  if (periodData.length >= 2) {
    const last = periodData[periodData.length - 1].total_cogs;
    const prev = periodData[periodData.length - 2].total_cogs;
    if (prev > 0) {
      periodChange = ((last - prev) / prev) * 100;
    }
  }

  return {
    totalCogs,
    periodChange,
    avgCogsPerBatch: totalBatches > 0 ? totalCogs / totalBatches : 0,
    totalMalt,
    totalHop,
    totalYeast,
    totalAdjunct,
    totalOther,
    totalBatches,
  };
}

// =============================================================================
// Batch cost analysis report summary
// =============================================================================

/** Minimal batch-row shape needed by {@link computeBatchCostSummary}. */
export type BatchCostSummaryInput = {
  volume_bbl: number | null;
  ingredient_cost: number;
};

/** Batch Cost Analysis summary-card metrics. */
export function computeBatchCostSummary(
  batchCostData: BatchCostSummaryInput[] | undefined
): {
  avgCostPerBatch: number;
  avgCostPerBbl: number;
  totalProductionCost: number;
  batchCount: number;
} {
  if (!batchCostData || batchCostData.length === 0) {
    return {
      avgCostPerBatch: 0,
      avgCostPerBbl: 0,
      totalProductionCost: 0,
      batchCount: 0,
    };
  }

  const totalProductionCost = batchCostData.reduce(
    (sum, b) => sum + b.ingredient_cost,
    0
  );

  const avgCostPerBatch = totalProductionCost / batchCostData.length;

  const batchesWithVolume = batchCostData.filter(
    (b) => b.volume_bbl && b.volume_bbl > 0
  );
  const totalVolume = batchesWithVolume.reduce(
    (sum, b) => sum + (b.volume_bbl ?? 0),
    0
  );
  const avgCostPerBbl = totalVolume > 0 ? totalProductionCost / totalVolume : 0;

  return {
    avgCostPerBatch,
    avgCostPerBbl,
    totalProductionCost,
    batchCount: batchCostData.length,
  };
}

// =============================================================================
// Production summary report aggregation
// =============================================================================

/** Aggregated production row (by brand or by style). */
export type ProductionAggregate = {
  key: string;
  label: string;
  batchCount: number;
  totalBbl: number;
  avgBblPerBatch: number;
};

/**
 * Aggregate batches into production summaries by a key extractor.
 * Returns rows sorted descending by totalBbl.
 */
export function aggregateProduction<T extends { volume_bbl: number | null }>(
  batches: T[],
  getKey: (b: T) => string,
  getLabel: (b: T) => string
): ProductionAggregate[] {
  const map = new Map<
    string,
    { label: string; batchCount: number; totalBbl: number }
  >();

  for (const b of batches) {
    const key = getKey(b);
    const existing =
      map.get(key) ?? { label: getLabel(b), batchCount: 0, totalBbl: 0 };
    existing.batchCount += 1;
    existing.totalBbl += b.volume_bbl ?? 0;
    map.set(key, existing);
  }

  return Array.from(map.entries())
    .map(([key, v]) => ({
      key,
      label: v.label,
      batchCount: v.batchCount,
      totalBbl: v.totalBbl,
      avgBblPerBatch: v.batchCount > 0 ? v.totalBbl / v.batchCount : 0,
    }))
    .sort((a, b) => b.totalBbl - a.totalBbl);
}

/**
 * Average number of days the given batches have been in tank, measured from
 * planned_start_date to `now`. Batches without a start date, or with a start
 * date in the future, are excluded. Returns null when nothing qualifies.
 */
export function computeAvgDaysInTank(
  batches: { planned_start_date: string | null }[] | undefined,
  daysSince: (plannedStart: string) => number
): number | null {
  if (!batches || batches.length === 0) return null;
  const days = batches
    .map((b) => (b.planned_start_date ? daysSince(b.planned_start_date) : null))
    .filter((d): d is number => d !== null && d >= 0);
  if (days.length === 0) return null;
  return days.reduce((sum, d) => sum + d, 0) / days.length;
}

// =============================================================================
// Inventory valuation report aggregation
// =============================================================================

/** Raw material lot row (from inventory_lots_with_quantities + items join). */
export type RawMaterialLotInput = {
  inventory_item_id: string | null;
  remaining_quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  inventory_items: { name: string; category: string } | null;
};

/** Aggregated raw material row for display. */
export type RawMaterialRow = {
  itemName: string;
  category: string;
  totalQuantity: number;
  unit: string;
  avgUnitCost: number;
  totalValue: number;
};

/**
 * Aggregate raw material lots by inventory item: total remaining quantity,
 * weighted average unit cost, and total value. Sorted by category then name.
 */
export function aggregateRawMaterials(
  rawMaterialLots: RawMaterialLotInput[] | undefined
): RawMaterialRow[] {
  if (!rawMaterialLots) return [];

  const grouped = new Map<
    string,
    {
      itemName: string;
      category: string;
      totalQuantity: number;
      unit: string;
      totalCost: number;
      lotCount: number;
    }
  >();

  for (const lot of rawMaterialLots) {
    const itemId = lot.inventory_item_id ?? "unknown";
    const remaining = lot.remaining_quantity ?? 0;
    const cost = lot.unit_cost ?? 0;
    const existing = grouped.get(itemId);

    if (existing) {
      existing.totalQuantity += remaining;
      existing.totalCost += remaining * cost;
      existing.lotCount += 1;
    } else {
      grouped.set(itemId, {
        itemName: lot.inventory_items?.name ?? "Unknown Item",
        category: lot.inventory_items?.category ?? "other",
        totalQuantity: remaining,
        unit: lot.unit ?? "",
        totalCost: remaining * cost,
        lotCount: 1,
      });
    }
  }

  return Array.from(grouped.values())
    .map((item) => ({
      itemName: item.itemName,
      category: item.category,
      totalQuantity: item.totalQuantity,
      unit: item.unit,
      avgUnitCost:
        item.totalQuantity > 0 ? item.totalCost / item.totalQuantity : 0,
      totalValue: item.totalCost,
    }))
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        a.itemName.localeCompare(b.itemName)
    );
}

/** Finished good row (from finished_goods_with_availability). */
export type FinishedGoodValuationInput = {
  batch_id: string | null;
  brand_name: string | null;
  selling_format_name: string | null;
  available_quantity: number | null;
};

/** Aggregated finished good row for display. */
export type FinishedGoodDisplayRow = {
  brandName: string;
  packageType: string;
  quantity: number;
  /** Estimated unit cost derived from batch ingredient costs */
  unitCostEstimate: number;
  totalValue: number;
};

/** Per-batch ingredient cost + packaged-unit totals used for FG valuation. */
export type BatchCostInfo = { totalCost: number; totalUnits: number };

/**
 * Aggregate finished goods by brand + package type, valuing each unit at the
 * batch's ingredient cost divided by total units packaged from that batch.
 * Sorted by brand then package type.
 */
export function aggregateFinishedGoodsValuation(
  finishedGoods: FinishedGoodValuationInput[] | undefined,
  batchCosts: Map<string, BatchCostInfo> | undefined
): FinishedGoodDisplayRow[] {
  if (!finishedGoods) return [];

  const grouped = new Map<
    string,
    {
      brandName: string;
      packageType: string;
      quantity: number;
      totalValue: number;
    }
  >();

  for (const fg of finishedGoods) {
    const key = `${fg.brand_name ?? "Unknown"}::${fg.selling_format_name ?? "Unknown"}`;
    const available = fg.available_quantity ?? 0;

    // Calculate per-unit cost from batch ingredient costs
    let unitCost = 0;
    if (fg.batch_id && batchCosts) {
      const batchInfo = batchCosts.get(fg.batch_id);
      if (batchInfo && batchInfo.totalUnits > 0) {
        unitCost = batchInfo.totalCost / batchInfo.totalUnits;
      }
    }

    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += available;
      existing.totalValue += available * unitCost;
    } else {
      grouped.set(key, {
        brandName: fg.brand_name ?? "Unknown",
        packageType: fg.selling_format_name ?? "Unknown",
        quantity: available,
        totalValue: available * unitCost,
      });
    }
  }

  // Unit cost is derived from batch ingredient costs allocated proportionally
  // across all finished goods produced from that batch.
  return Array.from(grouped.values())
    .map((item) => ({
      brandName: item.brandName,
      packageType: item.packageType,
      quantity: item.quantity,
      unitCostEstimate:
        item.quantity > 0 ? item.totalValue / item.quantity : 0,
      totalValue: item.totalValue,
    }))
    .sort(
      (a, b) =>
        a.brandName.localeCompare(b.brandName) ||
        a.packageType.localeCompare(b.packageType)
    );
}

/**
 * Combine allocation lines and finished-good unit counts into a per-batch
 * cost/units map (input to {@link aggregateFinishedGoodsValuation}).
 */
export function buildBatchCostMap(
  batchIds: string[],
  allocations: {
    destination_id: string | null;
    quantity: number | null;
    unit_cost: number | null;
  }[],
  fgRows: { batch_id: string | null; quantity: number | null }[]
): Map<string, BatchCostInfo> {
  // Sum costs per batch
  const costMap = new Map<string, number>();
  for (const a of allocations) {
    if (!a.destination_id) continue;
    const lineCost = (a.quantity ?? 0) * (a.unit_cost ?? 0);
    costMap.set(
      a.destination_id,
      (costMap.get(a.destination_id) ?? 0) + lineCost
    );
  }

  // Sum total FG units per batch
  const unitsMap = new Map<string, number>();
  for (const fg of fgRows) {
    if (!fg.batch_id) continue;
    unitsMap.set(
      fg.batch_id,
      (unitsMap.get(fg.batch_id) ?? 0) + (fg.quantity ?? 0)
    );
  }

  // Combine into cost-per-unit map
  const result = new Map<string, BatchCostInfo>();
  for (const batchId of batchIds) {
    result.set(batchId, {
      totalCost: costMap.get(batchId) ?? 0,
      totalUnits: unitsMap.get(batchId) ?? 0,
    });
  }
  return result;
}

// =============================================================================
// Ingredient projections report grouping
// =============================================================================

/** One ingredient's contribution from a single source (batch or order). */
export type ProjectionIngredientSource = {
  type: "batch" | "order";
  id: string;
  label: string;
  qty: number;
};

/** Projection ingredient shape consumed by {@link groupIngredientsBySource}. */
export type ProjectionIngredientInput = {
  name: string;
  category: string;
  unit: string;
  sources: ProjectionIngredientSource[];
};

/** Ingredient row from the grouping helper. */
export type GroupedIngredientRow = {
  name: string;
  category: string;
  qty: number;
  unit: string;
};

/**
 * Group projection ingredients by a source type ("batch" or "order").
 * Returns entries pairing each entity with its ingredient rows, filtered
 * to only entities that have at least one ingredient source.
 */
export function groupIngredientsBySource<T extends { id: string }>(
  ingredients: ProjectionIngredientInput[] | undefined,
  sourceType: "batch" | "order",
  entities: T[]
): { entity: T; ingredients: GroupedIngredientRow[] }[] {
  if (!ingredients) return [];
  const map = new Map<
    string,
    { entity: T; ingredients: GroupedIngredientRow[] }
  >();
  for (const entity of entities) {
    map.set(entity.id, { entity, ingredients: [] });
  }
  for (const ing of ingredients) {
    for (const src of ing.sources) {
      if (src.type === sourceType && map.has(src.id)) {
        map.get(src.id)!.ingredients.push({
          name: ing.name,
          category: ing.category,
          qty: src.qty,
          unit: ing.unit,
        });
      }
    }
  }
  return Array.from(map.values()).filter(
    (entry) => entry.ingredients.length > 0
  );
}
