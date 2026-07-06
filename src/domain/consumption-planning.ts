/**
 * Consumption Planning Utilities
 *
 * Pure functions backing the "close the inventory loop" flows (audit Batch 9):
 * - FIFO lot suggestion: split a required ingredient/material quantity across
 *   available inventory lots, oldest expiry first (mirrors the pick-list FIFO
 *   in migration 00057, which orders by production_date).
 * - Recipe scaling: batch volume vs recipe batch size.
 * - Ingredient unit conversion: recipe quantities (lbs/oz) vs inventory item
 *   units (lb/oz/kg/g) — implemented in src/domain/units.ts, re-exported here.
 * - Packaging BOM consumption: BOM lines x actual packaged quantity.
 * - Implied loss math for vessel transfers and packaging completion.
 *
 * No database access — everything here is unit-testable. Database reads and
 * allocation inserts live in src/services/consumption-service.ts.
 */

import { isWholeUnit, ratioFromDecimal } from "@/domain/inventory-units";

// =============================================================================
// Types
// =============================================================================

/** An available inventory lot candidate for FIFO allocation. */
export type FifoLot = {
  /** inventory_lots.id */
  lot_id: string;
  lot_number: string | null;
  /** Remaining (unallocated) quantity in the lot's unit. */
  remaining_quantity: number;
  /** ISO date or null — lots with sooner expiry are consumed first. */
  expiration_date: string | null;
  /** ISO date or null — tiebreaker, oldest received first. */
  received_date: string | null;
  unit_cost?: number | null;
};

/** One suggested draw against a specific lot. */
export type FifoPick = {
  lot_id: string;
  lot_number: string | null;
  quantity: number;
  unit_cost: number | null;
};

/** Result of FIFO splitting: per-lot picks plus any unfillable remainder. */
export type FifoSuggestion = {
  picks: FifoPick[];
  /** Quantity that could not be covered by available lots (0 when fully covered). */
  shortfall: number;
};

/** A BOM line joined with its inventory item unit (for whole-unit rounding). */
export type BomLine = {
  selling_format_id: string;
  inventory_item_id: string;
  quantity_per_unit: number;
  /** inventory_items.unit — drives whole-unit ceiling (each/case). */
  unit: string | null;
};

/** A packaging session line item with its actual packaged quantity. */
export type ConsumptionLineItem = {
  selling_format_id: string | null;
  actual_quantity: number | null;
};

// =============================================================================
// FIFO lot suggestion
// =============================================================================

/** Comparator: soonest expiry first (nulls last), then oldest received first. */
export function compareFifoLots(a: FifoLot, b: FifoLot): number {
  if (a.expiration_date !== b.expiration_date) {
    if (a.expiration_date === null) return 1;
    if (b.expiration_date === null) return -1;
    return a.expiration_date < b.expiration_date ? -1 : 1;
  }
  if (a.received_date !== b.received_date) {
    if (a.received_date === null) return 1;
    if (b.received_date === null) return -1;
    return a.received_date < b.received_date ? -1 : 1;
  }
  return 0;
}

/**
 * Split `requiredQuantity` across `lots` using FIFO ordering
 * (soonest expiration first, then oldest received date).
 *
 * Lots with zero/negative remaining quantity are skipped. Returns the
 * per-lot picks and any shortfall that available lots could not cover.
 */
export function suggestFifoAllocations(
  requiredQuantity: number,
  lots: FifoLot[]
): FifoSuggestion {
  if (!Number.isFinite(requiredQuantity) || requiredQuantity <= 0) {
    return { picks: [], shortfall: 0 };
  }

  const sorted = [...lots].sort(compareFifoLots);
  const picks: FifoPick[] = [];
  let remaining = requiredQuantity;

  for (const lot of sorted) {
    if (remaining <= 0) break;
    if (!Number.isFinite(lot.remaining_quantity) || lot.remaining_quantity <= 0) {
      continue;
    }
    const draw = Math.min(remaining, lot.remaining_quantity);
    picks.push({
      lot_id: lot.lot_id,
      lot_number: lot.lot_number,
      quantity: draw,
      unit_cost: lot.unit_cost ?? null,
    });
    remaining -= draw;
  }

  // Clamp tiny float residue to zero
  const shortfall = remaining > 1e-9 ? remaining : 0;
  return { picks, shortfall };
}

// =============================================================================
// Recipe scaling and unit conversion
// =============================================================================

