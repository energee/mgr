/**
 * MongoDB → PostgreSQL Transformers
 *
 * Pure functions that convert MongoDB documents into Postgres row shapes.
 * Each transformer handles field mapping, unit conversion, and FK resolution.
 */

import { objectIdToUuid } from "./id";
import type {
  MongoBatch,
  MongoBeer,
  MongoBrewLog,
  MongoHop,
  MongoMalt,
  MongoOrder,
  MongoOrderProduct,
  MongoStyle,
  MongoSupplier,
  MongoTest,
  MongoTransfer,
  MongoVessel,
  MongoYeast,
} from "./types";

// =============================================================================
// Shared helpers
// =============================================================================

/** Derive a stable batch_code from a Mongo batch name or ObjectId. */
export function deriveBatchCode(name: string | undefined | null, mongoId: string): string {
  return name
    ? name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase().slice(0, 50)
    : `mongo-${mongoId.slice(-8)}`;
}

// =============================================================================
// Phase 1 — Standalone entities
// =============================================================================

export function transformSupplier(doc: MongoSupplier) {
  return {
    id: objectIdToUuid(doc._id.toString()),
    name: doc.name,
    is_active: true,
  };
}

export function transformMalt(doc: MongoMalt, supplierIdMap: Map<string, string>) {
  const supplierId = doc.supplier?.toString();
  const maltster = supplierId ? supplierIdMap.get(supplierId) ?? null : null;

  const extractPct = doc.yieldOnGrind;
  const potentialPpg = extractPct ? Math.round(extractPct * 0.46 * 10) / 10 : null;

  const bagWeight = doc.weight ?? 55;
  const price = doc.price ?? 0;
  const costPerLb = price && bagWeight > 0 ? Math.round((price / bagWeight) * 100) / 100 : null;

  return {
    id: objectIdToUuid(doc._id.toString()),
    name: doc.name,
    maltster,
    color_lovibond: doc.color ?? doc.srm ?? null,
    diastatic_power: doc.diastaticPower ?? null,
    moisture_percent: doc.moisture ?? null,
    protein_percent: doc.protein ?? null,
    potential_ppg: potentialPpg,
    bag_weight_lbs: bagWeight,
    cost_per_lb: costPerLb,
    is_active: true,
  };
}

export function transformHop(doc: MongoHop) {
  const alpha = doc.alphaAcid;
  return {
    id: objectIdToUuid(doc._id.toString()),
    name: doc.name,
    alpha_acid_typical: alpha ?? null,
    alpha_acid_min: alpha ? Math.round(alpha * 0.9 * 10) / 10 : null,
    alpha_acid_max: alpha ? Math.round(alpha * 1.1 * 10) / 10 : null,
    beta_acid_min: doc.betaAcid ?? null,
    beta_acid_max: doc.betaAcid ?? null,
    oil_ml_100g: doc.totalOil ?? null,
    bag_weight_lbs: doc.weight ?? 11,
    cost_per_lb: doc.pricePerPound ?? null,
    is_active: true,
  };
}

export function transformYeast(doc: MongoYeast, supplierIdMap: Map<string, string>) {
  const supplierId = doc.supplier?.toString();
  const manufacturer = supplierId ? supplierIdMap.get(supplierId) ?? null : null;

  return {
    id: objectIdToUuid(doc._id.toString()),
    name: doc.name,
    manufacturer,
    temp_min_f: doc.temperatureRange?.low ?? null,
    temp_max_f: doc.temperatureRange?.high ?? null,
    attenuation_min: doc.attenuation?.low ?? null,
    attenuation_max: doc.attenuation?.high ?? null,
    flocculation: doc.flocculation ?? null,
    alcohol_tolerance: doc.alcoholTolerance ?? null,
    is_active: true,
  };
}

/**
 * Styles are matched by name to existing BJCP-seeded beer_styles rows.
 * We don't set id — let the existing row keep its UUID so brand.style_id
 * references resolve correctly. The sync function handles name-based matching.
 */
export function transformStyle(doc: MongoStyle) {
  return {
    name: doc.name,
    category: "uncategorized",
    is_active: true,
  };
}

// =============================================================================
// Phase 2 — First-level dependencies
// =============================================================================

/** Map of Mongo hop ObjectId → {uuid, name} for brand.hops JSONB field. */
export type HopLookup = Map<string, { uuid: string; name: string }>;

export function transformBeer(doc: MongoBeer, hopLookup: HopLookup) {
  const hopsJsonb = (doc.hops ?? []).map((hopId) => {
    const hop = hopLookup.get(hopId.toString());
    return hop
      ? { hop_id: hop.uuid, name: hop.name }
      : { hop_id: objectIdToUuid(hopId.toString()), name: "Unknown" };
  });

  return {
    name: doc.name,
    style_id: doc.style ? objectIdToUuid(doc.style.toString()) : null,
    description: doc.description ?? null,
    abv: doc.abv ?? null,
    variant: doc.variant ?? null,
    hops: hopsJsonb,
    untappd_url: doc.untappdUrl ?? null,
    untappd_rating: doc.untappdRatingValue ?? null,
  };
}

