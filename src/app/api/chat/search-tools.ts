/**
 * Chat search tools — one factory, many tools.
 *
 * Nine of the chat assistant's read tools were the same tool written nine
 * times: pick a table or view, `select` a fixed column list, apply an
 * `order` and a `limit`, then translate a handful of optional arguments into
 * `eq` / `ilike` / `gte` / `lte` predicates. `buildSearchTool` is that shape
 * expressed once; each tool is now a `SearchToolConfig` describing only what
 * is genuinely different about it.
 *
 * What the config can still vary:
 * - **`baseFilters`** — predicates applied on every call (e.g. only active
 *   customers, only finished goods with stock left).
 * - **`select` as a function** — PostgREST embeds default to a LEFT join, so
 *   a filter on an embedded column only restricts the parent rows if the
 *   embed is switched to `!inner`. Orders and purchase orders do that when
 *   the caller filters by customer/supplier name.
 * - **`postProcess`** — a second query and a derived field, which only
 *   `searchYeastPitches` needs.
 *
 * Every table goes through `dynamicFrom`, because several of these are views
 * that are not in the generated `Database` types; the column lists in
 * `select` are the contract instead. Behaviour is pinned by
 * `__tests__/search-tools.test.ts`, written before this factory existed.
 */

import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { dynamicFrom, type DynamicQueryBuilder } from "@/services/types";
import { escapeIlikePattern } from "@/lib/supabase/query-helpers";

/** PostgREST predicate an optional search argument maps to. */
export type SearchPredicate = "eq" | "ilike" | "gte" | "lte";

/**
 * One optional search argument: the Zod schema the model sees, and the
 * column/predicate it becomes when supplied. `ilike` arguments are wrapped as
 * a `%…%` substring match with LIKE metacharacters escaped.
 */
export type SearchParam = {
  op: SearchPredicate;
  column: string;
  schema: z.ZodTypeAny;
};

/** Arguments a tool was called with, minus `limit`. */
export type SearchArgs = Record<string, unknown>;

export type SearchToolConfig = {
  /** Tool description shown to the model. */
  description: string;
  /** Table or view to query. */
  table: string;
  /** Column list, or a function of the supplied arguments (see module doc). */
  select: string | ((args: SearchArgs) => string);
  /** Predicates applied on every call, before the caller's arguments. */
  baseFilters?: ReadonlyArray<readonly [op: "eq" | "gt", column: string, value: unknown]>;
  /** Optional arguments, in the order they appear in the tool's schema. */
  params: Record<string, SearchParam>;
  /** Sort column. Omitting `ascending` leaves it to PostgREST's default. */
  order: { column: string; ascending?: boolean };
  /** Default (and advertised) row cap. */
  limit: number;
  /** Optional post-query enrichment, e.g. a lookup the view cannot provide. */
  postProcess?: (
    rows: Record<string, unknown>[],
    supabase: SupabaseClient<Database>,
  ) => Promise<unknown>;
};

/** Build one search tool bound to an authenticated Supabase client. */
export function buildSearchTool(
  config: SearchToolConfig,
  supabase: SupabaseClient<Database>,
) {
  // Built as a mutable record: zod v4's `ZodRawShape` is readonly.
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, param] of Object.entries(config.params)) {
    shape[name] = param.schema;
  }
  shape.limit = z.number().optional().default(config.limit).describe("Max results");

  return tool({
    description: config.description,
    inputSchema: z.object(shape),
    execute: async (args: SearchArgs) => {
      const limit = args.limit as number;

      let q: DynamicQueryBuilder = dynamicFrom(supabase, config.table).select(
        typeof config.select === "function" ? config.select(args) : config.select,
      );

      for (const [op, column, value] of config.baseFilters ?? []) {
        q = op === "gt" ? q.gt(column, value) : q.eq(column, value);
      }

      q =
        config.order.ascending === undefined
          ? q.order(config.order.column)
          : q.order(config.order.column, { ascending: config.order.ascending });
      q = q.limit(limit);

      for (const [name, param] of Object.entries(config.params)) {
        const value = args[name];
        if (value === undefined) continue;
        q =
          param.op === "ilike"
            ? q.ilike(param.column, `%${escapeIlikePattern(String(value))}%`)
            : q[param.op](param.column, value);
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return config.postProcess
        ? config.postProcess((data ?? []) as Record<string, unknown>[], supabase)
        : data;
    },
  });
}

// ===========================================================================
// Shared argument schemas
// ===========================================================================

const optionalString = (description: string) =>
  z.string().optional().describe(description);

