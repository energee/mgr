/** Deterministic, non-destructive reconciliation planner for Beer Orders workbooks. */

import { v5 as uuidv5 } from "uuid";
import {
  BEER_ORDER_IMPORT_NAMESPACE,
  BRAND_ALIASES,
  CUSTOMER_ALIASES,
  DEFAULT_TIER_BY_BRAND,
  DOMESTIC_CUSTOMERS,
} from "./constants";
import { normalizeBeerOrderValue } from "./parser";
import type {
  BeerOrderBrandRow,
  BeerOrderCustomerRow,
  BeerOrderFormatKey,
  BeerOrderImportPlan,
  BeerOrderImportSummary,
  BeerOrderMappingOverrides,
  BeerOrderReferenceData,
  ExistingBeerOrderItemRow,
  ExistingBeerOrderRow,
  ParsedBeerOrderWorkbook,
  PlannedBeerOrder,
  PlannedBeerOrderBrandMapping,
  PlannedBeerOrderCustomer,
  PlannedBeerOrderCustomerMapping,
  PlannedBeerOrderLine,
  RawBeerOrderLine,
  UnresolvedBeerOrderBrand,
  UnresolvedBeerOrderCustomer,
} from "./types";

type ResolvedCustomer = { row: BeerOrderCustomerRow; mapping: PlannedBeerOrderCustomerMapping };
type ResolvedBrand = { row: BeerOrderBrandRow; mappedTier: number | null };
type ResolvedLine = { raw: RawBeerOrderLine; brand: BeerOrderBrandRow; tier: number };

const EMPTY_SUMMARY: BeerOrderImportSummary = {
  sourceOrders: 0,
  sourceLines: 0,
  plannedOrders: 0,
  plannedLines: 0,
  createdOrders: 0,
  updatedOrders: 0,
  unchangedOrders: 0,
  customersToCreate: 0,
  staleOrders: 0,
  skippedInternalBlocks: 0,
  skippedInactiveBlocks: 0,
};

function sourceCustomerKey(label: string): string {
  return normalizeBeerOrderValue(label.replace(/\s*\([^)]*\)\s*$/, "").trim());
}

function findUnique<T>(rows: T[], description: string): T | null {
  if (rows.length > 1) throw new Error(`${description} resolved to ${rows.length} records`);
  return rows[0] ?? null;
}

function customerCreation(name: string, salesChannelId: string): PlannedBeerOrderCustomer {
  return {
    id: uuidv5(`customer:${name}`, BEER_ORDER_IMPORT_NAMESPACE),
    name,
    customerType: "distributor",
    salesChannelId,
    priceTierId: null,
    isActive: true,
    notes: "Created from Beer orders.xlsx source-of-truth import",
  };
}

function asCustomerRow(row: PlannedBeerOrderCustomer): BeerOrderCustomerRow {
  return {
    id: row.id,
    name: row.name,
    customer_type: row.customerType,
    sales_channel_id: row.salesChannelId,
    price_tier_id: row.priceTierId,
  };
}

