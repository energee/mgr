/**
 * Consumption Domain Service
 *
 * Database orchestration for the "close the inventory loop" flows
 * (audit Batch 9). Pure math lives in src/domain/consumption-planning.ts;
 * this module owns the Supabase reads/writes:
 *
 * - Brew-day ingredient consumption (9.1): build a FIFO-suggested allocation
 *   plan from a recipe's grain bill / hop schedule / other ingredients, insert
 *   `planned` allocations (inventory_lot → batch), and complete them when the
 *   batch completes.
 * - Packaging material depletion (9.2): on session completion, insert
 *   `completed` allocations for BOM lines × actual quantity (FIFO across lots).
 * - Loss capture (9.3) and quick depletions (9.4): thin allocation inserts
 *   with the right destination_type.
 *
 * Allocation modeling decisions:
 * - Ingredient/material consumption: source_type='inventory_lot',
 *   destination_type='batch' (matches the legacy batch_usage migration in
 *   00010 and feeds the batch-cost report, which sums completed allocations
 *   with destination_type='batch').
 * - Losses: source_type='batch', destination_type='loss', volume_bbl set —
 *   the same shape archive_batch_with_loss (00069) writes and the TTB report
 *   (00041) reads.
 * - Recipe catalog items (malts/hops/...) have no FK to inventory_items;
 *   matching is best-effort by name (case-insensitive) + category, the same
 *   convention as calculate_material_shortfalls (migration 00163).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { type ServiceResult, ok, err, parseSupabaseError, dynamicFrom } from "./types";
import {
  suggestFifoAllocations,
  recipeScaleFactor,
  convertIngredientQuantity,
  computeBomConsumption,
  type FifoLot,
  type FifoPick,
} from "@/domain/consumption-planning";

type Client = SupabaseClient<Database>;

// =============================================================================
// Types
// =============================================================================

/** Catalog source of a recipe ingredient line. */
export type IngredientCatalogType =
  | "malt"
  | "hop"
  | "adjunct"
  | "sugar"
  | "spice"
  | "fruit";

/** Maps catalog types to inventory_items.category values (mirrors 00163). */
export const CATALOG_TO_INVENTORY_CATEGORY: Record<IngredientCatalogType, string> = {
  malt: "grain",
  hop: "hop",
  adjunct: "adjunct",
  sugar: "sugar",
  spice: "spice",
  fruit: "fruit",
};

/** One ingredient line in a brew-day consumption plan. */
export type BrewConsumptionLine = {
  /** Catalog item name (e.g. "Pilsner Malt"). */
  ingredient_name: string;
  catalog_type: IngredientCatalogType;
  /** Scaled quantity in the recipe's unit. */
  required_quantity: number;
  /** Recipe-side unit (lbs for malts/adjuncts/sugars, oz for hops, free for spices/fruits). */
  recipe_unit: string;
  /** Matched inventory item, or null when no name+category match exists. */
  inventory_item: { id: string; name: string; unit: string } | null;
  /**
   * Required quantity converted to the inventory item's unit.
   * Falls back to required_quantity 1:1 when units are not convertible
   * (unit_mismatch is then true).
   */
  converted_quantity: number;
  unit_mismatch: boolean;
  /** FIFO-suggested per-lot draws (editable in the confirmation dialog). */
  picks: FifoPick[];
  /** Quantity (in inventory unit) not covered by available lots. */
  shortfall: number;
};

/** A confirmed pick ready to insert as a planned allocation. */
export type ConfirmedConsumptionPick = {
  lot_id: string;
  quantity: number;
  unit_cost: number | null;
  lot_number: string | null;
  ingredient_name: string;
};

/** Result summary of packaging material depletion. */
export type PackagingDepletionResult = {
  allocations_inserted: number;
  /** Items that could not be fully covered by available lots. */
  shortfalls: Array<{ inventory_item_id: string; quantity: number }>;
};

/**
 * The session_line_items columns consumePackagingMaterials needs. Callers
 * that already fetched the session's line items (e.g. the packaging
 * completion review's loss check) can pass them through to avoid a
 * duplicate fetch — their select just has to include this column union.
 */
export type PackagingDepletionLineItem = {
  selling_format_id: string | null;
  actual_quantity: number | null;
  batch_id: string | null;
};

// =============================================================================
// Internal helpers
// =============================================================================