const statusParam = (description: string): SearchParam => ({
  op: "eq",
  column: "status",
  schema: optionalString(description),
});

/** `column` between two ISO dates, as a pair of `gte` / `lte` arguments. */
const dateRangeParams = (
  column: string,
  label: string,
): Record<string, SearchParam> => ({
  startDate: {
    op: "gte",
    column,
    schema: optionalString(`${label} start (YYYY-MM-DD)`),
  },
  endDate: {
    op: "lte",
    column,
    schema: optionalString(`${label} end (YYYY-MM-DD)`),
  },
});

// ===========================================================================
// Post-processing
// ===========================================================================

/**
 * Annotate yeast pitches with their strain's recommended repitch limit.
 *
 * `yeast_pitches_with_remaining` predates `yeasts.recommended_max_generations`
 * (migration 00176) and does not expose it, so it is fetched per strain and
 * folded in as `recommended_max_generations` plus an
 * `over_recommended_generation` flag for spotting tired yeast.
 */
async function annotateYeastGenerations(
  rows: Record<string, unknown>[],
  supabase: SupabaseClient<Database>,
) {
  const strainIds = [
    ...new Set(
      rows
        .map((r) => r.strain_id as string | null)
        .filter((id): id is string => id != null),
    ),
  ];

  const maxGenByStrain = new Map<string, number | null>();
  if (strainIds.length > 0) {
    const { data: strains, error } = await supabase
      .from("yeasts")
      .select("id, recommended_max_generations")
      .in("id", strainIds);
    if (error) throw new Error(error.message);
    for (const s of strains ?? []) {
      maxGenByStrain.set(s.id, s.recommended_max_generations);
    }
  }

  return rows.map((r) => {
    const strainId = r.strain_id as string | null;
    const generation = r.generation as number | null;
    const maxGen = strainId ? (maxGenByStrain.get(strainId) ?? null) : null;
    return {
      ...r,
      recommended_max_generations: maxGen,
      over_recommended_generation:
        maxGen != null && generation != null && generation >= maxGen,
    };
  });
}

// ===========================================================================
// Tool definitions
// ===========================================================================

/**
 * Every config-driven search tool, keyed by the tool name the model calls.
 * These names are user-visible: `src/components/domain/shared/chat-panel.tsx`
 * maps them to display labels.
 */