/**
 * Scale factor for recipe quantities: batch volume / recipe batch size.
 * Returns 1 when either value is missing or non-positive (use 1:1).
 */
export function recipeScaleFactor(
  batchVolumeBbl: number | null | undefined,
  recipeBatchSizeBbl: number | null | undefined
): number {
  if (
    batchVolumeBbl == null ||
    recipeBatchSizeBbl == null ||
    !Number.isFinite(batchVolumeBbl) ||
    !Number.isFinite(recipeBatchSizeBbl) ||
    batchVolumeBbl <= 0 ||
    recipeBatchSizeBbl <= 0
  ) {
    return 1;
  }
  return batchVolumeBbl / recipeBatchSizeBbl;
}

/**
 * Alias-tolerant ingredient weight conversion lives with the rest of the
 * unit tables in src/domain/units.ts; re-exported here so consumption
 * callers (and tests) keep a single import site for planning math.
 */
export { convertIngredientQuantity } from "@/domain/units";

// =============================================================================
// Packaging BOM consumption
// =============================================================================

/**
 * Aggregate material consumption for a packaging session:
 * BOM lines x actual packaged quantity, summed per inventory item.
 *
 * Mirrors the planned-quantity math in useSessionMaterialPreview
 * (src/hooks/use-material-planning.ts): whole-unit materials (each/case)
 * use exact integer ratios recovered from the 4-decimal stored value when
 * possible, and are ceiled at the end — you cannot consume half a tray.
 *
 * Line items without a format or actual quantity are skipped (they did not
 * produce finished goods and consumed nothing attributable).
 */
export function computeBomConsumption(
  lineItems: ConsumptionLineItem[],
  bomLines: BomLine[]
): Map<string, number> {
  type Enriched = BomLine & {
    _whole: boolean;
    _ratio: { numerator: number; denominator: number } | null;
  };
  const bomByFormat = new Map<string, Enriched[]>();
  for (const line of bomLines) {
    const _whole = isWholeUnit(line.unit);
    const enriched: Enriched = {
      ...line,
      _whole,
      _ratio: _whole ? ratioFromDecimal(line.quantity_per_unit) : null,
    };
    const existing = bomByFormat.get(line.selling_format_id);
    if (existing) existing.push(enriched);
    else bomByFormat.set(line.selling_format_id, [enriched]);
  }

  const totals = new Map<string, { total: number; whole: boolean }>();
  for (const li of lineItems) {
    if (!li.selling_format_id || li.actual_quantity == null || li.actual_quantity <= 0) {
      continue;
    }
    for (const bom of bomByFormat.get(li.selling_format_id) ?? []) {
      const required = bom._ratio
        ? (li.actual_quantity * bom._ratio.numerator) / bom._ratio.denominator
        : bom.quantity_per_unit * li.actual_quantity;
      const entry = totals.get(bom.inventory_item_id);
      if (entry) entry.total += required;
      else totals.set(bom.inventory_item_id, { total: required, whole: bom._whole });
    }
  }

  const result = new Map<string, number>();
  for (const [itemId, { total, whole }] of totals) {
    const final = whole ? Math.ceil(total - 1e-9) : total;
    if (final > 0) result.set(itemId, final);
  }
  return result;
}

// =============================================================================
// Implied loss
// =============================================================================

/** Volumes below this (in bbl) are treated as zero — float noise, not loss. */
export const LOSS_EPSILON_BBL = 0.005;

/**
 * Implied loss at vessel transfer: volume left behind in the source vessel.
 * Returns 0 when nothing is implied (negative/epsilon-sized differences).
 */
export function computeTransferLoss(
  remainingVolumeBbl: number | null | undefined,
  transferredVolumeBbl: number
): number {
  if (remainingVolumeBbl == null || !Number.isFinite(remainingVolumeBbl)) return 0;
  const loss = remainingVolumeBbl - transferredVolumeBbl;
  return loss > LOSS_EPSILON_BBL ? loss : 0;
}

/** Fluid ounces per barrel: 31 US gallons x 128 oz. */
const OZ_PER_BARREL = 31 * 128;

/** Container volume fields needed for fill-volume math. */
export type FillVolumeContainer = {
  volume_bbl: number | null;
  volume_oz?: number | null;
} | null;

