import { describe, it, expect } from "vitest";
import {
  entityKeys,
  dynamicOptionsKeys,
  recipeKeys,
  batchKeys,
  orderKeys,
  inventoryKeys,
  customerKeys,
  userKeys,
  settingsKeys,
  reportKeys,
  dashboardKeys,
  notificationKeys,
  catalogKeys,
  supplierKeys,
  purchaseOrderKeys,
  yeastKeys,
  revisionKeys,
  planningKeys,
  purchasingKeys,
  pickListKeys,
  brandKeys,
  channelFormatKeys,
  kegKeys,
  brewLogKeys,
  sessionLineItemKeys,
  vesselKeys,
  packagingFormatKeys,
  stableKey,
} from "../query-keys";

// =============================================================================
// stableKey
// =============================================================================

describe("stableKey", () => {
  it("returns null and undefined unchanged", () => {
    expect(stableKey(null)).toBe(null);
    expect(stableKey(undefined)).toBe(undefined);
  });

  it("returns primitives unchanged", () => {
    expect(stableKey(1)).toBe(1);
    expect(stableKey("x")).toBe("x");
    expect(stableKey(true)).toBe(true);
  });

  it("sorts plain-object keys deterministically", () => {
    const a = stableKey({ b: 2, a: 1 });
    const b = stableKey({ a: 1, b: 2 });
    expect(Object.keys(a)).toEqual(["a", "b"]);
    expect(a).toEqual(b);
  });

  it("strips undefined properties", () => {
    expect(stableKey({ a: 1, b: undefined })).toEqual({ a: 1 });
    expect(stableKey({ a: 1 })).toEqual(stableKey({ a: 1, b: undefined }));
  });

  it("preserves array order (does not sort elements)", () => {
    expect(stableKey([10, 2, 1, 20])).toEqual([10, 2, 1, 20]);
    expect(stableKey(["b", "a"])).toEqual(["b", "a"]);
  });

  it("recurses into nested arrays and objects", () => {
    expect(stableKey({ b: { y: 2, x: 1 }, a: [{ q: 1, p: 2 }] })).toEqual({
      a: [{ p: 2, q: 1 }],
      b: { x: 1, y: 2 },
    });
  });

  it("does not collapse Date instances to {}", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    const out = stableKey({ asOfDate: d });
    expect(out.asOfDate).toBe(d);
  });

  it("preserves other class instances (Map, Set)", () => {
    const m = new Map([["k", "v"]]);
    const s = new Set([1, 2, 3]);
    expect(stableKey({ m, s })).toEqual({ m, s });
  });

  it("returns a new object reference for plain inputs", () => {
    const input = { a: 1, b: 2 };
    expect(stableKey(input)).not.toBe(input);
  });
});

// =============================================================================
// entityKeys
// =============================================================================

describe("entityKeys", () => {
  it("all() returns [table]", () => {
    expect(entityKeys.all("batches")).toEqual(["batches"]);
  });

  it("list() without filters returns [table, 'list']", () => {
    expect(entityKeys.list("batches")).toEqual(["batches", "list"]);
  });

  it("list() with filters includes filters object", () => {
    const filters = { status: "active" };
    expect(entityKeys.list("batches", filters)).toEqual([
      "batches",
      "list",
      filters,
    ]);
  });

  it("detail() returns [table, id]", () => {
    expect(entityKeys.detail("batches", "abc-123")).toEqual([
      "batches",
      "abc-123",
    ]);
  });

  it("related() returns [table, 'by', foreignKey, parentId]", () => {
    expect(entityKeys.related("logs", "batch_id", "abc-123")).toEqual([
      "logs",
      "by",
      "batch_id",
      "abc-123",
    ]);
  });

  it("different tables produce different keys", () => {
    expect(entityKeys.all("batches")).not.toEqual(entityKeys.all("recipes"));
  });

  it("different IDs produce different detail keys", () => {
    expect(entityKeys.detail("batches", "a")).not.toEqual(
      entityKeys.detail("batches", "b")
    );
  });

  it("same input produces identical keys", () => {
    const key1 = entityKeys.list("batches", { status: "active" });
    const key2 = entityKeys.list("batches", { status: "active" });
    expect(key1).toEqual(key2);
  });
});