/** Fetch available lots (remaining > 0) for a set of inventory items, FIFO-ready. */
async function fetchAvailableLots(
  supabase: Client,
  inventoryItemIds: string[]
): Promise<Map<string, FifoLot[]>> {
  const byItem = new Map<string, FifoLot[]>();
  if (inventoryItemIds.length === 0) return byItem;

  const { data, error } = await supabase
    .from("inventory_lots_with_quantities")
    .select(
      "id, inventory_item_id, lot_number, remaining_quantity, expiration_date, received_date, unit_cost"
    )
    .in("inventory_item_id", inventoryItemIds)
    .gt("remaining_quantity", 0);
  if (error) throw error;

  for (const row of data ?? []) {
    if (!row.id || !row.inventory_item_id) continue;
    const lot: FifoLot = {
      lot_id: row.id,
      lot_number: row.lot_number,
      remaining_quantity: row.remaining_quantity ?? 0,
      expiration_date: row.expiration_date,
      received_date: row.received_date,
      unit_cost: row.unit_cost,
    };
    const list = byItem.get(row.inventory_item_id);
    if (list) list.push(lot);
    else byItem.set(row.inventory_item_id, [lot]);
  }
  return byItem;
}

type AllocationInsert = Database["public"]["Tables"]["allocations"]["Insert"];

// =============================================================================
// 9.1 Brew-day ingredient consumption
// =============================================================================

/**
 * Build a brew-day consumption plan for a batch's recipe:
 * grain bill + hop schedule + other ingredients (adjuncts, sugars, spices,
 * fruits), scaled by batch volume / recipe batch size, matched to inventory
 * items by name + category, with FIFO lot suggestions.
 *
 * Yeast is intentionally excluded — pitches are tracked via yeast_pitches.
 */
