/**
 * Characterization tests for the chat assistant's search/lookup tools.
 *
 * These pin the two things the model (and therefore the user) can actually
 * observe about a tool: the **argument shape** it advertises (`inputSchema`,
 * including defaults) and the **result shape** it returns — plus the exact
 * PostgREST query each tool builds, because that is what determines the
 * result.
 *
 * They were written *before* the `buildSearchTool` consolidation so that the
 * refactor has something to be measured against. If one of these has to be
 * edited to make a refactor pass, the refactor changed behaviour.
 */

import { describe, expect, it, vi } from "vitest";
import { makeSupabase } from "@/test/supabase-mock";

// tools.ts pulls in the entity core registry, which imports the browser
// Supabase client (and its env validation) at module load. Stub it so the
// suite runs without NEXT_PUBLIC_* env (same as record-reading-tool.test.ts).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ data: [], error: null }) }),
  }),
}));

import { createChatTools } from "../tools";

// The `ai` package types `execute` loosely; cast to call it directly.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyTools = Record<string, any>;

/** Parse `input` through the tool's advertised schema, then run it. */
function run(tools: AnyTools, name: string, input: Record<string, unknown>) {
  const args = tools[name].inputSchema.parse(input);
  return tools[name].execute(args, { toolCallId: "t1", messages: [] });
}

/** The recorded calls for one chain method on the n-th builder for a table. */
function calls(sb: { callsByTable: Record<string, any[]> }, table: string, method: string, index = 0) {
  return sb.callsByTable[table][index][method].mock.calls;
}

