/**
 * Characterization tests for the backward-planning calculator: pin the pure
 * date/name formatters exactly, and pin the aggregation math (demand ->
 * production requirements -> summary) against a fake Supabase query builder
 * that mirrors the exact `.from().select()...` chains the module calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/client-logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Table-keyed fake data the test bodies populate before calling the module.
// Each table's queue entry is a thenable "query builder" stub: every chain
// method (.select/.in/.or/.order/.eq) returns `this` so any call order the
// source uses resolves the same way, and `await`-ing it yields {data,error}.
type Resolved = { data: unknown; error: unknown };
const tableResults = new Map<string, Resolved>();

function makeBuilder(table: string) {
  const result = tableResults.get(table) ?? { data: [], error: null };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.in = chain;
  builder.or = chain;
  builder.order = chain;
  builder.eq = chain;
  builder.then = (resolve: (v: Resolved) => unknown) => resolve(result);
  return builder;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}));

import {
  formatPlanningDate,
  getProductDisplayName,
  getOrderDemand,
  getProductionRequirements,
  getBackwardPlanningSummary,
  type ProductionRequirement,
} from "../backward-planner";

beforeEach(() => {
  tableResults.clear();
});

// =============================================================================
// Pure helpers
// =============================================================================

describe("formatPlanningDate", () => {
  it("returns an em dash placeholder for null", () => {
    expect(formatPlanningDate(null)).toBe("—");
  });

  // `new Date("YYYY-MM-DD")` parses as UTC midnight, so `toLocaleDateString`
  // renders one calendar day earlier in timezones behind UTC (e.g. this
  // suite's America/New_York environment). Characterizing that as-is: this
  // is a real quirk of the current implementation, not a test bug.
  it("formats a valid date string as 'Mon D, YYYY' (UTC-midnight parse shifts a day behind UTC)", () => {
    expect(formatPlanningDate("2026-03-15")).toBe("Mar 14, 2026");
  });

  it("formats single-digit days without zero-padding", () => {
    expect(formatPlanningDate("2026-01-05")).toBe("Jan 4, 2026");
  });

  it("formats a year-end date", () => {
    expect(formatPlanningDate("2025-12-31")).toBe("Dec 30, 2025");
  });
});

describe("getProductDisplayName", () => {
  const baseReq: ProductionRequirement = {
    brand_id: null,
    brand_name: null,
    selling_format_id: null,
    selling_format_name: null,
    is_tbd: false,
    style_id: null,
    style_name: null,
    total_demand: 0,
    available_quantity: 0,
    in_production: 0,
    shortage: 0,
    earliest_requested_date: null,
    latest_requested_date: null,
    order_count: 0,
    order_numbers: [],
  };

  it("returns the brand name for a non-TBD requirement", () => {
    expect(getProductDisplayName({ ...baseReq, brand_name: "Coastal Haze" })).toBe(
      "Coastal Haze"
    );
  });

  it("falls back to 'Unknown Brand' when brand_name is null and not TBD", () => {
    expect(getProductDisplayName({ ...baseReq, brand_name: null })).toBe("Unknown Brand");
  });

  it("prefixes with 'TBD:' and uses style_name when is_tbd is true", () => {
    expect(
      getProductDisplayName({ ...baseReq, is_tbd: true, style_name: "Hazy IPA" })
    ).toBe("TBD: Hazy IPA");
  });

  it("falls back to 'TBD: Unknown Style' when is_tbd is true and style_name is null", () => {
    expect(getProductDisplayName({ ...baseReq, is_tbd: true, style_name: null })).toBe(
      "TBD: Unknown Style"
    );
  });

  it("ignores brand_name when is_tbd is true (style branch takes precedence)", () => {
    expect(
      getProductDisplayName({
        ...baseReq,
        is_tbd: true,
        brand_name: "Should Not Appear",
        style_name: "Pilsner",
      })
    ).toBe("TBD: Pilsner");
  });
});

// =============================================================================
// Async: getOrderDemand
// =============================================================================

describe("getOrderDemand", () => {
  it("returns [] when there are no open orders", async () => {
    tableResults.set("orders", { data: [], error: null });
    const result = await getOrderDemand();
    expect(result).toEqual([]);
  });

  it("throws when the orders query errors", async () => {
    const boom = new Error("orders query failed");
    tableResults.set("orders", { data: null, error: boom });
    await expect(getOrderDemand()).rejects.toThrow("orders query failed");
  });

  it("joins order items onto their order and resolves nested relation names", async () => {
    tableResults.set("orders", {
      data: [
        {
          id: "o-1",
          order_number: "SO-1001",
          customer_id: "c-1",
          status: "confirmed",
          order_date: "2026-06-01",
          requested_date: "2026-06-15",
          scheduled_date: null,
          customers: { name: "Acme Taproom" },
        },
      ],
      error: null,
    });
    tableResults.set("order_items", {
      data: [
        {
          id: "oi-1",
          order_id: "o-1",
          brand_id: "b-1",
          selling_format_id: "sf-1",
          quantity: 10,
          style_id: null,
          tbd_notes: null,
          brands: { name: "Coastal Haze" },
          selling_formats: { name: "1/2 BBL Keg" },
          beer_styles: null,
        },
      ],
      error: null,
    });

    const result = await getOrderDemand();

    expect(result).toEqual([
      {
        order_id: "o-1",
        order_number: "SO-1001",
        customer_id: "c-1",
        customer_name: "Acme Taproom",
        status: "confirmed",
        order_date: "2026-06-01",
        requested_date: "2026-06-15",
        scheduled_date: null,
        items: [
          {
            item_id: "oi-1",
            brand_id: "b-1",
            brand_name: "Coastal Haze",
            selling_format_id: "sf-1",
            selling_format_name: "1/2 BBL Keg",
            quantity: 10,
            is_tbd: false,
            style_id: null,
            style_name: null,
            tbd_notes: null,
          },
        ],
      },
    ]);
  });

  it("marks an item TBD when it has a style but no brand, and defaults missing relations to null", async () => {
    tableResults.set("orders", {
      data: [
        {
          id: "o-2",
          order_number: "SO-1002",
          customer_id: null,
          status: "draft",
          order_date: "2026-06-02",
          requested_date: null,
          scheduled_date: null,
          customers: null,
        },
      ],
      error: null,
    });
    tableResults.set("order_items", {
      data: [
        {
          id: "oi-2",
          order_id: "o-2",
          brand_id: null,
          selling_format_id: "sf-2",
          quantity: 5,
          style_id: "style-1",
          tbd_notes: "Any hazy IPA works",
          brands: null,
          selling_formats: { name: "1/6 BBL Keg" },
          beer_styles: { name: "Hazy IPA" },
        },
      ],
      error: null,
    });

    const result = await getOrderDemand();

    expect(result[0].customer_name).toBeNull();
    expect(result[0].items[0]).toEqual({
      item_id: "oi-2",
      brand_id: null,
      brand_name: null,
      selling_format_id: "sf-2",
      selling_format_name: "1/6 BBL Keg",
      quantity: 5,
      is_tbd: true,
      style_id: "style-1",
      style_name: "Hazy IPA",
      tbd_notes: "Any hazy IPA works",
    });
  });

  it("assigns an empty items array to orders with no matching order_items", async () => {
    tableResults.set("orders", {
      data: [
        {
          id: "o-3",
          order_number: "SO-1003",
          customer_id: null,
          status: "scheduled",
          order_date: "2026-06-03",
          requested_date: null,
          scheduled_date: "2026-06-20",
          customers: null,
        },
      ],
      error: null,
    });
    tableResults.set("order_items", { data: [], error: null });

    const result = await getOrderDemand();
    expect(result[0].items).toEqual([]);
  });
});

// =============================================================================
// Async: getProductionRequirements
// =============================================================================

describe("getProductionRequirements", () => {
  function setOrders(orders: unknown[]) {
    tableResults.set("orders", { data: orders, error: null });
  }
  function setItems(items: unknown[]) {
    tableResults.set("order_items", { data: items, error: null });
  }

  it("aggregates two orders for the same brand/package into one requirement with combined demand", async () => {
    setOrders([
      {
        id: "o-1",
        order_number: "SO-1",
        customer_id: null,
        status: "confirmed",
        order_date: "2026-06-01",
        requested_date: "2026-06-10",
        scheduled_date: null,
        customers: null,
      },
      {
        id: "o-2",
        order_number: "SO-2",
        customer_id: null,
        status: "confirmed",
        order_date: "2026-06-02",
        requested_date: "2026-06-05",
        scheduled_date: null,
        customers: null,
      },
    ]);
    setItems([
      {
        id: "oi-1",
        order_id: "o-1",
        brand_id: "b-1",
        selling_format_id: "sf-1",
        quantity: 10,
        style_id: null,
        tbd_notes: null,
        brands: { name: "Coastal Haze" },
        selling_formats: { name: "1/2 BBL Keg" },
        beer_styles: null,
      },
      {
        id: "oi-2",
        order_id: "o-2",
        brand_id: "b-1",
        selling_format_id: "sf-1",
        quantity: 15,
        style_id: null,
        tbd_notes: null,
        brands: { name: "Coastal Haze" },
        selling_formats: { name: "1/2 BBL Keg" },
        beer_styles: null,
      },
    ]);
    tableResults.set("finished_goods_with_availability", { data: [], error: null });

    const result = await getProductionRequirements();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      brand_id: "b-1",
      total_demand: 25,
      order_count: 2,
      order_numbers: ["SO-1", "SO-2"],
      earliest_requested_date: "2026-06-05",
      latest_requested_date: "2026-06-10",
    });
  });

  it("keys TBD items by style+package separately from branded items", async () => {
    setOrders([
      {
        id: "o-1",
        order_number: "SO-1",
        customer_id: null,
        status: "confirmed",
        order_date: "2026-06-01",
        requested_date: "2026-06-10",
        scheduled_date: null,
        customers: null,
      },
    ]);
    setItems([
      {
        id: "oi-1",
        order_id: "o-1",
        brand_id: null,
        selling_format_id: "sf-1",
        quantity: 8,
        style_id: "style-1",
        tbd_notes: null,
        brands: null,
        selling_formats: { name: "1/2 BBL Keg" },
        beer_styles: { name: "Hazy IPA" },
      },
    ]);
    tableResults.set("finished_goods_with_availability", { data: [], error: null });

    const result = await getProductionRequirements();

    expect(result).toHaveLength(1);
    expect(result[0].is_tbd).toBe(true);
    expect(result[0].style_id).toBe("style-1");
    expect(result[0].available_quantity).toBe(0);
  });

  it("applies finished-goods availability to non-TBD requirements and computes shortage", async () => {
    setOrders([
      {
        id: "o-1",
        order_number: "SO-1",
        customer_id: null,
        status: "confirmed",
        order_date: "2026-06-01",
        requested_date: "2026-06-10",
        scheduled_date: null,
        customers: null,
      },
    ]);
    setItems([
      {
        id: "oi-1",
        order_id: "o-1",
        brand_id: "b-1",
        selling_format_id: "sf-1",
        quantity: 20,
        style_id: null,
        tbd_notes: null,
        brands: { name: "Coastal Haze" },
        selling_formats: { name: "1/2 BBL Keg" },
        beer_styles: null,
      },
    ]);
    tableResults.set("finished_goods_with_availability", {
      data: [{ brand_id: "b-1", selling_format_id: "sf-1", available_quantity: 6 }],
      error: null,
    });

    const result = await getProductionRequirements();

    expect(result[0].available_quantity).toBe(6);
    expect(result[0].shortage).toBe(14);
  });

  it("clamps shortage at 0 when available quantity meets or exceeds demand", async () => {
    setOrders([
      {
        id: "o-1",
        order_number: "SO-1",
        customer_id: null,
        status: "confirmed",
        order_date: "2026-06-01",
        requested_date: "2026-06-10",
        scheduled_date: null,
        customers: null,
      },
    ]);
    setItems([
      {
        id: "oi-1",
        order_id: "o-1",
        brand_id: "b-1",
        selling_format_id: "sf-1",
        quantity: 5,
        style_id: null,
        tbd_notes: null,
        brands: { name: "Coastal Haze" },
        selling_formats: { name: "1/2 BBL Keg" },
        beer_styles: null,
      },
    ]);
    tableResults.set("finished_goods_with_availability", {
      data: [{ brand_id: "b-1", selling_format_id: "sf-1", available_quantity: 100 }],
      error: null,
    });

    const result = await getProductionRequirements();
    expect(result[0].shortage).toBe(0);
  });

  it("sorts by shortage descending, then by earliest requested date ascending", async () => {
    setOrders([
      {
        id: "o-1",
        order_number: "SO-1",
        customer_id: null,
        status: "confirmed",
        order_date: "2026-06-01",
        requested_date: "2026-06-20",
        scheduled_date: null,
        customers: null,
      },
      {
        id: "o-2",
        order_number: "SO-2",
        customer_id: null,
        status: "confirmed",
        order_date: "2026-06-01",
        requested_date: "2026-06-05",
        scheduled_date: null,
        customers: null,
      },
    ]);
    setItems([
      // Low shortage, earlier date
      {
        id: "oi-1",
        order_id: "o-2",
        brand_id: "b-low",
        selling_format_id: "sf-1",
        quantity: 5,
        style_id: null,
        tbd_notes: null,
        brands: { name: "Low Shortage Brand" },
        selling_formats: { name: "Keg" },
        beer_styles: null,
      },
      // High shortage, later date
      {
        id: "oi-2",
        order_id: "o-1",
        brand_id: "b-high",
        selling_format_id: "sf-2",
        quantity: 50,
        style_id: null,
        tbd_notes: null,
        brands: { name: "High Shortage Brand" },
        selling_formats: { name: "Keg" },
        beer_styles: null,
      },
    ]);
    tableResults.set("finished_goods_with_availability", { data: [], error: null });

    const result = await getProductionRequirements();

    expect(result.map((r) => r.brand_name)).toEqual([
      "High Shortage Brand",
      "Low Shortage Brand",
    ]);
  });

  it("logs and continues (available_quantity stays 0) when the inventory query errors", async () => {
    setOrders([
      {
        id: "o-1",
        order_number: "SO-1",
        customer_id: null,
        status: "confirmed",
        order_date: "2026-06-01",
        requested_date: "2026-06-10",
        scheduled_date: null,
        customers: null,
      },
    ]);
    setItems([
      {
        id: "oi-1",
        order_id: "o-1",
        brand_id: "b-1",
        selling_format_id: "sf-1",
        quantity: 20,
        style_id: null,
        tbd_notes: null,
        brands: { name: "Coastal Haze" },
        selling_formats: { name: "1/2 BBL Keg" },
        beer_styles: null,
      },
    ]);
    tableResults.set("finished_goods_with_availability", {
      data: null,
      error: new Error("inventory query failed"),
    });

    const result = await getProductionRequirements();

    expect(result[0].available_quantity).toBe(0);
    expect(result[0].shortage).toBe(20);
  });
});

// =============================================================================
// Async: getBackwardPlanningSummary
// =============================================================================

describe("getBackwardPlanningSummary", () => {
  it("returns all-zero summary when there is no demand", async () => {
    tableResults.set("orders", { data: [], error: null });

    const result = await getBackwardPlanningSummary();

    expect(result).toEqual({
      totalOrders: 0,
      totalLineItems: 0,
      tbdItems: 0,
      shortageCount: 0,
      totalDemandUnits: 0,
      totalAvailable: 0,
      totalShortage: 0,
    });
  });

  it("aggregates counts and totals across orders, TBD items, and shortages", async () => {
    tableResults.set("orders", {
      data: [
        {
          id: "o-1",
          order_number: "SO-1",
          customer_id: null,
          status: "confirmed",
          order_date: "2026-06-01",
          requested_date: "2026-06-10",
          scheduled_date: null,
          customers: null,
        },
      ],
      error: null,
    });
    tableResults.set("order_items", {
      data: [
        {
          id: "oi-1",
          order_id: "o-1",
          brand_id: "b-1",
          selling_format_id: "sf-1",
          quantity: 20,
          style_id: null,
          tbd_notes: null,
          brands: { name: "Coastal Haze" },
          selling_formats: { name: "1/2 BBL Keg" },
          beer_styles: null,
        },
        {
          id: "oi-2",
          order_id: "o-1",
          brand_id: null,
          selling_format_id: "sf-2",
          quantity: 3,
          style_id: "style-1",
          tbd_notes: null,
          brands: null,
          selling_formats: { name: "1/6 BBL Keg" },
          beer_styles: { name: "Hazy IPA" },
        },
      ],
      error: null,
    });
    tableResults.set("finished_goods_with_availability", {
      data: [{ brand_id: "b-1", selling_format_id: "sf-1", available_quantity: 5 }],
      error: null,
    });

    const result = await getBackwardPlanningSummary();

    expect(result).toEqual({
      totalOrders: 1,
      totalLineItems: 2,
      tbdItems: 1,
      // TBD items never get inventory applied (available_quantity stays 0),
      // so both the branded requirement (20-5=15) and the TBD requirement
      // (3-0=3) register a shortage.
      shortageCount: 2,
      totalDemandUnits: 23,
      totalAvailable: 5,
      totalShortage: 18, // (20-5) branded + (3-0) TBD
    });
  });
});