function resolveCustomer(
  sourceLabel: string,
  references: BeerOrderReferenceData,
  overrides: BeerOrderMappingOverrides,
  distributorChannelId: string,
  creations: Map<string, PlannedBeerOrderCustomer>,
): ResolvedCustomer | null {
  const sourceKey = sourceCustomerKey(sourceLabel);
  const override = overrides.customers?.[sourceKey];
  if (override?.customerId) {
    const row = references.customers.find((customer) => customer.id === override.customerId);
    if (!row) throw new Error(`Customer override for ${sourceLabel} points to a missing customer`);
    return { row, mapping: { sourceKey, sourceLabel, customerId: row.id } };
  }
  if (override?.createName?.trim()) {
    const name = override.createName.trim();
    const existing = findUnique(
      references.customers.filter((customer) => normalizeBeerOrderValue(customer.name) === normalizeBeerOrderValue(name)),
      `Customer ${name}`,
    );
    const creation = customerCreation(name, distributorChannelId);
    if (!existing) creations.set(creation.id, creation);
    const row = existing ?? asCustomerRow(creation);
    return { row, mapping: { sourceKey, sourceLabel, customerId: row.id } };
  }

  const saved = references.customerMappings.find((mapping) => mapping.source_key === sourceKey);
  if (saved) {
    const row = references.customers.find((customer) => customer.id === saved.customer_id);
    if (row) return { row, mapping: { sourceKey, sourceLabel, customerId: row.id } };
  }

  const canonicalName = CUSTOMER_ALIASES[sourceKey];
  if (canonicalName) {
    const existing = findUnique(
      references.customers.filter(
        (customer) => normalizeBeerOrderValue(customer.name) === normalizeBeerOrderValue(canonicalName),
      ),
      `Customer alias ${sourceLabel} → ${canonicalName}`,
    );
    const creation = customerCreation(canonicalName, distributorChannelId);
    if (!existing) creations.set(creation.id, creation);
    const row = existing ?? asCustomerRow(creation);
    return { row, mapping: { sourceKey, sourceLabel, customerId: row.id } };
  }

  const exact = findUnique(
    references.customers.filter((customer) => normalizeBeerOrderValue(customer.name) === sourceKey),
    `Customer ${sourceLabel}`,
  );
  return exact
    ? { row: exact, mapping: { sourceKey, sourceLabel, customerId: exact.id } }
    : null;
}

function resolveBrand(
  sourceLabel: string,
  references: BeerOrderReferenceData,
  overrides: BeerOrderMappingOverrides,
): ResolvedBrand | null {
  const sourceKey = normalizeBeerOrderValue(sourceLabel);
  const override = overrides.brands?.[sourceKey];
  if (override) {
    const row = references.brands.find((brand) => brand.id === override.brandId);
    if (!row) throw new Error(`Brand override for ${sourceLabel} points to a missing brand`);
    return { row, mappedTier: override.tier ?? null };
  }
  const saved = references.brandMappings.find((mapping) => mapping.source_key === sourceKey);
  if (saved) {
    const row = references.brands.find((brand) => brand.id === saved.brand_id);
    if (row) return { row, mappedTier: saved.distributor_tier };
  }

  const alias = BRAND_ALIASES[sourceKey];
  const variantOnly = alias?.startsWith("variant:") ?? false;
  const targetKey = normalizeBeerOrderValue(
    variantOnly ? alias!.slice("variant:".length) : (alias ?? sourceLabel),
  );
  let matches = references.brands.filter((brand) =>
    variantOnly
      ? normalizeBeerOrderValue(brand.variant) === targetKey
      : normalizeBeerOrderValue(brand.name) === targetKey,
  );
  if (!variantOnly && matches.length === 0) {
    matches = references.brands.filter((brand) => normalizeBeerOrderValue(brand.variant) === targetKey);
  }
  const row = findUnique(matches, `Brand mapping ${sourceLabel} → ${alias ?? sourceLabel}`);
  return row ? { row, mappedTier: null } : null;
}

function tierFromStyle(styleLabel: string): number | null {
  const explicit = /tier\s*([1-7])/i.exec(styleLabel);
  if (explicit) return Number(explicit[1]);
  const style = normalizeBeerOrderValue(styleLabel);
  if (["pale", "pale ale", "ipa"].includes(style)) return 3;
  if (style === "west coast") return 4;
  if (["dipa", "double ipa", "tipa"].includes(style)) return 5;
  if (["mex lager", "pilsner", "vienna lager", "lager tier 2"].includes(style)) return 2;
  if (["lager", "helles"].includes(style)) return 1;
  return null;
}

function resolveTier(
  line: RawBeerOrderLine,
  brand: BeerOrderBrandRow,
  mappedTier: number | null,
  learnedTiers: Map<string, Set<number>>,
): number | null {
  if (line.tier !== null) return line.tier;
  const styleTier = tierFromStyle(line.styleLabel);
  if (/tier\s*[1-7]/i.test(line.styleLabel) && styleTier) return styleTier;
  if (mappedTier) return mappedTier;
  const learned = learnedTiers.get(brand.id);
  if (learned?.size === 1) return [...learned][0] ?? null;
  return DEFAULT_TIER_BY_BRAND[brand.name] ?? styleTier;
}

