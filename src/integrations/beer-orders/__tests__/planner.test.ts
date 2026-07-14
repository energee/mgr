/** Reconciliation planning tests for mappings, pricing, idempotency, and stale safety. */

import { describe, expect, it } from "vitest";
import { buildBeerOrderImportPlan } from "../planner";
import type {
  BeerOrderReferenceData,
  ParsedBeerOrderWorkbook,
} from "../types";

const IDS = {
  brand: "11111111-1111-4111-8111-111111111111",
  customer: "22222222-2222-4222-8222-222222222222",
  channel: "33333333-3333-4333-8333-333333333333",
  half: "44444444-4444-4444-8444-444444444444",
  sixtel: "55555555-5555-4555-8555-555555555555",
  case: "66666666-6666-4666-8666-666666666666",
  owner: "77777777-7777-4777-8777-777777777777",
};

function parsed(beer = "Verus IPA", customerLabel = "Sarene East"): ParsedBeerOrderWorkbook {
  return {
    orders: [{
      sheet: "7-15-26",
      customerLabel,
      orderDate: "2026-07-15",
      requestedDate: "2026-07-16",
      lines: [{ beer, formatKey: "half", quantity: 2, tier: null, styleLabel: "IPA" }],
    }],
    prices: { 3: { half: 168, sixtel: 79, case: 58 } },
    skippedInternalBlocks: 1,
    skippedInactiveBlocks: 0,
  };
}

function references(): BeerOrderReferenceData {
  return {
    brands: [{ id: IDS.brand, name: "Verus", variant: null }],
    customers: [{
      id: IDS.customer,
      name: "Sarene Craft East",
      customer_type: "distributor",
      sales_channel_id: IDS.channel,
      price_tier_id: null,
    }],
    formats: [
      { id: IDS.half, name: "Keg", unit_count: 1, container: { name: "1/2 Barrel", type: "keg" } },
      { id: IDS.sixtel, name: "Keg", unit_count: 1, container: { name: "1/6 Barrel", type: "keg" } },
      { id: IDS.case, name: "Case", unit_count: 24, container: { name: "12oz Can", type: "can" } },
    ],
    channels: [{ id: IDS.channel, name: "Distributor" }],
    kegOwners: [{ id: IDS.owner, name: "Microstar", is_active: true }],
    existingOrders: [],
    existingItems: [],
    customerMappings: [],
    brandMappings: [],
  };
}

describe("buildBeerOrderImportPlan", () => {
  it("uses approved aliases, Distributor pricing, Microstar kegs, and draft creation", () => {
    const plan = buildBeerOrderImportPlan(parsed(), references());

    expect(plan.ready).toBe(true);
    expect(plan.summary).toMatchObject({ createdOrders: 1, plannedLines: 1, skippedInternalBlocks: 1 });
    expect(plan.orders[0]).toMatchObject({
      customerName: "Sarene Craft East",
      status: "draft",
      change: "create",
      lines: [{ brandName: "Verus", unitPrice: 168, kegOwnerId: IDS.owner, tier: 3 }],
    });
  });

  it("returns unknown beers for explicit mapping and applies the selected brand and tier", () => {
    const initial = buildBeerOrderImportPlan(parsed("Future Beer"), references());
    expect(initial.ready).toBe(false);
    expect(initial.unresolved.brands).toEqual([expect.objectContaining({
      sourceKey: "future beer",
      requiresBrand: true,
    })]);

    const resolved = buildBeerOrderImportPlan(parsed("Future Beer"), references(), {
      brands: { "future beer": { brandId: IDS.brand, tier: 3 } },
    });
    expect(resolved.ready).toBe(true);
    expect(resolved.brandMappings[0]).toMatchObject({ brandId: IDS.brand, distributorTier: 3 });
  });

  it("classifies an exact reimport as unchanged even when the existing order is packed", () => {
    const first = buildBeerOrderImportPlan(parsed(), references());
    const order = first.orders[0]!;
    const refs = references();
    refs.existingOrders = [{
      id: order.id,
      order_number: order.orderNumber,
      customer_id: order.customerId,
      status: "packed",
      order_date: order.orderDate,
      requested_date: order.requestedDate,
      scheduled_date: order.requestedDate,
      notes: order.notes,
      is_export: order.isExport,
    }];
    refs.existingItems = order.lines.map((line) => ({
      id: line.id,
      order_id: line.orderId,
      brand_id: line.brandId,
      selling_format_id: line.sellingFormatId,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      keg_owner_id: line.kegOwnerId,
      notes: line.notes,
    }));

    const second = buildBeerOrderImportPlan(parsed(), refs);
    expect(second.orders[0]?.change).toBe("unchanged");
    expect(second.summary.unchangedOrders).toBe(1);
  });

  it("reports spreadsheet orders absent from the upload without planning deletion", () => {
    const refs = references();
    refs.existingOrders = [{
      id: "88888888-8888-4888-8888-888888888888",
      order_number: "XLSX-20260101-OLD",
      customer_id: IDS.customer,
      status: "fulfilled",
      order_date: "2026-01-01",
      requested_date: null,
      scheduled_date: null,
      notes: null,
      is_export: false,
    }];

    const plan = buildBeerOrderImportPlan(parsed(), refs);
    expect(plan.staleOrders).toEqual([expect.objectContaining({ orderNumber: "XLSX-20260101-OLD" })]);
    expect(plan.summary.staleOrders).toBe(1);
  });
});