export const SEARCH_TOOL_CONFIGS: Record<string, SearchToolConfig> = {
  getFinishedGoods: {
    description:
      "Get finished goods inventory with availability. Filter by brand or selling format.",
    table: "finished_goods_with_availability",
    select:
      "id, lot_number, brand_name, selling_format_name, total_quantity, allocated_quantity, reserved_quantity, available_quantity, production_date, best_by_date",
    baseFilters: [["gt", "available_quantity", 0]],
    params: {
      brandId: {
        op: "eq",
        column: "brand_id",
        schema: z.string().uuid().optional().describe("Filter by brand UUID"),
      },
      query: {
        op: "ilike",
        column: "brand_name",
        schema: optionalString("Search by brand name"),
      },
    },
    order: { column: "brand_name" },
    limit: 20,
  },

  searchOrders: {
    description:
      "Search orders by status, customer name, or date range. Returns order headers with customer info.",
    table: "orders",
    select: (args) =>
      `id, order_number, status, order_date, requested_date, scheduled_date, notes, customer:customers${
        args.customerName ? "!inner" : ""
      }(id, name)`,
    params: {
      status: statusParam(
        "Filter by status: draft, confirmed, scheduled, picking, packed, fulfilled, cancelled",
      ),
      ...dateRangeParams("order_date", "Order date"),
      customerName: {
        op: "ilike",
        column: "customers.name",
        schema: optionalString("Filter by customer name (partial match)"),
      },
    },
    order: { column: "order_date", ascending: false },
    limit: 20,
  },

  getCustomers: {
    description:
      "Search customers by name. Returns customer info with order statistics.",
    table: "customers_with_order_summary",
    select:
      "id, name, customer_type, contact_name, email, phone, total_orders, total_revenue, pending_orders, last_order_date",
    baseFilters: [["eq", "is_active", true]],
    params: {
      query: {
        op: "ilike",
        column: "name",
        schema: optionalString("Search by customer name"),
      },
    },
    order: { column: "name" },
    limit: 20,
  },

  searchBrewLogs: {
    description:
      "Search brew logs (hot-side brew day records) by status, date range, or brew number. Returns brew log headers with recipe info.",
    table: "brew_logs",
    select: "id, brew_number, brew_date, status, notes, recipe:recipes(id, name)",
    params: {
      status: statusParam(
        "Filter by status: draft, in_progress, completed, cancelled",
      ),
      ...dateRangeParams("brew_date", "Brew date"),
      brewNumber: {
        op: "ilike",
        column: "brew_number",
        schema: optionalString("Filter by brew number (partial match)"),
      },
    },
    order: { column: "brew_date", ascending: false },
    limit: 20,
  },

  searchPurchaseOrders: {
    description:
      "Search purchase orders by status, date range, or supplier name. Returns PO headers with supplier info.",
    table: "purchase_orders",
    select: (args) =>
      `id, po_number, status, order_date, expected_date, shipping_cost, tax, notes, supplier:suppliers${
        args.supplierName ? "!inner" : ""
      }(id, name)`,
    params: {
      status: statusParam(
        "Filter by status: draft, submitted, confirmed, partial, fulfilled, cancelled",
      ),
      ...dateRangeParams("order_date", "Order date"),
      supplierName: {
        op: "ilike",
        column: "suppliers.name",
        schema: optionalString("Filter by supplier name (partial match)"),
      },
    },
    order: { column: "order_date", ascending: false },
    limit: 20,
  },

  searchSuppliers: {
    description:
      "Search suppliers by name. Returns supplier contact info, payment terms, and lead times.",
    table: "suppliers",
    select:
      "id, name, contact_name, contact_email, contact_phone, payment_terms, default_lead_time_days, is_active",
    params: {
      query: {
        op: "ilike",
        column: "name",
        schema: optionalString("Search by supplier name"),
      },
      isActive: {
        op: "eq",
        column: "is_active",
        schema: z
          .boolean()
          .optional()
          .default(true)
          .describe("Filter by active status (default true)"),
      },
    },
    order: { column: "name" },
    limit: 20,
  },

  searchPickLists: {
    description:
      "Search pick lists by status, date range, or customer name. Returns pick list details with order info and progress.",
    table: "pick_list_details",
    select:
      "id, status, generated_at, order_id, order_number, customer_name, total_items, items_picked, assigned_to_name",
    params: {
      status: statusParam(
        "Filter by status: pending, in_progress, completed, cancelled",
      ),
      ...dateRangeParams("generated_at", "Generated-at date"),
      customerName: {
        op: "ilike",
        column: "customer_name",
        schema: optionalString("Filter by customer name (partial match)"),
      },
    },
    order: { column: "generated_at", ascending: false },
    limit: 20,
  },

  searchYeastPitches: {
    description:
      "Search yeast pitches with viability and strain details. Filter by status or strain name. Each row includes the strain's recommended_max_generations and an over_recommended_generation flag for spotting tired yeast past its recommended repitch limit.",
    // yeast_pitches_with_details was replaced by yeast_pitches_with_remaining
    // (migration 00158); that view has no batch_code, so vessel_name is
    // returned instead.
    table: "yeast_pitches_with_remaining",
    select:
      "id, status, source_type, generation, initial_viability, estimated_viability, viability_status, days_old, strain_id, strain_name, strain_code, strain_manufacturer, vessel_name, location_name",
    params: {
      status: statusParam(
        "Filter by status: available, pitched, harvested, expired, discarded",
      ),
      strainName: {
        op: "ilike",
        column: "strain_name",
        schema: optionalString("Filter by yeast strain name (partial match)"),
      },
    },
    order: { column: "created_at", ascending: false },
    limit: 20,
    postProcess: annotateYeastGenerations,
  },

  getKegInventory: {
    description:
      "Get keg inventory with type, owner, location, and contents. Filter by state (empty/filled/shipped), keg type, or location.",
    table: "keg_inventory_with_details",
    select:
      "id, keg_type_name, volume_bbl, keg_owner_name, state, location_name, quantity",
    params: {
      state: {
        op: "eq",
        column: "state",
        schema: optionalString(
          "Filter by keg state: empty, filled, shipped, returned, lost, retired",
        ),
      },
      kegTypeName: {
        op: "ilike",
        column: "keg_type_name",
        schema: optionalString("Filter by keg type name (partial match)"),
      },
      locationName: {
        op: "ilike",
        column: "location_name",
        schema: optionalString("Filter by location name (partial match)"),
      },
    },
    order: { column: "keg_type_name" },
    limit: 50,
  },
};

/** Instantiate every config-driven search tool against one Supabase client. */
export function createSearchTools(supabase: SupabaseClient<Database>) {
  return Object.fromEntries(
    Object.entries(SEARCH_TOOL_CONFIGS).map(([name, config]) => [
      name,
      buildSearchTool(config, supabase),
    ]),
  );
}