// =============================================================================
// dynamicOptionsKeys
// =============================================================================

describe("dynamicOptionsKeys", () => {
  it("all() returns consistent key", () => {
    expect(dynamicOptionsKeys.all()).toEqual(["dynamic-options"]);
  });

  it("field() returns key with table and field", () => {
    expect(dynamicOptionsKeys.field("batches", "status")).toEqual([
      "dynamic-options",
      "batches",
      "status",
    ]);
  });
});

// =============================================================================
// recipeKeys
// =============================================================================

describe("recipeKeys", () => {
  it("all() returns ['recipes']", () => {
    expect(recipeKeys.all()).toEqual(["recipes"]);
  });

  it("list() without filters returns ['recipes', 'list']", () => {
    expect(recipeKeys.list()).toEqual(["recipes", "list"]);
  });

  it("list() with filters includes them", () => {
    expect(recipeKeys.list({ brand: "x" })).toEqual([
      "recipes",
      "list",
      { brand: "x" },
    ]);
  });

  it("detail() returns recipe detail key", () => {
    expect(recipeKeys.detail("r1")).toEqual(["recipes", "r1"]);
  });

  it("grainBill() returns nested key", () => {
    expect(recipeKeys.grainBill("r1")).toEqual([
      "recipes",
      "r1",
      "grain-bill",
    ]);
  });

  it("hopSchedule() returns nested key", () => {
    expect(recipeKeys.hopSchedule("r1")).toEqual([
      "recipes",
      "r1",
      "hop-schedule",
    ]);
  });

  it("sub-keys for same recipe are different", () => {
    expect(recipeKeys.grainBill("r1")).not.toEqual(
      recipeKeys.hopSchedule("r1")
    );
    expect(recipeKeys.estimates("r1")).not.toEqual(recipeKeys.summary("r1"));
  });
});

// =============================================================================
// batchKeys
// =============================================================================

describe("batchKeys", () => {
  it("all() returns ['batches']", () => {
    expect(batchKeys.all()).toEqual(["batches"]);
  });

  it("detail() returns batch detail key", () => {
    expect(batchKeys.detail("b1")).toEqual(["batches", "b1"]);
  });

  it("nextNumber() returns consistent key", () => {
    expect(batchKeys.nextNumber()).toEqual(["batches", "next-number"]);
  });

  it("logs and readings are different keys for same batch", () => {
    expect(batchKeys.logs("b1")).not.toEqual(batchKeys.readings("b1"));
  });
});

// =============================================================================
// dashboardKeys
// =============================================================================

describe("dashboardKeys", () => {
  it("all() returns ['dashboard']", () => {
    expect(dashboardKeys.all()).toEqual(["dashboard"]);
  });

  it("batchCounts returns consistent key", () => {
    expect(dashboardKeys.batchCounts()).toEqual(["dashboard", "batch-counts"]);
  });

  it("nested sales keys are unique", () => {
    expect(dashboardKeys.sales.orderCounts()).not.toEqual(
      dashboardKeys.sales.recentOrders()
    );
    expect(dashboardKeys.sales.customerRevenue()).not.toEqual(
      dashboardKeys.sales.productMix()
    );
  });

  it("sales keys include dashboard prefix", () => {
    expect(dashboardKeys.sales.orderCounts()[0]).toBe("dashboard");
    expect(dashboardKeys.sales.orderCounts()[1]).toBe("sales");
  });

  it("trends.production returns key with days", () => {
    expect(dashboardKeys.trends.production(7)).toEqual([
      "dashboard", "trends", "production", 7,
    ]);
  });

  it("trends.inventory returns key with days", () => {
    expect(dashboardKeys.trends.inventory(30)).toEqual([
      "dashboard", "trends", "inventory", 30,
    ]);
  });

  it("trends.sales returns key with days", () => {
    expect(dashboardKeys.trends.sales(90)).toEqual([
      "dashboard", "trends", "sales", 90,
    ]);
  });

  it("trends keys with different days are unique", () => {
    expect(dashboardKeys.trends.production(7)).not.toEqual(
      dashboardKeys.trends.production(30)
    );
  });
});