const VESSEL_TYPE_MAP: Record<string, string> = {
  unitank: "fermenter",
  briteTank: "brite",
  foeder: "foeder",
};

const VESSEL_NAME_TYPE_MAP: Record<string, string> = {
  Kettle: "kettle",
  MLT: "mash_tun",
};

const VESSEL_STATUS_MAP: Record<string, string> = {
  ready_for_use: "ready_for_use",
  in_use: "in_use",
  dirty: "dirty",
};

export function transformVessel(doc: MongoVessel) {
  let vesselType = VESSEL_TYPE_MAP[doc.type] ?? null;
  if (!vesselType) {
    vesselType = VESSEL_NAME_TYPE_MAP[doc.name] ?? "fermenter";
  }

  return {
    name: doc.name,
    vessel_type: vesselType,
    capacity_bbl: doc.capacity,
    status: VESSEL_STATUS_MAP[doc.state ?? ""] ?? "ready_for_use",
    is_active: true,
  };
}

// =============================================================================
// Phase 3 — Production chain
// =============================================================================

export function transformBatch(doc: MongoBatch) {
  // Infer status from available data
  let status: string;
  if (doc.canningDay && doc.canningDay.length > 0) {
    status = "completed";
  } else if (doc.currentVessel) {
    status = "fermenting";
  } else {
    status = "completed";
  }

  const brewDate = doc.date ? new Date(doc.date).toISOString().split("T")[0] : null;

  const batchCode = deriveBatchCode(doc.name, doc._id.toString());

  return {
    batch_code: batchCode,
    name: doc.name ?? null,
    status,
    planned_start_date: brewDate,
    notes: doc.notes ?? null,
  };
}

export function transformTransfer(doc: MongoTransfer) {
  return {
    id: objectIdToUuid(doc._id.toString()),
    batch_id: objectIdToUuid(doc.batch.toString()),
    from_vessel_id: doc.transferFrom ? objectIdToUuid(doc.transferFrom.toString()) : null,
    to_vessel_id: objectIdToUuid(doc.transferTo.toString()),
    volume_bbl: doc.quantity,
    transferred_at: doc.date instanceof Date ? doc.date.toISOString() : new Date(doc.date).toISOString(),
    notes: null,
  };
}

const ORDER_STATUS_MAP: Record<string, string> = {
  completed: "fulfilled",
  scheduled: "scheduled",
  cancelled: "cancelled",
  draft: "draft",
  pending: "draft",
  "in-progress": "confirmed",
};

export function transformOrder(doc: MongoOrder, orderIndex: number) {
  const orderDate = doc.date ? new Date(doc.date) : new Date(doc.createdAt ?? Date.now());
  const datePart = orderDate.toISOString().slice(0, 10).replace(/-/g, "");
  const orderNumber = `ORD-${datePart}-${String(orderIndex).padStart(3, "0")}`;

  return {
    order_number: orderNumber,
    status: ORDER_STATUS_MAP[doc.status ?? "draft"] ?? "draft",
    order_date: orderDate.toISOString().split("T")[0],
    fulfilled_date: doc.completedDate
      ? new Date(doc.completedDate).toISOString().split("T")[0]
      : null,
    notes: doc.notes ?? null,
    is_export: false,
  };
}

export function transformOrderItem(
  product: MongoOrderProduct,
  orderId: string,
  orderMongoId: string,
  itemIndex: number
) {
  const itemId = product.id
    ? objectIdToUuid(product.id)
    : objectIdToUuid(`${orderMongoId}-${itemIndex}`);

  const brandId = product.product?.value
    ? objectIdToUuid(product.product.value.toString())
    : null;

  return {
    id: itemId,
    order_id: orderId,
    brand_id: brandId,
    quantity: product.quantity,
    unit_price: product.pricing?.unitPrice ?? null,
  };
}