function formatRows(references: BeerOrderReferenceData): Record<BeerOrderFormatKey, string> {
  const result: Partial<Record<BeerOrderFormatKey, string>> = {};
  references.formats.forEach((format) => {
    const containerName = normalizeBeerOrderValue(format.container?.name);
    if (normalizeBeerOrderValue(format.name) === "case" && format.unit_count === 24) result.case = format.id;
    if (containerName === "1 2 barrel") result.half = format.id;
    if (containerName === "1 6 barrel") result.sixtel = format.id;
  });
  if (!result.half || !result.sixtel || !result.case) {
    throw new Error(`Could not resolve half, sixtel, and case selling formats`);
  }
  return result as Record<BeerOrderFormatKey, string>;
}

function comparableLine(line: PlannedBeerOrderLine | ExistingBeerOrderItemRow): string {
  const planned = "orderId" in line;
  return JSON.stringify({
    id: line.id,
    brandId: planned ? line.brandId : line.brand_id,
    formatId: planned ? line.sellingFormatId : line.selling_format_id,
    quantity: line.quantity,
    unitPrice: Number(planned ? line.unitPrice : line.unit_price ?? 0).toFixed(2),
    kegOwnerId: planned ? line.kegOwnerId : line.keg_owner_id,
    notes: line.notes,
  });
}

function orderChanged(
  existing: ExistingBeerOrderRow,
  planned: Omit<PlannedBeerOrder, "change">,
  existingItems: ExistingBeerOrderItemRow[],
): boolean {
  if (
    existing.customer_id !== planned.customerId ||
    existing.order_date !== planned.orderDate ||
    existing.requested_date !== planned.requestedDate ||
    existing.notes !== planned.notes ||
    Boolean(existing.is_export) !== planned.isExport
  ) return true;
  const before = existingItems.map(comparableLine).sort();
  const after = planned.lines.map(comparableLine).sort();
  return JSON.stringify(before) !== JSON.stringify(after);
}