// =============================================================================
// Other key factories - consistency checks
// =============================================================================

describe("Key factory consistency", () => {
  it("orderKeys produces consistent keys", () => {
    expect(orderKeys.all()).toEqual(["orders"]);
    expect(orderKeys.detail("o1")).toEqual(["orders", "o1"]);
    expect(orderKeys.items("o1")).toEqual(["orders", "o1", "items"]);
  });

  it("inventoryKeys produces consistent keys", () => {
    expect(inventoryKeys.all()).toEqual(["inventory"]);
    expect(inventoryKeys.items()).toEqual(["inventory", "items"]);
  });

  it("customerKeys produces consistent keys", () => {
    expect(customerKeys.detail("c1")).toEqual(["customers", "c1"]);
    expect(customerKeys.orders("c1")).toEqual(["customers", "c1", "orders"]);
  });

  it("userKeys produces consistent keys", () => {
    expect(userKeys.current()).toEqual(["user", "current"]);
    expect(userKeys.preferences()).toEqual(["user", "preferences"]);
  });

  it("settingsKeys produces consistent keys", () => {
    expect(settingsKeys.all()).toEqual(["settings"]);
    expect(settingsKeys.enumValues("hop_type")).toEqual([
      "settings",
      "enums",
      "hop_type",
    ]);
  });

  it("reportKeys with and without period", () => {
    expect(reportKeys.ttb()).toEqual(["reports", "ttb"]);
    expect(reportKeys.ttb({ year: 2024, month: 6 })).toEqual([
      "reports",
      "ttb",
      { year: 2024, month: 6 },
    ]);
  });

  it("notificationKeys produces consistent keys", () => {
    expect(notificationKeys.all()).toEqual(["notifications"]);
    expect(notificationKeys.unread()).toEqual(["notifications", "unread"]);
  });

  it("catalogKeys produces consistent keys", () => {
    expect(catalogKeys.malts()).toEqual(["malts-catalog"]);
    expect(catalogKeys.hops()).toEqual(["hops-catalog"]);
    expect(catalogKeys.table("grains")).toEqual(["catalog", "grains"]);
  });

  it("supplierKeys produces consistent keys", () => {
    expect(supplierKeys.all()).toEqual(["suppliers"]);
    expect(supplierKeys.active()).toEqual(["suppliers", "active"]);
  });

  it("purchaseOrderKeys produces consistent keys", () => {
    expect(purchaseOrderKeys.all()).toEqual(["purchase-orders"]);
    expect(purchaseOrderKeys.detail("po1")).toEqual(["purchase-order", "po1"]);
  });

  it("yeastKeys produces consistent keys", () => {
    expect(yeastKeys.all()).toEqual(["yeast-pitches"]);
    expect(yeastKeys.detail("y1")).toEqual(["yeast-pitches", "y1"]);
  });

  it("revisionKeys produces consistent keys", () => {
    expect(revisionKeys.all()).toEqual(["entity_revisions"]);
    expect(revisionKeys.forEntity("batch", "b1")).toEqual([
      "entity_revisions",
      "batch",
      "b1",
    ]);
    expect(revisionKeys.fkResolve("customers", ["c1", "c2"])).toEqual([
      "fk-resolve",
      "customers",
      "c1,c2",
    ]);
  });

  it("planningKeys with and without options", () => {
    expect(planningKeys.shortfalls()).toEqual(["planning", "shortfalls"]);
    expect(planningKeys.shortfalls({ horizonWeeks: 4 })).toEqual([
      "planning",
      "shortfalls",
      { horizonWeeks: 4 },
    ]);
  });

  it("purchasingKeys with and without options", () => {
    expect(purchasingKeys.ingredientDemand()).toEqual([
      "purchasing",
      "ingredient-demand",
    ]);
    expect(purchasingKeys.ingredientDemand({ horizonWeeks: 8 })).toEqual([
      "purchasing",
      "ingredient-demand",
      { horizonWeeks: 8 },
    ]);
  });

  it("pickListKeys produces consistent keys", () => {
    expect(pickListKeys.all()).toEqual(["pick-lists"]);
    expect(pickListKeys.list()).toEqual(["pick-lists", "list"]);
    expect(pickListKeys.list({ status: "draft" })).toEqual([
      "pick-lists",
      "list",
      { status: "draft" },
    ]);
    expect(pickListKeys.detail("pl1")).toEqual(["pick-lists", "pl1"]);
    expect(pickListKeys.items("pl1")).toEqual(["pick-lists", "pl1", "items"]);
    expect(pickListKeys.forOrder("o1")).toEqual([
      "pick-lists",
      "for-order",
      "o1",
    ]);
  });

  it("pickListKeys detail and items are distinct", () => {
    expect(pickListKeys.detail("pl1")).not.toEqual(pickListKeys.items("pl1"));
  });

  it("catalogKeys spices/sugars/additives produce consistent keys", () => {
    expect(catalogKeys.spices()).toEqual(["spices-catalog"]);
    expect(catalogKeys.sugars()).toEqual(["sugars-catalog"]);
    expect(catalogKeys.additives()).toEqual(["additives-catalog"]);
  });

  it("recipeKeys styleCompliance/suggestions/cogs/fermentationAdditions", () => {
    expect(recipeKeys.styleCompliance("r1")).toEqual([
      "recipe-style-compliance",
      "r1",
    ]);
    expect(recipeKeys.suggestions("r1")).toEqual(["recipe-suggestions", "r1"]);
    expect(recipeKeys.cogs("r1")).toEqual(["recipe-cogs", "r1"]);
    expect(recipeKeys.fermentationAdditions("r1")).toEqual([
      "recipe-fermentation-additions",
      "r1",
    ]);
  });

  it("batchKeys additions/performance/brewLogs/availableBrewLogs", () => {
    expect(batchKeys.additions("b1")).toEqual(["batch-additions", "b1"]);
    expect(batchKeys.performance("b1")).toEqual(["batch-performance", "b1"]);
    expect(batchKeys.brewLogs("b1")).toEqual(["batch-brew-logs", "b1"]);
    expect(batchKeys.availableBrewLogs("b1")).toEqual([
      "available-brew-logs",
      "b1",
    ]);
  });

  it("orderKeys allocations and pickList", () => {
    expect(orderKeys.allocations("o1")).toEqual(["order-allocations", "o1"]);
    expect(orderKeys.pickList("o1")).toEqual(["order-pick-list", "o1"]);
    expect(orderKeys.pickList("o1", "items")).toEqual([
      "order-pick-list",
      "o1",
      "items",
    ]);
  });

  it("inventoryKeys overview/finishedGoods/finishedGoodsAvailable", () => {
    expect(inventoryKeys.overview()).toEqual(["inventory-overview"]);
    expect(inventoryKeys.finishedGoods()).toEqual(["finished-goods"]);
    expect(inventoryKeys.finishedGoodsAvailable()).toEqual([
      "finished-goods-available",
    ]);
  });

  it("userKeys units and full", () => {
    expect(userKeys.units()).toEqual(["user", "preferences", "units"]);
    expect(userKeys.full()).toEqual(["user", "preferences", "full"]);
  });

  it("settingsKeys systemSettings/pricingChannels/notificationPreferences", () => {
    expect(settingsKeys.systemSettings()).toEqual(["system-settings"]);
    expect(settingsKeys.pricingChannels()).toEqual(["pricing-channels"]);
    expect(settingsKeys.notificationPreferences()).toEqual([
      "notification-preferences",
    ]);
  });

  it("reportKeys ttbBatches", () => {
    expect(reportKeys.ttbBatches(2024, 6)).toEqual(["ttb-batches", 2024, 6]);
  });
});