/** A client that answers one query for `table` with `rows`. */
function withRows(table: string, rows: unknown) {
  return makeSupabase({ [table]: [{ data: rows, error: null }] });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ===========================================================================
// Single-table filtered search tools
//
// Each entry is the observable contract of one tool: what `inputSchema.parse`
// fills in for an empty call, which table/select/order/limit the tool always
// applies, and how each optional argument turns into a PostgREST predicate.
// ===========================================================================

type ToolCase = {
  tool: string;
  table: string;
  select: string;
  /** What `inputSchema.parse({})` returns — the defaults the model sees. */
  defaults: Record<string, unknown>;
  /** Exact args of the `.order()` call. */
  order: unknown[];
  /** Exact args of the `.limit()` call for a default (no-arg) invocation. */
  limit: unknown[];
  /** Predicates applied even when no optional argument is supplied. */
  baseCalls?: Record<string, unknown[][]>;
  /** A fully-populated invocation and the predicates it must produce. */
  filtered: {
    args: Record<string, unknown>;
    select?: string;
    expect: Record<string, unknown[][]>;
  };
};

const CASES: ToolCase[] = [
  {
    tool: "getFinishedGoods",
    table: "finished_goods_with_availability",
    select:
      "id, lot_number, brand_name, selling_format_name, total_quantity, allocated_quantity, reserved_quantity, available_quantity, production_date, best_by_date",
    defaults: { limit: 20 },
    order: ["brand_name"],
    limit: [20],
    baseCalls: { gt: [["available_quantity", 0]] },
    filtered: {
      args: {
        brandId: "11111111-1111-4111-8111-111111111111",
        query: "Haz%y",
        limit: 5,
      },
      expect: {
        eq: [["brand_id", "11111111-1111-4111-8111-111111111111"]],
        ilike: [["brand_name", "%Haz\\%y%"]],
        limit: [[5]],
      },
    },
  },
  {
    tool: "searchOrders",
    table: "orders",
    select:
      "id, order_number, status, order_date, requested_date, scheduled_date, notes, customer:customers(id, name)",
    defaults: { limit: 20 },
    order: ["order_date", { ascending: false }],
    limit: [20],
    filtered: {
      args: {
        status: "confirmed",
        customerName: "Acme",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
        limit: 5,
      },
      // A customer-name filter switches the embed to an INNER join so the
      // predicate actually restricts the parent rows.
      select:
        "id, order_number, status, order_date, requested_date, scheduled_date, notes, customer:customers!inner(id, name)",
      expect: {
        eq: [["status", "confirmed"]],
        gte: [["order_date", "2026-01-01"]],
        lte: [["order_date", "2026-02-01"]],
        ilike: [["customers.name", "%Acme%"]],
      },
    },
  },
  {
    tool: "getCustomers",
    table: "customers_with_order_summary",
    select:
      "id, name, customer_type, contact_name, email, phone, total_orders, total_revenue, pending_orders, last_order_date",
    defaults: { limit: 20 },
    order: ["name"],
    limit: [20],
    baseCalls: { eq: [["is_active", true]] },
    filtered: {
      args: { query: "Acme", limit: 3 },
      expect: {
        eq: [["is_active", true]],
        ilike: [["name", "%Acme%"]],
        limit: [[3]],
      },
    },
  },
  {
    tool: "searchBrewLogs",
    table: "brew_logs",
    select: "id, brew_number, brew_date, status, notes, recipe:recipes(id, name)",
    defaults: { limit: 20 },
    order: ["brew_date", { ascending: false }],
    limit: [20],
    filtered: {
      args: {
        status: "completed",
        brewNumber: "BR-1",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
      },
      expect: {
        eq: [["status", "completed"]],
        ilike: [["brew_number", "%BR-1%"]],
        gte: [["brew_date", "2026-01-01"]],
        lte: [["brew_date", "2026-02-01"]],
      },
    },
  },
  {
    tool: "searchPurchaseOrders",
    table: "purchase_orders",
    select:
      "id, po_number, status, order_date, expected_date, shipping_cost, tax, notes, supplier:suppliers(id, name)",
    defaults: { limit: 20 },
    order: ["order_date", { ascending: false }],
    limit: [20],
    filtered: {
      args: {
        status: "submitted",
        supplierName: "Country Malt",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
      },
      select:
        "id, po_number, status, order_date, expected_date, shipping_cost, tax, notes, supplier:suppliers!inner(id, name)",
      expect: {
        eq: [["status", "submitted"]],
        gte: [["order_date", "2026-01-01"]],
        lte: [["order_date", "2026-02-01"]],
        ilike: [["suppliers.name", "%Country Malt%"]],
      },
    },
  },
  {
    tool: "searchSuppliers",
    table: "suppliers",
    select:
      "id, name, contact_name, contact_email, contact_phone, payment_terms, default_lead_time_days, is_active",
    // `isActive` defaults to true, so the no-arg call is still filtered.
    defaults: { isActive: true, limit: 20 },
    order: ["name"],
    limit: [20],
    baseCalls: { eq: [["is_active", true]] },
    filtered: {
      args: { query: "Malt", isActive: false, limit: 7 },
      expect: {
        eq: [["is_active", false]],
        ilike: [["name", "%Malt%"]],
        limit: [[7]],
      },
    },
  },
  {
    tool: "searchPickLists",
    table: "pick_list_details",
    select:
      "id, status, generated_at, order_id, order_number, customer_name, total_items, items_picked, assigned_to_name",
    defaults: { limit: 20 },
    order: ["generated_at", { ascending: false }],
    limit: [20],
    filtered: {
      args: {
        status: "pending",
        startDate: "2026-01-01",
        endDate: "2026-02-01",
        customerName: "Acme",
      },
      expect: {
        eq: [["status", "pending"]],
        gte: [["generated_at", "2026-01-01"]],
        lte: [["generated_at", "2026-02-01"]],
        ilike: [["customer_name", "%Acme%"]],
      },
    },
  },
  {
    tool: "getKegInventory",
    table: "keg_inventory_with_details",
    select:
      "id, keg_type_name, volume_bbl, keg_owner_name, state, location_name, quantity",
    // Keg inventory is the one search tool whose default limit is not 20.
    defaults: { limit: 50 },
    order: ["keg_type_name"],
    limit: [50],
    filtered: {
      args: {
        state: "filled",
        kegTypeName: "1/2 bbl",
        locationName: "Taproom",
        limit: 10,
      },
      expect: {
        eq: [["state", "filled"]],
        ilike: [
          ["keg_type_name", "%1/2 bbl%"],
          ["location_name", "%Taproom%"],
        ],
        limit: [[10]],
      },
    },
  },
];

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

describe.each(CASES)("$tool", (c) => {
  it("advertises its argument defaults", () => {
    const tools = createChatTools(withRows(c.table, []).supabase) as AnyTools;
    expect(tools[c.tool].inputSchema.parse({})).toEqual(c.defaults);
    expect(typeof tools[c.tool].description).toBe("string");
  });

  it("queries its table with a fixed select, order and limit", async () => {
    const sb = withRows(c.table, [{ id: "row-1" }]);
    const tools = createChatTools(sb.supabase) as AnyTools;

    const result = await run(tools, c.tool, {});

    expect(sb.fromSpy).toHaveBeenCalledWith(c.table);
    expect(calls(sb, c.table, "select")).toEqual([[c.select]]);
    expect(calls(sb, c.table, "order")).toEqual([c.order]);
    expect(calls(sb, c.table, "limit")).toEqual([c.limit]);
    for (const [method, expected] of Object.entries(c.baseCalls ?? {})) {
      expect(calls(sb, c.table, method)).toEqual(expected);
    }
    // Rows are returned as-is: no reshaping between PostgREST and the model.
    expect(result).toEqual([{ id: "row-1" }]);
  });

  it("ignores empty-string arguments, as the hand-written tools did", async () => {
    // Models routinely emit "" for an optional string. Every tool this factory
    // replaced guarded on truthiness, so "" meant "no filter"; an
    // undefined-only guard would instead emit eq(status, "") — which raises
    // 22P02 against the enum and date columns these tools filter on, turning a
    // full list into a thrown error. Asserting the predicates are ABSENT is
    // the point: the rest of this suite passes either way.
    const sb = withRows(c.table, []);
    const tools = createChatTools(sb.supabase) as AnyTools;

    // uuid-validated params (brandId) are excluded: their schema rejects ""
    // before the query is ever built, so they cannot reach the guard.
    const blanked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(c.filtered.args)) {
      if (typeof value === "string" && !UUID_RE.test(value)) blanked[key] = "";
    }
    await run(tools, c.tool, blanked);

    // Only the base filters the tool always applies may appear.
    for (const method of ["eq", "ilike", "gte", "lte"]) {
      expect(calls(sb, c.table, method)).toEqual(c.baseCalls?.[method] ?? []);
    }
    // A blanked embed filter must not flip the select to an inner join either.
    expect(calls(sb, c.table, "select")).toEqual([[c.select]]);
  });

  it("turns each optional argument into a predicate", async () => {
    const sb = withRows(c.table, []);
    const tools = createChatTools(sb.supabase) as AnyTools;

    await run(tools, c.tool, c.filtered.args);

    expect(calls(sb, c.table, "select")).toEqual([[c.filtered.select ?? c.select]]);
    for (const [method, expected] of Object.entries(c.filtered.expect)) {
      expect(calls(sb, c.table, method)).toEqual(expected);
    }
  });

  it("throws the PostgREST message when the query fails", async () => {
    const sb = makeSupabase({
      [c.table]: [{ data: null, error: { message: "boom" } }],
    });
    const tools = createChatTools(sb.supabase) as AnyTools;

    await expect(run(tools, c.tool, {})).rejects.toThrow("boom");
  });
});