function basePlan(
  parsed: ParsedBeerOrderWorkbook,
  references: BeerOrderReferenceData,
): BeerOrderImportPlan {
  return {
    version: 1,
    ready: false,
    summary: {
      ...EMPTY_SUMMARY,
      sourceOrders: parsed.orders.length,
      sourceLines: parsed.orders.reduce((sum, order) => sum + order.lines.length, 0),
      skippedInternalBlocks: parsed.skippedInternalBlocks,
      skippedInactiveBlocks: parsed.skippedInactiveBlocks,
    },
    unresolved: { customers: [], brands: [] },
    options: {
      customers: references.customers
        .map(({ id, name }) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      brands: references.brands
        .map(({ id, name, variant }) => ({ id, name, variant }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    customersToCreate: [],
    customerMappings: [],
    brandMappings: [],
    orders: [],
    staleOrders: [],
  };
}

export function buildBeerOrderImportPlan(
  parsed: ParsedBeerOrderWorkbook,
  references: BeerOrderReferenceData,
  overrides: BeerOrderMappingOverrides = {},
): BeerOrderImportPlan {
  const plan = basePlan(parsed, references);
  const distributorChannel = findUnique(
    references.channels.filter((channel) => normalizeBeerOrderValue(channel.name) === "distributor"),
    "Distributor sales channel",
  );
  if (!distributorChannel) throw new Error("Distributor sales channel not found");
  const microstar = findUnique(
    references.kegOwners.filter(
      (owner) => owner.is_active && normalizeBeerOrderValue(owner.name) === "microstar",
    ),
    "Active Microstar keg owner",
  );
  if (!microstar) throw new Error("Active Microstar keg owner not found");

  const creations = new Map<string, PlannedBeerOrderCustomer>();
  const customers = new Map<string, ResolvedCustomer>();
  const unresolvedCustomers = new Map<string, UnresolvedBeerOrderCustomer>();
  parsed.orders.forEach((order) => {
    const sourceKey = sourceCustomerKey(order.customerLabel);
    if (customers.has(sourceKey) || unresolvedCustomers.has(sourceKey)) return;
    const resolved = resolveCustomer(
      order.customerLabel,
      references,
      overrides,
      distributorChannel.id,
      creations,
    );
    if (resolved) customers.set(sourceKey, resolved);
    else unresolvedCustomers.set(sourceKey, { sourceKey, sourceLabel: order.customerLabel });
  });

  const brands = new Map<string, ResolvedBrand>();
  const unresolvedBrands = new Map<string, UnresolvedBeerOrderBrand>();
  parsed.orders.flatMap((order) => order.lines).forEach((line) => {
    const sourceKey = normalizeBeerOrderValue(line.beer);
    if (brands.has(sourceKey) || unresolvedBrands.has(sourceKey)) return;
    const resolved = resolveBrand(line.beer, references, overrides);
    if (resolved) brands.set(sourceKey, resolved);
    else {
      unresolvedBrands.set(sourceKey, {
        sourceKey,
        sourceLabel: line.beer,
        brandId: null,
        requiresBrand: true,
        requiresTier: line.tier === null && tierFromStyle(line.styleLabel) === null,
      });
    }
  });

  plan.unresolved.customers = [...unresolvedCustomers.values()];
  plan.unresolved.brands = [...unresolvedBrands.values()];
  if (plan.unresolved.customers.length || plan.unresolved.brands.length) return plan;

  const learnedTiers = new Map<string, Set<number>>();
  parsed.orders.flatMap((order) => order.lines).forEach((line) => {
    const brand = brands.get(normalizeBeerOrderValue(line.beer));
    if (!brand || line.tier === null) return;
    const tiers = learnedTiers.get(brand.row.id) ?? new Set<number>();
    tiers.add(line.tier);
    learnedTiers.set(brand.row.id, tiers);
  });

  const resolvedByOrder = new Map<RawBeerOrderLine[], ResolvedLine[]>();
  parsed.orders.forEach((order) => {
    const resolvedLines: ResolvedLine[] = [];
    order.lines.forEach((line) => {
      const sourceKey = normalizeBeerOrderValue(line.beer);
      const resolved = brands.get(sourceKey)!;
      const tier = resolveTier(line, resolved.row, resolved.mappedTier, learnedTiers);
      if (!tier) {
        unresolvedBrands.set(sourceKey, {
          sourceKey,
          sourceLabel: line.beer,
          brandId: resolved.row.id,
          requiresBrand: false,
          requiresTier: true,
        });
      } else {
        resolvedLines.push({ raw: line, brand: resolved.row, tier });
      }
    });
    resolvedByOrder.set(order.lines, resolvedLines);
  });
  plan.unresolved.brands = [...unresolvedBrands.values()];
  if (plan.unresolved.brands.length) return plan;

  const formats = formatRows(references);
  const existingByNumber = new Map(references.existingOrders.map((order) => [order.order_number, order]));
  const existingItemsByOrder = new Map<string, ExistingBeerOrderItemRow[]>();
  references.existingItems.forEach((item) => {
    const items = existingItemsByOrder.get(item.order_id) ?? [];
    items.push(item);
    existingItemsByOrder.set(item.order_id, items);
  });

  const plannedOrders: PlannedBeerOrder[] = parsed.orders.map((rawOrder) => {
    const customer = customers.get(sourceCustomerKey(rawOrder.customerLabel))!.row;
    const slug = normalizeBeerOrderValue(customer.name).toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12);
    const orderNumber = `XLSX-${rawOrder.orderDate.replaceAll("-", "")}-${slug}`;
    const existing = existingByNumber.get(orderNumber);
    const orderId = existing?.id ?? uuidv5(
      `order:${rawOrder.orderDate}:${normalizeBeerOrderValue(customer.name)}`,
      BEER_ORDER_IMPORT_NAMESPACE,
    );
    const aggregates = new Map<string, ResolvedLine & { quantity: number }>();
    resolvedByOrder.get(rawOrder.lines)!.forEach((line) => {
      const key = `${line.brand.id}:${line.raw.formatKey}`;
      const current = aggregates.get(key);
      if (current && current.tier !== line.tier) {
        throw new Error(`${rawOrder.sheet}: ${line.brand.name} ${line.raw.formatKey} has multiple price tiers`);
      }
      aggregates.set(key, { ...line, quantity: (current?.quantity ?? 0) + line.raw.quantity });
    });
    const lines = [...aggregates.values()]
      .sort((a, b) => `${a.brand.name}:${a.raw.formatKey}`.localeCompare(`${b.brand.name}:${b.raw.formatKey}`))
      .map<PlannedBeerOrderLine>((line) => {
        const unitPrice = parsed.prices[line.tier]?.[line.raw.formatKey];
        if (!unitPrice) throw new Error(`Tier ${line.tier} has no ${line.raw.formatKey} distributor price`);
        const sellingFormatId = formats[line.raw.formatKey];
        return {
          id: uuidv5(`item:${orderId}:${line.brand.id}:${sellingFormatId}`, BEER_ORDER_IMPORT_NAMESPACE),
          orderId,
          brandId: line.brand.id,
          brandName: line.brand.name,
          sellingFormatId,
          formatKey: line.raw.formatKey,
          quantity: line.quantity,
          tier: line.tier,
          unitPrice,
          kegOwnerId: line.raw.formatKey === "case" ? null : microstar.id,
          notes: `Distributor price tier ${line.tier}`,
        };
      });
    const withoutChange = {
      id: orderId,
      orderNumber,
      customerId: customer.id,
      customerName: customer.name,
      orderDate: rawOrder.orderDate,
      requestedDate: rawOrder.requestedDate,
      notes: `Beer orders.xlsx source of truth; sheet ${rawOrder.sheet}`,
      isExport: !DOMESTIC_CUSTOMERS.has(customer.name),
      sheet: rawOrder.sheet,
      status: "draft" as const,
      lines,
    };
    const change = !existing
      ? "create"
      : orderChanged(existing, withoutChange, existingItemsByOrder.get(existing.id) ?? [])
        ? "update"
        : "unchanged";
    return { ...withoutChange, change };
  });

  const plannedIds = new Set(plannedOrders.map((order) => order.id));
  const plannedNumbers = new Set(plannedOrders.map((order) => order.orderNumber));
  plan.staleOrders = references.existingOrders
    .filter((order) => order.order_number.startsWith("XLSX-") && !plannedIds.has(order.id) && !plannedNumbers.has(order.order_number))
    .map((order) => ({ id: order.id, orderNumber: order.order_number, status: order.status }));
  plan.customersToCreate = [...creations.values()];
  plan.customerMappings = [...customers.values()].map(({ mapping }) => mapping);

  const tiersBySource = new Map<string, Set<number>>();
  parsed.orders.flatMap((order) => order.lines).forEach((line) => {
    const sourceKey = normalizeBeerOrderValue(line.beer);
    const brand = brands.get(sourceKey)!;
    const tier = resolveTier(line, brand.row, brand.mappedTier, learnedTiers)!;
    const tiers = tiersBySource.get(sourceKey) ?? new Set<number>();
    tiers.add(tier);
    tiersBySource.set(sourceKey, tiers);
  });
  plan.brandMappings = [...brands.entries()].map<PlannedBeerOrderBrandMapping>(([sourceKey, brand]) => {
    const sourceLabel = parsed.orders.flatMap((order) => order.lines).find(
      (line) => normalizeBeerOrderValue(line.beer) === sourceKey,
    )!.beer;
    const tiers = tiersBySource.get(sourceKey) ?? new Set<number>();
    return {
      sourceKey,
      sourceLabel,
      brandId: brand.row.id,
      distributorTier: tiers.size === 1 ? [...tiers][0]! : brand.mappedTier,
    };
  });
  plan.orders = plannedOrders;
  plan.ready = true;
  plan.summary = {
    ...plan.summary,
    plannedOrders: plannedOrders.length,
    plannedLines: plannedOrders.reduce((sum, order) => sum + order.lines.length, 0),
    createdOrders: plannedOrders.filter((order) => order.change === "create").length,
    updatedOrders: plannedOrders.filter((order) => order.change === "update").length,
    unchangedOrders: plannedOrders.filter((order) => order.change === "unchanged").length,
    customersToCreate: plan.customersToCreate.length,
    staleOrders: plan.staleOrders.length,
  };
  return plan;
}