// =============================================================================
// brandKeys
// =============================================================================

describe("brandKeys", () => {
  it("all() returns ['brands']", () => {
    expect(brandKeys.all()).toEqual(["brands"]);
  });

  it("list() without filters returns ['brands', 'list']", () => {
    expect(brandKeys.list()).toEqual(["brands", "list"]);
  });

  it("list() with filters includes them", () => {
    expect(brandKeys.list({ active: true })).toEqual([
      "brands",
      "list",
      { active: true },
    ]);
  });
});

// =============================================================================
// channelFormatKeys
// =============================================================================

describe("channelFormatKeys", () => {
  it("all() returns ['channel-formats']", () => {
    expect(channelFormatKeys.all()).toEqual(["channel-formats"]);
  });

  it("byChannel() returns key with channelId", () => {
    expect(channelFormatKeys.byChannel("ch1")).toEqual([
      "channel-formats",
      "by-channel",
      "ch1",
    ]);
  });

  it("byFormat() returns key with formatId", () => {
    expect(channelFormatKeys.byFormat("sf1")).toEqual([
      "channel-formats",
      "by-format",
      "sf1",
    ]);
  });
});

// =============================================================================
// kegKeys
// =============================================================================

describe("kegKeys", () => {
  it("fleetSummary() returns consistent key", () => {
    expect(kegKeys.fleetSummary()).toEqual(["keg_fleet_summary"]);
  });

  it("turnoverMetrics() returns consistent key", () => {
    expect(kegKeys.turnoverMetrics()).toEqual(["keg_turnover_metrics"]);
  });

  it("agingReport() returns consistent key", () => {
    expect(kegKeys.agingReport()).toEqual(["keg_aging_report"]);
  });

  it("customerBalances() without customerId", () => {
    expect(kegKeys.customerBalances()).toEqual(["customer_keg_balances"]);
  });

  it("customerBalances() with customerId", () => {
    expect(kegKeys.customerBalances("c1")).toEqual([
      "customer_keg_balances",
      "c1",
    ]);
  });

  it("ownerDeposits() returns key with ownerId", () => {
    expect(kegKeys.ownerDeposits("ko1")).toEqual([
      "keg_owner_deposits",
      "ko1",
    ]);
  });
});