// ===========================================================================
// searchYeastPitches — the one search tool with a second query and a derived
// field. The view predates `yeasts.recommended_max_generations`, so the tool
// fetches it per strain and annotates each row.
// ===========================================================================

const PITCH_VIEW = "yeast_pitches_with_remaining";
const STRAIN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("searchYeastPitches", () => {
  it("advertises its argument defaults", () => {
    const sb = makeSupabase({ [PITCH_VIEW]: [{ data: [], error: null }] });
    const tools = createChatTools(sb.supabase) as AnyTools;
    expect(tools.searchYeastPitches.inputSchema.parse({})).toEqual({ limit: 20 });
  });

  it("queries the remaining-viability view with a fixed select, order and limit", async () => {
    const sb = makeSupabase({ [PITCH_VIEW]: [{ data: [], error: null }] });
    const tools = createChatTools(sb.supabase) as AnyTools;

    const result = await run(tools, "searchYeastPitches", {});

    expect(calls(sb, PITCH_VIEW, "select")).toEqual([
      [
        "id, status, source_type, generation, initial_viability, estimated_viability, viability_status, days_old, strain_id, strain_name, strain_code, strain_manufacturer, vessel_name, location_name",
      ],
    ]);
    expect(calls(sb, PITCH_VIEW, "order")).toEqual([
      ["created_at", { ascending: false }],
    ]);
    expect(calls(sb, PITCH_VIEW, "limit")).toEqual([[20]]);
    // No strains to look up ⇒ no second query.
    expect(sb.fromSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it("turns each optional argument into a predicate", async () => {
    const sb = makeSupabase({ [PITCH_VIEW]: [{ data: [], error: null }] });
    const tools = createChatTools(sb.supabase) as AnyTools;

    await run(tools, "searchYeastPitches", {
      status: "available",
      strainName: "US-05",
      limit: 4,
    });

    expect(calls(sb, PITCH_VIEW, "eq")).toEqual([["status", "available"]]);
    expect(calls(sb, PITCH_VIEW, "ilike")).toEqual([["strain_name", "%US-05%"]]);
    expect(calls(sb, PITCH_VIEW, "limit")).toEqual([[4]]);
  });

  it("annotates each row with the strain's recommended generation limit", async () => {
    const sb = makeSupabase({
      [PITCH_VIEW]: [
        {
          data: [
            { id: "p1", strain_id: STRAIN_A, generation: 5 },
            { id: "p2", strain_id: STRAIN_A, generation: 2 },
            { id: "p3", strain_id: null, generation: 9 },
          ],
          error: null,
        },
      ],
      yeasts: [
        {
          data: [{ id: STRAIN_A, recommended_max_generations: 5 }],
          error: null,
        },
      ],
    });
    const tools = createChatTools(sb.supabase) as AnyTools;

    const rows = await run(tools, "searchYeastPitches", {});

    expect(calls(sb, "yeasts", "in")).toEqual([["id", [STRAIN_A]]]);
    expect(rows).toEqual([
      {
        id: "p1",
        strain_id: STRAIN_A,
        generation: 5,
        recommended_max_generations: 5,
        // At the limit counts as over — the flag is `>=`.
        over_recommended_generation: true,
      },
      {
        id: "p2",
        strain_id: STRAIN_A,
        generation: 2,
        recommended_max_generations: 5,
        over_recommended_generation: false,
      },
      {
        id: "p3",
        strain_id: null,
        generation: 9,
        recommended_max_generations: null,
        over_recommended_generation: false,
      },
    ]);
  });

  it("throws the PostgREST message when the view query fails", async () => {
    const sb = makeSupabase({
      [PITCH_VIEW]: [{ data: null, error: { message: "view boom" } }],
    });
    const tools = createChatTools(sb.supabase) as AnyTools;

    await expect(run(tools, "searchYeastPitches", {})).rejects.toThrow("view boom");
  });
});

// ===========================================================================
// lookupEntity — name/number → UUID resolution across five tables.
// ===========================================================================

describe("lookupEntity", () => {
  it("advertises no defaults", () => {
    const sb = makeSupabase({});
    const tools = createChatTools(sb.supabase) as AnyTools;
    expect(tools.lookupEntity.inputSchema.parse({ query: "x" })).toEqual({
      query: "x",
    });
    expect(() => tools.lookupEntity.inputSchema.parse({ query: "x", entityType: "vessel" })).toThrow();
  });

  it("searches all five tables and returns typed display rows", async () => {
    const sb = makeSupabase({
      // batches is queried twice: by code, then by name.
      batches: [
        { data: [{ id: "b1", batch_code: "B-1", name: "Hazy" }], error: null },
        { data: [{ id: "b2", batch_code: "B-2", name: null }], error: null },
      ],
      recipes: [{ data: [{ id: "r1", name: "Hazy IPA" }], error: null }],
      customers: [{ data: [{ id: "c1", name: "Acme" }], error: null }],
      brands: [{ data: [{ id: "br1", name: "Hazy" }], error: null }],
      orders: [{ data: [{ id: "o1", order_number: "SO-1" }], error: null }],
    });
    const tools = createChatTools(sb.supabase) as AnyTools;

    const results = await run(tools, "lookupEntity", { query: "Hazy" });

    expect(results).toEqual([
      { type: "batch", id: "b1", display: "B-1 — Hazy" },
      // No name ⇒ no em-dash suffix.
      { type: "batch", id: "b2", display: "B-2" },
      { type: "recipe", id: "r1", display: "Hazy IPA" },
      { type: "customer", id: "c1", display: "Acme" },
      { type: "brand", id: "br1", display: "Hazy" },
      { type: "order", id: "o1", display: "SO-1" },
    ]);
    // Only active customers are offered.
    expect(calls(sb, "customers", "eq")).toEqual([["is_active", true]]);
    expect(calls(sb, "recipes", "ilike")).toEqual([["name", "%Hazy%"]]);
    expect(calls(sb, "recipes", "limit")).toEqual([[5]]);
    expect(calls(sb, "orders", "ilike")).toEqual([["order_number", "%Hazy%"]]);
    expect(calls(sb, "batches", "ilike", 0)).toEqual([["batch_code", "%Hazy%"]]);
    expect(calls(sb, "batches", "ilike", 1)).toEqual([["name", "%Hazy%"]]);
  });

  it("narrows to a single table when entityType is given", async () => {
    const sb = makeSupabase({
      recipes: [{ data: [{ id: "r1", name: "Hazy IPA" }], error: null }],
    });
    const tools = createChatTools(sb.supabase) as AnyTools;

    const results = await run(tools, "lookupEntity", {
      query: "Hazy",
      entityType: "recipe",
    });

    expect(results).toEqual([{ type: "recipe", id: "r1", display: "Hazy IPA" }]);
    expect(sb.fromSpy).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates a batch matched by both code and name, capped at five", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `n${i}`,
      batch_code: `N-${i}`,
      name: null,
    }));
    const sb = makeSupabase({
      batches: [
        { data: [{ id: "b1", batch_code: "B-1", name: "Hazy" }], error: null },
        {
          data: [{ id: "b1", batch_code: "B-1", name: "Hazy" }, ...many],
          error: null,
        },
      ],
    });
    const tools = createChatTools(sb.supabase) as AnyTools;

    const results = await run(tools, "lookupEntity", {
      query: "Hazy",
      entityType: "batch",
    });

    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ type: "batch", id: "b1", display: "B-1 — Hazy" });
    expect(results.map((r: { id: string }) => r.id)).toEqual([
      "b1",
      "n0",
      "n1",
      "n2",
      "n3",
    ]);
  });

  it("escapes wildcard characters in the search term", async () => {
    const sb = makeSupabase({
      recipes: [{ data: [], error: null }],
    });
    const tools = createChatTools(sb.supabase) as AnyTools;

    await run(tools, "lookupEntity", { query: "50%_off", entityType: "recipe" });

    expect(calls(sb, "recipes", "ilike")).toEqual([["name", "%50\\%\\_off%"]]);
  });
});