/**
 * Per-selling-unit fill volume in BBL: container volume x unit_count.
 * Prefers containers.volume_bbl but falls back to volume_oz / 3968 —
 * volume_bbl is only required for kegs (00199 constraint), so can/bottle
 * containers routinely carry only volume_oz. Returns null when neither
 * volume is usable. Authoritative source — never the packaging_formats
 * view's volume_bbl (its checked-in definition is stale).
 */
export function computeUnitFillVolumeBbl(row: {
  unit_count: number | null;
  container: FillVolumeContainer;
}): number | null {
  const bbl = row.container?.volume_bbl;
  const oz = row.container?.volume_oz;
  const containerBbl = bbl != null && bbl > 0 ? bbl : oz != null && oz > 0 ? oz / OZ_PER_BARREL : null;
  if (containerBbl == null) return null;
  return containerBbl * (row.unit_count ?? 1);
}

/**
 * Actual total loss reconciliation at batch completion, anchored to
 * packaged-vs-produced-wort (packaging is the source of truth for loss):
 *
 *   unattributed = (produced wort + blend in − blend out)
 *                  − packaged − already-attributed removals
 *
 * Returns the SIGNED remainder — negative means packaged/attributed volume
 * exceeds the production baseline (data-entry problem or post-knockout
 * additions like fruit/dilution); callers decide whether to record, using
 * reconciliationThresholdBbl. Returns null when there is no production
 * baseline at all (no brew logs and no blend inflow) — nothing to reconcile.
 *
 * NOTE: the wort (knockout) anchor is a deliberate product choice — total
 * brewhouse-to-package accountability — so fermentation shrinkage lands in
 * this number. See docs/knowledge/brewing-domain.md before changing anchors.
 */
export function computeBatchLossReconciliation(params: {
  /** Knockout volume: SUM(brew_log_batches.volume_bbl) for the batch. */
  producedBbl: number | null | undefined;
  /** Volume blended INTO this batch (batch_blends.blend_batch_id = batch). */
  blendInBbl: number;
  /** Volume blended OUT to other batches (batch_blends.source_batch_id = batch). */
  blendOutBbl: number;
  /** SUM(actual units x unit fill volume) across the batch's session line items. */
  packagedBbl: number;
  /** SUM of completed batch-sourced removal allocations (loss, samples, taproom, …). */
  attributedBbl: number;
}): number | null {
  const { producedBbl, blendInBbl, blendOutBbl, packagedBbl, attributedBbl } = params;
  const produced = producedBbl != null && Number.isFinite(producedBbl) ? producedBbl : 0;
  const baseline = produced + blendInBbl - blendOutBbl;
  if (baseline <= 0) return null;
  return baseline - packagedBbl - attributedBbl;
}

/**
 * Minimum remainder worth auto-recording as a reconciliation loss:
 * max(0.05 bbl, 0.5% of the production baseline). Coarser than
 * LOSS_EPSILON_BBL because brew_log_batches.volume_bbl is DECIMAL(8,2) —
 * per-link quantization alone can accumulate past the epsilon.
 */
export function reconciliationThresholdBbl(baselineBbl: number): number {
  return Math.max(0.05, 0.005 * baselineBbl);
}

/** A packaging line item with the data needed for loss volume math. */
export type PackagingLossLine = {
  batch_id: string | null;
  planned_quantity: number | null;
  actual_quantity: number | null;
  /** Volume of one selling unit in bbl (container volume x unit count). */
  unit_volume_bbl: number | null;
};

/**
 * Implied loss per batch at packaging completion:
 * (planned units - actual units) x unit fill volume, summed per batch.
 *
 * Lines with missing volume data, missing actuals, or non-positive
 * differences are skipped. Returns an empty map when there is no loss.
 */
export function computePackagingLoss(
  lines: PackagingLossLine[]
): Map<string, number> {
  const perBatch = new Map<string, number>();
  for (const line of lines) {
    if (
      !line.batch_id ||
      line.planned_quantity == null ||
      line.actual_quantity == null ||
      line.unit_volume_bbl == null ||
      line.unit_volume_bbl <= 0
    ) {
      continue;
    }
    const lossUnits = line.planned_quantity - line.actual_quantity;
    if (lossUnits <= 0) continue;
    const lossBbl = lossUnits * line.unit_volume_bbl;
    perBatch.set(line.batch_id, (perBatch.get(line.batch_id) ?? 0) + lossBbl);
  }
  // Drop epsilon-sized totals
  for (const [batchId, loss] of perBatch) {
    if (loss <= LOSS_EPSILON_BBL) perBatch.delete(batchId);
  }
  return perBatch;
}
