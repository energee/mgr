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
} from "../query-keys";

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
});