export async function buildBrewConsumptionPlan(
  supabase: Client,
  recipeId: string,
  batchVolumeBbl: number | null
): Promise<ServiceResult<BrewConsumptionLine[]>> {
  try {
    const [recipeRes, maltsRes, hopsRes, adjunctsRes, sugarsRes, spicesRes, fruitsRes] =
      await Promise.all([
        supabase.from("recipes").select("batch_size_bbl").eq("id", recipeId).single(),
        supabase.from("recipe_malts").select("weight_lbs, malt:malts(name)").eq("recipe_id", recipeId),
        supabase.from("recipe_hops").select("weight_oz, hop:hops(name)").eq("recipe_id", recipeId),
        supabase.from("recipe_adjuncts").select("weight_lbs, adjunct:adjuncts(name)").eq("recipe_id", recipeId),
        supabase.from("recipe_sugars").select("weight_lbs, sugar:sugars(name)").eq("recipe_id", recipeId),
        supabase.from("recipe_spices").select("amount, unit, spice:spices(name)").eq("recipe_id", recipeId),
        supabase.from("recipe_fruits").select("amount, unit, fruit:fruits(name)").eq("recipe_id", recipeId),
      ]);

    for (const res of [recipeRes, maltsRes, hopsRes, adjunctsRes, sugarsRes, spicesRes, fruitsRes]) {
      if (res.error) return err(parseSupabaseError(res.error));
    }

    const scale = recipeScaleFactor(batchVolumeBbl, recipeRes.data?.batch_size_bbl);

    // Aggregate recipe lines into (name, catalog_type, qty, unit) requirements.
    // The same ingredient can appear multiple times (e.g. hop schedule).
    type Requirement = { name: string; catalogType: IngredientCatalogType; quantity: number; unit: string };
    const requirements = new Map<string, Requirement>();
    const add = (name: string | undefined | null, catalogType: IngredientCatalogType, qty: number | null, unit: string) => {
      if (!name || qty == null || qty <= 0) return;
      const key = `${catalogType}:${name.toLowerCase()}:${unit.toLowerCase()}`;
      const existing = requirements.get(key);
      if (existing) existing.quantity += qty * scale;
      else requirements.set(key, { name, catalogType, quantity: qty * scale, unit });
    };

    for (const r of maltsRes.data ?? []) add(r.malt?.name, "malt", r.weight_lbs, "lbs");
    for (const r of hopsRes.data ?? []) add(r.hop?.name, "hop", r.weight_oz, "oz");
    for (const r of adjunctsRes.data ?? []) add(r.adjunct?.name, "adjunct", r.weight_lbs, "lbs");
    for (const r of sugarsRes.data ?? []) add(r.sugar?.name, "sugar", r.weight_lbs, "lbs");
    for (const r of spicesRes.data ?? []) add(r.spice?.name, "spice", r.amount, r.unit ?? "oz");
    for (const r of fruitsRes.data ?? []) add(r.fruit?.name, "fruit", r.amount, r.unit ?? "lbs");

    if (requirements.size === 0) return ok([]);

    // Match inventory items by name (case-insensitive) + mapped category.
    const categories = [...new Set([...requirements.values()].map((r) => CATALOG_TO_INVENTORY_CATEGORY[r.catalogType]))];
    const { data: items, error: itemsError } = await supabase
      .from("inventory_items")
      .select("id, name, category, unit")
      .in("category", categories)
      .eq("is_active", true);
    if (itemsError) return err(parseSupabaseError(itemsError));

    const itemByKey = new Map<string, { id: string; name: string; unit: string }>();
    for (const item of items ?? []) {
      itemByKey.set(`${item.category}:${item.name.toLowerCase()}`, {
        id: item.id,
        name: item.name,
        unit: item.unit,
      });
    }

    // FIFO suggestion per requirement, tracking lot depletion across lines
    const matchedItemIds = [...requirements.values()]
      .map((r) => itemByKey.get(`${CATALOG_TO_INVENTORY_CATEGORY[r.catalogType]}:${r.name.toLowerCase()}`)?.id)
      .filter((id): id is string => !!id);
    const lotsByItem = await fetchAvailableLots(supabase, [...new Set(matchedItemIds)]);

    const lines: BrewConsumptionLine[] = [];
    for (const req of requirements.values()) {
      const item = itemByKey.get(`${CATALOG_TO_INVENTORY_CATEGORY[req.catalogType]}:${req.name.toLowerCase()}`) ?? null;

      let converted = req.quantity;
      let unitMismatch = false;
      if (item) {
        const c = convertIngredientQuantity(req.quantity, req.unit, item.unit);
        if (c === null) unitMismatch = true;
        else converted = c;
      }

      let picks: FifoPick[] = [];
      let shortfall = item ? converted : 0;
      if (item) {
        const lots = lotsByItem.get(item.id) ?? [];
        const suggestion = suggestFifoAllocations(converted, lots);
        picks = suggestion.picks;
        shortfall = suggestion.shortfall;
        // Deplete shared lots so later lines for the same item don't double-draw
        for (const pick of suggestion.picks) {
          const lot = lots.find((l) => l.lot_id === pick.lot_id);
          if (lot) lot.remaining_quantity -= pick.quantity;
        }
      }

      lines.push({
        ingredient_name: req.name,
        catalog_type: req.catalogType,
        required_quantity: req.quantity,
        recipe_unit: req.unit,
        inventory_item: item,
        converted_quantity: converted,
        unit_mismatch: unitMismatch,
        picks,
        shortfall,
      });
    }

    return ok(lines);
  } catch (e) {
    return err({
      code: "UNKNOWN",
      message: `Failed to build consumption plan: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
}

/**
 * Insert `planned` allocations (inventory_lot → batch) for confirmed picks.
 * These become `completed` when the batch completes (completeBatchConsumption).
 */
export async function createPlannedConsumption(
  supabase: Client,
  batchId: string,
  picks: ConfirmedConsumptionPick[]
): Promise<ServiceResult<number>> {
  try {
    const rows: AllocationInsert[] = picks
      .filter((p) => p.quantity > 0)
      .map((p) => ({
        source_type: "inventory_lot",
        source_id: p.lot_id,
        destination_type: "batch",
        destination_id: batchId,
        quantity: p.quantity,
        unit_cost: p.unit_cost,
        status: "planned",
        lot_number: p.lot_number,
        notes: `Brew day consumption: ${p.ingredient_name}`,
      }));
    if (rows.length === 0) return ok(0);

    const { error } = await supabase.from("allocations").insert(rows);
    if (error) return err(parseSupabaseError(error, { table: "allocations" }));
    return ok(rows.length);
  } catch (e) {
    return err({
      code: "UNKNOWN",
      message: `Failed to create planned consumption: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
}

/**
 * Complete all planned ingredient-consumption allocations for a batch
 * (inventory_lot → batch). Called when the batch transitions to completed.
 * Returns the number of allocations completed.
 */
export async function completeBatchConsumption(
  supabase: Client,
  batchId: string
): Promise<ServiceResult<number>> {
  try {
    const { data, error } = await supabase
      .from("allocations")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("destination_type", "batch")
      .eq("destination_id", batchId)
      .eq("source_type", "inventory_lot")
      .eq("status", "planned")
      .select("id");
    if (error) return err(parseSupabaseError(error, { table: "allocations" }));
    return ok(data?.length ?? 0);
  } catch (e) {
    return err({
      code: "UNKNOWN",
      message: `Failed to complete batch consumption: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
}

// =============================================================================
// 9.2 Packaging material depletion
// =============================================================================

/**
 * Deplete packaging materials for a completed session:
 * selling_format_materials BOM lines × actual_quantity, drawn FIFO from
 * inventory lots, inserted as completed allocations
 * (inventory_lot → batch of the line item; destination_id null when a line
 * item has no batch). Shortfalls are reported, not blocked on — the session
 * already physically happened.
 *
 * Pass `preloadedLineItems` when the caller already fetched the session's
 * line items (avoids re-fetching the same rows); falls back to fetching.
 */
export async function consumePackagingMaterials(
  supabase: Client,
  sessionId: string,
  preloadedLineItems?: PackagingDepletionLineItem[]
): Promise<ServiceResult<PackagingDepletionResult>> {
  try {
    // Idempotence guard: depletion can be triggered both by the completion
    // dialog and by the transition side-effect registry (bulk bar, generic
    // dropdown). Every insert below tags notes with the session id, so an
    // existing tagged allocation means this session was already depleted.
    const sessionNote = `Packaging session ${sessionId} material consumption`;
    const { data: existing, error: existingError } = await supabase
      .from("allocations")
      .select("id")
      .eq("notes", sessionNote)
      .limit(1);
    if (existingError) return err(parseSupabaseError(existingError, { table: "allocations" }));
    if (existing && existing.length > 0) {
      return ok({ allocations_inserted: 0, shortfalls: [] });
    }

    let lineItems: PackagingDepletionLineItem[] | undefined = preloadedLineItems;
    if (!lineItems) {
      const { data, error: liError } = await supabase
        .from("session_line_items")
        .select("selling_format_id, actual_quantity, batch_id")
        .eq("session_id", sessionId);
      if (liError) return err(parseSupabaseError(liError, { table: "session_line_items" }));
      lineItems = data ?? [];
    }
    if (lineItems.length === 0) {
      return ok({ allocations_inserted: 0, shortfalls: [] });
    }

    const formatIds = [
      ...new Set(lineItems.map((li) => li.selling_format_id).filter((id): id is string => !!id)),
    ];
    if (formatIds.length === 0) return ok({ allocations_inserted: 0, shortfalls: [] });

    // selling_format_materials (00160) is not in the generated types yet — dynamicFrom
    const { data: bomData, error: bomError } = await dynamicFrom(supabase, "selling_format_materials")
      .select("selling_format_id, inventory_item_id, quantity_per_unit, inventory_item:inventory_items(unit)")
      .in("selling_format_id", formatIds);
    if (bomError) return err(parseSupabaseError(bomError, { table: "selling_format_materials" }));
    const bomRows = (bomData ?? []) as unknown as Array<{
      selling_format_id: string;
      inventory_item_id: string;
      quantity_per_unit: number;
      inventory_item: { unit: string | null } | null;
    }>;
    if (bomRows.length === 0) {
      return ok({ allocations_inserted: 0, shortfalls: [] });
    }

    const bomLines = bomRows.map((r) => ({
      selling_format_id: r.selling_format_id,
      inventory_item_id: r.inventory_item_id,
      quantity_per_unit: r.quantity_per_unit,
      unit: r.inventory_item?.unit ?? null,
    }));

    // Group line items per batch so consumption is attributed to the batch
    // it packaged (flows into batch cost). Null batch grouped separately.
    const byBatch = new Map<string | null, Array<{ selling_format_id: string | null; actual_quantity: number | null }>>();
    for (const li of lineItems) {
      const key = li.batch_id ?? null;
      const list = byBatch.get(key);
      const entry = { selling_format_id: li.selling_format_id, actual_quantity: li.actual_quantity };
      if (list) list.push(entry);
      else byBatch.set(key, [entry]);
    }

    const allItemIds = [...new Set(bomLines.map((b) => b.inventory_item_id))];
    const lotsByItem = await fetchAvailableLots(supabase, allItemIds);

    const inserts: AllocationInsert[] = [];
    const shortfallByItem = new Map<string, number>();
    const now = new Date().toISOString();

    for (const [batchId, items] of byBatch) {
      const consumption = computeBomConsumption(items, bomLines);
      for (const [itemId, quantity] of consumption) {
        const lots = lotsByItem.get(itemId) ?? [];
        const { picks, shortfall } = suggestFifoAllocations(quantity, lots);
        for (const pick of picks) {
          const lot = lots.find((l) => l.lot_id === pick.lot_id);
          if (lot) lot.remaining_quantity -= pick.quantity;
          inserts.push({
            source_type: "inventory_lot",
            source_id: pick.lot_id,
            destination_type: "batch",
            destination_id: batchId,
            quantity: pick.quantity,
            unit_cost: pick.unit_cost,
            status: "completed",
            completed_at: now,
            lot_number: pick.lot_number,
            notes: sessionNote,
          });
        }
        if (shortfall > 0) {
          shortfallByItem.set(itemId, (shortfallByItem.get(itemId) ?? 0) + shortfall);
        }
      }
    }

    if (inserts.length > 0) {
      const { error: insertError } = await supabase.from("allocations").insert(inserts);
      if (insertError) return err(parseSupabaseError(insertError, { table: "allocations" }));
    }

    return ok({
      allocations_inserted: inserts.length,
      shortfalls: [...shortfallByItem.entries()].map(([inventory_item_id, quantity]) => ({
        inventory_item_id,
        quantity,
      })),
    });
  } catch (e) {
    return err({
      code: "UNKNOWN",
      message: `Failed to deplete packaging materials: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
}

// =============================================================================
// 9.3 / 9.4 Loss + quick depletion allocations
// =============================================================================

/**
 * Record a completed loss allocation against a batch
 * (source_type='batch', destination_type='loss'). Feeds the TTB losses line.
 */
export async function recordBatchLoss(
  supabase: Client,
  params: {
    batchId: string;
    volumeBbl: number;
    reasonCode: string;
    notes?: string | null;
  }
): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabase.from("allocations").insert({
      source_type: "batch",
      source_id: params.batchId,
      destination_type: "loss",
      destination_id: null,
      quantity: params.volumeBbl,
      volume_bbl: params.volumeBbl,
      status: "completed",
      completed_at: new Date().toISOString(),
      reason_code: params.reasonCode,
      notes: params.notes ?? null,
    });
    if (error) return err(parseSupabaseError(error, { table: "allocations" }));
    return ok(null);
  } catch (e) {
    return err({
      code: "UNKNOWN",
      message: `Failed to record loss: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
}

/** Destination types supported by quick depletion actions (9.4). */
export type QuickDepletionType = "sample" | "taproom_sale" | "destruction";

/**
 * Record a completed quick-depletion allocation from a finished good or
 * inventory lot (sample / taproom / write-off). Replaces the raw-UUID
 * generic allocation form for these common cases.
 */
export async function recordQuickDepletion(
  supabase: Client,
  params: {
    sourceType: "finished_good" | "inventory_lot";
    sourceId: string;
    destinationType: QuickDepletionType;
    quantity: number;
    volumeBbl?: number | null;
    reasonCode?: string | null;
    notes?: string | null;
  }
): Promise<ServiceResult<null>> {
  try {
    const { error } = await supabase.from("allocations").insert({
      source_type: params.sourceType,
      source_id: params.sourceId,
      destination_type: params.destinationType,
      destination_id: null,
      quantity: params.quantity,
      volume_bbl: params.volumeBbl ?? null,
      status: "completed",
      completed_at: new Date().toISOString(),
      reason_code: params.reasonCode ?? null,
      notes: params.notes ?? null,
    });
    if (error) return err(parseSupabaseError(error, { table: "allocations" }));
    return ok(null);
  } catch (e) {
    return err({
      code: "UNKNOWN",
      message: `Failed to record depletion: ${e instanceof Error ? e.message : String(e)}`,
      cause: e,
    });
  }
}