// =============================================================================
// brewLogKeys
// =============================================================================

describe("brewLogKeys", () => {
  it("all() returns ['brew_logs']", () => {
    expect(brewLogKeys.all()).toEqual(["brew_logs"]);
  });

  it("detail() returns brew log detail key", () => {
    expect(brewLogKeys.detail("bl1")).toEqual(["brew_logs", "bl1"]);
  });

  it("batches() returns brew log batches key", () => {
    expect(brewLogKeys.batches("bl1")).toEqual(["brew_log_batches", "bl1"]);
  });
});

// =============================================================================
// sessionLineItemKeys
// =============================================================================

describe("sessionLineItemKeys", () => {
  it("all() returns key with sessionId", () => {
    expect(sessionLineItemKeys.all("s1")).toEqual(["session-line-items", "s1"]);
  });
});

// =============================================================================
// vesselKeys
// =============================================================================

describe("vesselKeys", () => {
  it("all() returns ['vessels']", () => {
    expect(vesselKeys.all()).toEqual(["vessels"]);
  });

  it("available() returns ['vessels', 'available']", () => {
    expect(vesselKeys.available()).toEqual(["vessels", "available"]);
  });

  it("transfers() returns ['vessel_transfers']", () => {
    expect(vesselKeys.transfers()).toEqual(["vessel_transfers"]);
  });
});

// =============================================================================
// packagingFormatKeys
// =============================================================================

describe("packagingFormatKeys", () => {
  it("all() returns ['packaging-formats']", () => {
    expect(packagingFormatKeys.all()).toEqual(["packaging-formats"]);
  });

  it("kegFormats() returns ['packaging-formats', 'keg']", () => {
    expect(packagingFormatKeys.kegFormats()).toEqual([
      "packaging-formats",
      "keg",
    ]);
  });
});