/** Convert structured brew day fields into the events timeline format. */
function buildEventsFromStructuredData(doc: MongoBrewLog): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  let seq = 0;
  const makeId = () => `migrated-${++seq}`;

  const sw = doc.strikeWater as Record<string, unknown> | undefined;
  if (sw?.beginTime) {
    const m: Record<string, unknown>[] = [];
    if (sw.strikeTemp) m.push({ metric: "temp_f", value: String(sw.strikeTemp) });
    if (sw.volume) m.push({ metric: "volume_l", value: String(sw.volume) });
    events.push({ id: makeId(), phase: "strike_water", time: sw.beginTime, measurements: m });
  }

  const mi = doc.mashIn as Record<string, unknown> | undefined;
  if (mi?.beginTime) {
    const m: Record<string, unknown>[] = [];
    if (mi.actualMashPH) m.push({ metric: "ph", value: String(mi.actualMashPH) });
    if (mi.mashWaterUsed) m.push({ metric: "volume_l", value: String(mi.mashWaterUsed) });
    events.push({ id: makeId(), phase: "mash_in", time: mi.beginTime, measurements: m });
  }

  const ro = doc.runoff as Record<string, unknown> | undefined;
  if (ro?.beginTime) {
    const m: Record<string, unknown>[] = [];
    if (ro.flowRate) m.push({ metric: "flow_rate", value: String(ro.flowRate) });
    events.push({ id: makeId(), phase: "runoff_start", time: ro.beginTime, measurements: m });
  }

  const sp = doc.sparge as Record<string, unknown> | undefined;
  if (sp?.beginTime) {
    const m: Record<string, unknown>[] = [];
    if (sp.waterTemp) m.push({ metric: "temp_f", value: String(sp.waterTemp) });
    if (sp.waterPH) m.push({ metric: "ph", value: String(sp.waterPH) });
    events.push({ id: makeId(), phase: "sparge_start", time: sp.beginTime, measurements: m });
  }

  const bo = doc.boil as Record<string, unknown> | undefined;
  if (bo?.beginTime) {
    const m: Record<string, unknown>[] = [];
    if (bo.preBoilGravity) m.push({ metric: "gravity_plato", value: String(bo.preBoilGravity) });
    if (bo.preBoilVolume) m.push({ metric: "volume_bbl", value: String(bo.preBoilVolume) });
    events.push({ id: makeId(), phase: "boil_start", time: bo.beginTime, measurements: m });
  }

  const wp = doc.whirlpool as Record<string, unknown> | undefined;
  if (wp?.beginTime) {
    const m: Record<string, unknown>[] = [];
    if (wp.temp) m.push({ metric: "temp_f", value: String(wp.temp) });
    events.push({ id: makeId(), phase: "whirlpool_start", time: wp.beginTime, measurements: m });
  }

  const ko = doc.knockOut as Record<string, unknown> | undefined;
  if (ko?.beginTime) {
    const m: Record<string, unknown>[] = [];
    if (ko.koTemp) m.push({ metric: "temp_f", value: String(ko.koTemp) });
    events.push({ id: makeId(), phase: "ko_start", time: ko.beginTime, measurements: m });
  }
  if (ko?.finishTime) {
    const m: Record<string, unknown>[] = [];
    if (ko.volumeKO) m.push({ metric: "volume_bbl", value: String(ko.volumeKO) });
    events.push({ id: makeId(), phase: "ko_end", time: ko.finishTime, measurements: m });
  }

  const yp = doc.yeastPitching as Record<string, unknown> | undefined;
  if (yp?.pitchTime) {
    events.push({ id: makeId(), phase: "yeast_pitch", time: yp.pitchTime, measurements: [] });
  }

  return events;
}

export function transformBrewLog(doc: MongoBrewLog, index: number) {
  const brewDate = doc.brewDate instanceof Date
    ? doc.brewDate.toISOString().split("T")[0]
    : doc.brewDate ? new Date(doc.brewDate).toISOString().split("T")[0]
    : doc.createdAt ? new Date(doc.createdAt as unknown as string).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  const year = brewDate.slice(0, 4);
  const brewNumber = `BRW-${year}-${String(index).padStart(3, "0")}`;

  // Use existing events array if present, otherwise convert structured fields
  const events = (doc.events && doc.events.length > 0)
    ? doc.events
    : buildEventsFromStructuredData(doc);

  // Store the structured Mongo data as legacy_data for reference
  const legacyData: Record<string, unknown> = {};
  if (doc.strikeWater) legacyData.strikeWater = doc.strikeWater;
  if (doc.mashIn) legacyData.mashIn = doc.mashIn;
  if (doc.runoff) legacyData.runoff = doc.runoff;
  if (doc.sparge) legacyData.sparge = doc.sparge;
  if (doc.boil) legacyData.boil = doc.boil;
  if (doc.whirlpool) legacyData.whirlpool = doc.whirlpool;
  if (doc.knockOut) legacyData.knockOut = doc.knockOut;
  if (doc.yeastPitching) legacyData.yeastPitching = doc.yeastPitching;
  if (doc.summary) legacyData.summary = doc.summary;
  if (doc.actualOG) legacyData.actualOG = doc.actualOG;
  if (doc.actualMashEfficiency) legacyData.actualMashEfficiency = doc.actualMashEfficiency;

  return {
    brew_number: brewNumber,
    brew_date: brewDate,
    status: "completed",
    events,
    legacy_data: Object.keys(legacyData).length > 0 ? legacyData : null,
    notes: doc.notes ?? null,
  };
}

// =============================================================================
// Phase 4 — Batch readings
// =============================================================================

export function transformTest(doc: MongoTest) {
  const measurements: Array<{ type: string; value?: number; unit?: string }> = [];

  if (doc.temperature != null) {
    measurements.push({ type: "temperature", value: doc.temperature, unit: "F" });
  }
  if (doc.ph != null) {
    measurements.push({ type: "ph", value: doc.ph });
  }

  const recordedAt = doc.time instanceof Date
    ? doc.time.toISOString()
    : new Date(doc.time).toISOString();

  return {
    batch_id: objectIdToUuid(doc.batch.toString()),
    recorded_at: recordedAt,
    measurements,
    notes: doc.name ?? null,
  };
}
