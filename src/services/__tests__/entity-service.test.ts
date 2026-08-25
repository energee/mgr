// @vitest-environment node
/**
 * Characterization tests for src/services/entity-service.ts.
 *
 * entityService methods all take a SupabaseClient as their first parameter
 * (no module-level Supabase import), so we hand each test a lightweight
 * fake query-builder object rather than vi.mock()-ing a client module.
 *
 * `entityService.transition()` already has dedicated, thorough coverage in
 * ./entity-transitions.test.ts (valid/invalid state paths, PGRST116
 * conflicts, missing state machine). This file focuses on the other four
 * CRUD methods (list/getById/create/update/remove) plus the search-escaping
 * helper and, as a gap-filling addition, the `stateMachine.hooks.validate`
 * branch of transition() which the sibling file does not exercise.
 *
 * This file keeps its own local, sequential (call-ordered) fake Supabase
 * client rather than the shared table-keyed fake in
 * src/test/supabase-mock.ts. The shared fake's `callsByTable[table][i]`
 * offers equivalent call-ordered inspection; the honest reason not to
 * migrate is churn -- every assertion here is written against
 * `builders[i].spies.*`, and renaming all of them buys no behavior change.
 * New service tests should use the shared fake.
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type { EntityCore, EntityConfig } from "@/types/entity";
import { entityService } from "../entity-service";

// =============================================================================
// Fake Supabase query builder
// =============================================================================

type QueryResult = { data: unknown; error: unknown };

/**
 * Every chain method returns the same builder object (mimicking
 * PostgrestFilterBuilder's fluent API), and the builder itself is
 * thenable so `await query` resolves without an explicit `.single()`
 * call (used by list/remove). `.single()` returns a plain Promise, as
 * the real client does.
 */
function makeBuilder(result: QueryResult) {
  const spies = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    single: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  builder.select = (...args: unknown[]) => {
    spies.select(...args);
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    spies.eq(...args);
    return builder;
  };
  builder.or = (...args: unknown[]) => {
    spies.or(...args);
    return builder;
  };
  builder.order = (...args: unknown[]) => {
    spies.order(...args);
    return builder;
  };
  builder.limit = (...args: unknown[]) => {
    spies.limit(...args);
    return builder;
  };
  builder.insert = (...args: unknown[]) => {
    spies.insert(...args);
    return builder;
  };
  builder.update = (...args: unknown[]) => {
    spies.update(...args);
    return builder;
  };
  builder.delete = (...args: unknown[]) => {
    spies.delete(...args);
    return builder;
  };
  builder.single = () => {
    spies.single();
    return Promise.resolve(result);
  };
  builder.then = (
    resolve: (value: QueryResult) => void,
    reject: (reason: unknown) => void,
  ) => Promise.resolve(result).then(resolve, reject);
  return { builder, spies };
}

/** Fake SupabaseClient whose `.from()` and `.rpc()` consume `results` in
 *  order. Throws if either method is called more times than results were
 *  queued, rather than silently
 *  recycling the last response — a test that under-queues should fail
 *  loudly, not pass vacuously on stale data. */
function makeSupabase(results: QueryResult[]) {
  let call = 0;
  const builders: ReturnType<typeof makeBuilder>[] = [];
  const from = vi.fn((_table: string) => {
    if (call >= results.length) {
      throw new Error(`fake supabase: no queued result for from() call #${call}`);
    }
    const result = results[call];
    const made = makeBuilder(result);
    builders.push(made);
    call++;
    return made.builder;
  });
  const rpc = vi.fn(() => {
    if (call >= results.length) {
      throw new Error(`fake supabase: no queued result for rpc() call #${call}`);
    }
    const result = results[call];
    call++;
    return Promise.resolve({
      data: result.data == null ? null : { record: result.data },
      error: result.error,
    });
  });
  const supabase = { from, rpc } as unknown as SupabaseClient<Database>;
  return { supabase, from, rpc, builders };
}

/** Fake SupabaseClient whose `.from()` throws synchronously, to exercise
 *  the outer try/catch → UNKNOWN branch of each service method. */
function makeThrowingSupabase(error: unknown) {
  const from = vi.fn(() => {
    throw error;
  });
  const supabase = { from } as unknown as SupabaseClient<Database>;
  return { supabase, from };
}

// =============================================================================
// Fixtures
// =============================================================================

type Widget = {
  id: string;
  name: string;
  sku?: string;
  is_active?: boolean;
  version?: number;
  status?: string;
};

const widgetFormSchema: z.ZodType<Partial<Widget>> = z
  .object({
    name: z.string().min(1, "Name is required"),
    sku: z.string().optional(),
  })
  .partial();

const widgetCore: EntityCore<Widget> = {
  name: "widget",
  table: "widgets",
  displayName: "Widget",
  displayNamePlural: "Widgets",
  domain: "production",
  formSchema: widgetFormSchema,
  searchableFields: ["name", "sku"],
  defaultSort: { column: "name", direction: "asc" },
};

const widgetCoreWithView: EntityCore<Widget> = {
  ...widgetCore,
  viewTable: "widgets_view",
};

const widgetEntity = {
  ...widgetCore,
  listColumns: [],
  sections: [],
} as unknown as EntityConfig<Widget>;

const widgetEntityWithView = {
  ...widgetEntity,
  viewTable: "widgets_view",
} as unknown as EntityConfig<Widget>;

const TEST_ID = "widget-1";

// =============================================================================
// list()
// =============================================================================

describe("entityService.list", () => {
  it("reads from the base table when no viewTable is configured", async () => {
    const { supabase, from } = makeSupabase([{ data: [{ id: "1" }], error: null }]);

    await entityService.list(supabase, widgetCore);

    expect(from).toHaveBeenCalledWith("widgets");
  });

  it("prefers viewTable over table when both are present", async () => {
    const { supabase, from } = makeSupabase([{ data: [], error: null }]);

    await entityService.list(supabase, widgetCoreWithView);

    expect(from).toHaveBeenCalledWith("widgets_view");
  });

  it("applies exact-match filters, skipping undefined and null values but keeping falsy-but-defined ones", async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);

    await entityService.list(supabase, widgetCore, {
      filters: { status: "active", assignee: undefined, category: null, priority: 0 },
    });

    // undefined/null filtered out; priority: 0 is neither, so it passes through.
    expect(builders[0].spies.eq).toHaveBeenCalledTimes(2);
    expect(builders[0].spies.eq).toHaveBeenCalledWith("status", "active");
    expect(builders[0].spies.eq).toHaveBeenCalledWith("priority", 0);
  });

  it("does not search when entity has no searchableFields, even if options.search is set", async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);
    const noSearchCore: EntityCore<Widget> = { ...widgetCore, searchableFields: undefined };

    await entityService.list(supabase, noSearchCore, { search: "acme" });

    expect(builders[0].spies.or).not.toHaveBeenCalled();
  });

  it("builds an unquoted ilike .or() condition for a plain search term", async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);

    await entityService.list(supabase, widgetCore, { search: "acme" });

    expect(builders[0].spies.or).toHaveBeenCalledWith(
      "name.ilike.%acme%,sku.ilike.%acme%",
    );
  });

  it("escapes % and _ (ILIKE wildcards) inside the search term", async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);

    await entityService.list(supabase, widgetCore, { search: "50% off_sale" });

    expect(builders[0].spies.or).toHaveBeenCalledWith(
      "name.ilike.%50\\% off\\_sale%,sku.ilike.%50\\% off\\_sale%",
    );
  });

  it("double-quotes the whole pattern when the search term contains a comma or parens", async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);

    await entityService.list(supabase, widgetCore, { search: "Acme, Inc" });

    expect(builders[0].spies.or).toHaveBeenCalledWith(
      'name.ilike."%Acme, Inc%",sku.ilike."%Acme, Inc%"',
    );
  });

  it("escapes an embedded double quote so it can't terminate the quoted PostgREST token early", async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);

    // Reserved-char quoting (comma) plus an embedded `"` — an unescaped
    // quote closes the PostgREST quoted value right after `Acme `, leaving
    // `Inc", Co%"` dangling and producing a malformed .or() filter (400 from
    // PostgREST) instead of a search for the literal string.
    await entityService.list(supabase, widgetCore, { search: 'Acme "Inc", Co' });

    expect(builders[0].spies.or).toHaveBeenCalledWith(
      'name.ilike."%Acme \\"Inc\\", Co%",sku.ilike."%Acme \\"Inc\\", Co%"',
    );
  });

  it('QUIRK: a literal "." in the search term also triggers quoting, even with no comma/paren present', async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);

    await entityService.list(supabase, widgetCore, { search: "example.com" });

    // The needsQuoting regex is /[,().]/ — the "." inside the character
    // class matches a literal dot, not "any character", so a bare domain
    // name gets wrapped in quotes despite containing no comma or paren.
    expect(builders[0].spies.or).toHaveBeenCalledWith(
      'name.ilike."%example.com%",sku.ilike."%example.com%"',
    );
  });

  it("applies entity.defaultSort when no options.sort is given", async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);

    await entityService.list(supabase, widgetCore);

    expect(builders[0].spies.order).toHaveBeenCalledWith("name", { ascending: true });
  });

  it("options.sort overrides entity.defaultSort", async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);

    await entityService.list(supabase, widgetCore, {
      sort: { column: "sku", direction: "desc" },
    });

    expect(builders[0].spies.order).toHaveBeenCalledWith("sku", { ascending: false });
  });

  it("does not order at all when neither options.sort nor entity.defaultSort is set", async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);
    const noSortCore: EntityCore<Widget> = { ...widgetCore, defaultSort: undefined };

    await entityService.list(supabase, noSortCore);

    expect(builders[0].spies.order).not.toHaveBeenCalled();
  });

  it("applies options.limit only when provided", async () => {
    const { supabase, builders } = makeSupabase([{ data: [], error: null }]);

    await entityService.list(supabase, widgetCore, { limit: 25 });

    expect(builders[0].spies.limit).toHaveBeenCalledWith(25);
  });

  it("returns ok(data) on success", async () => {
    const rows = [{ id: "1", name: "Widget A" }];
    const { supabase } = makeSupabase([{ data: rows, error: null }]);

    const result = await entityService.list(supabase, widgetCore);

    expect(result).toEqual({ success: true, data: rows, invalidate: [] });
  });

  it("maps a Supabase error to a ServiceError via parseSupabaseError", async () => {
    const { supabase } = makeSupabase([
      { data: null, error: { code: "42501", message: "insufficient privilege" } },
    ]);

    const result = await entityService.list(supabase, widgetCore);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("RLS_DENIED");
    }
  });

  it("catches a synchronous throw (e.g. from .from()) as an UNKNOWN error", async () => {
    const { supabase } = makeThrowingSupabase(new Error("connection lost"));

    const result = await entityService.list(supabase, widgetCore);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN");
      if (result.error.code === "UNKNOWN") {
        expect(result.error.message).toContain("Failed to list Widgets");
        expect(result.error.message).toContain("connection lost");
      }
    }
  });
});

// =============================================================================
// getById()
// =============================================================================

describe("entityService.getById", () => {
  it("reads from viewTable when configured, filtering by id", async () => {
    const { supabase, from, builders } = makeSupabase([
      { data: { id: TEST_ID, name: "Widget A" }, error: null },
    ]);

    const result = await entityService.getById(supabase, widgetCoreWithView, TEST_ID);

    expect(from).toHaveBeenCalledWith("widgets_view");
    expect(builders[0].spies.eq).toHaveBeenCalledWith("id", TEST_ID);
    expect(result).toEqual({
      success: true,
      data: { id: TEST_ID, name: "Widget A" },
      invalidate: [],
    });
  });

  it("maps PGRST116 (.single() no match) to NOT_FOUND with table/id context", async () => {
    const { supabase } = makeSupabase([
      { data: null, error: { code: "PGRST116", message: "no rows" } },
    ]);

    const result = await entityService.getById(supabase, widgetCore, TEST_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({ code: "NOT_FOUND", table: "widgets", id: TEST_ID });
    }
  });

  it("catches a synchronous throw as UNKNOWN", async () => {
    const { supabase } = makeThrowingSupabase(new Error("boom"));

    const result = await entityService.getById(supabase, widgetCore, TEST_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN");
      if (result.error.code === "UNKNOWN") {
        expect(result.error.message).toContain("Failed to get Widget");
      }
    }
  });
});

// =============================================================================
// create()
// =============================================================================

describe("entityService.create", () => {
  it("returns VALIDATION and never touches supabase when formSchema.safeParse fails", async () => {
    const { supabase, from } = makeSupabase([{ data: null, error: null }]);

    const result = await entityService.create(supabase, widgetEntity, { name: "" });

    expect(from).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION");
      if (result.error.code === "VALIDATION") {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0].path).toEqual(["name"]);
      }
    }
  });

  it("always writes to the base table, never viewTable", async () => {
    const { supabase, from } = makeSupabase([
      { data: { id: TEST_ID, name: "Widget A" }, error: null },
    ]);

    await entityService.create(supabase, widgetEntityWithView, { name: "Widget A" });

    expect(from).toHaveBeenCalledWith("widgets");
  });

  it("inserts only the parsed (validated) data", async () => {
    const { supabase, builders } = makeSupabase([
      { data: { id: TEST_ID, name: "Widget A" }, error: null },
    ]);

    await entityService.create(supabase, widgetEntity, {
      name: "Widget A",
      extraneous: "ignored by schema shape but present on input",
    });

    // z.object({name, sku}).partial() strips unknown keys by default.
    expect(builders[0].spies.insert).toHaveBeenCalledWith({ name: "Widget A" });
  });

  it("returns ok(created, invalidationKeys) including both table and viewTable detail keys", async () => {
    const created = { id: TEST_ID, name: "Widget A" };
    const { supabase } = makeSupabase([{ data: created, error: null }]);

    const result = await entityService.create(supabase, widgetEntityWithView, {
      name: "Widget A",
    });

    expect(result).toEqual({
      success: true,
      data: created,
      invalidate: [
        ["widgets"],
        ["widgets_view"],
        ["widgets", TEST_ID],
        ["widgets_view", TEST_ID],
      ],
    });
  });

  it("maps a unique constraint violation (23505) to UNIQUE_VIOLATION", async () => {
    const { supabase } = makeSupabase([
      { data: null, error: { code: "23505", message: "duplicate key" } },
    ]);

    const result = await entityService.create(supabase, widgetEntity, { name: "Widget A" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNIQUE_VIOLATION");
    }
  });

  it("catches a synchronous throw as UNKNOWN", async () => {
    const { supabase } = makeThrowingSupabase(new Error("network down"));

    const result = await entityService.create(supabase, widgetEntity, { name: "Widget A" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN");
      if (result.error.code === "UNKNOWN") {
        expect(result.error.message).toContain("Failed to create Widget");
      }
    }
  });
});

// =============================================================================
// update()
// =============================================================================

describe("entityService.update", () => {
  it("returns VALIDATION and never touches supabase when formSchema.safeParse fails", async () => {
    const { supabase, from } = makeSupabase([{ data: null, error: null }]);

    const result = await entityService.update(supabase, widgetEntity, TEST_ID, { name: "" });

    expect(from).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION");
    }
  });

  it("standard update (no currentVersion) stamps updated_at and omits version", async () => {
    const { supabase, builders } = makeSupabase([
      { data: { id: TEST_ID, name: "Widget A" }, error: null },
    ]);

    const result = await entityService.update(supabase, widgetEntity, TEST_ID, {
      name: "Widget A",
    });

    const updatePayload = builders[0].spies.update.mock.calls[0][0];
    expect(updatePayload.name).toBe("Widget A");
    expect(updatePayload.version).toBeUndefined();
    expect(typeof updatePayload.updated_at).toBe("string");
    expect(builders[0].spies.eq).toHaveBeenCalledWith("id", TEST_ID);
    expect(builders[0].spies.eq).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("optimistic-lock update includes version + 1 and a version equality filter", async () => {
    const { supabase, builders } = makeSupabase([
      { data: { id: TEST_ID, name: "Widget A", version: 4 }, error: null },
    ]);

    await entityService.update(supabase, widgetEntity, TEST_ID, { name: "Widget A" }, 3);

    const updatePayload = builders[0].spies.update.mock.calls[0][0];
    expect(updatePayload.version).toBe(4);
    expect(builders[0].spies.eq).toHaveBeenCalledWith("id", TEST_ID);
    expect(builders[0].spies.eq).toHaveBeenCalledWith("version", 3);
  });

  it("maps a PGRST116 conflict during optimistic-lock update to CONFLICT with the caller's currentVersion", async () => {
    const { supabase } = makeSupabase([
      { data: null, error: { code: "PGRST116", message: "no rows" } },
    ]);

    const result = await entityService.update(
      supabase,
      widgetEntity,
      TEST_ID,
      { name: "Widget A" },
      5,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({
        code: "CONFLICT",
        currentVersion: 5,
        message: "Record was modified by another user. Please refresh and try again.",
      });
    }
  });

  it("QUIRK: a PGRST116 on the standard (non-versioned) path is NOT special-cased into CONFLICT — it falls through to parseSupabaseError's generic NOT_FOUND mapping", async () => {
    const { supabase } = makeSupabase([
      { data: null, error: { code: "PGRST116", message: "no rows" } },
    ]);

    const result = await entityService.update(supabase, widgetEntity, TEST_ID, {
      name: "Widget A",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("maps a non-PGRST116 error via parseSupabaseError", async () => {
    const { supabase } = makeSupabase([
      { data: null, error: { code: "23503", message: "fk violation" } },
    ]);

    const result = await entityService.update(supabase, widgetEntity, TEST_ID, {
      name: "Widget A",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("FK_VIOLATION");
    }
  });

  it("returns invalidationKeys for both table and viewTable on success", async () => {
    const { supabase } = makeSupabase([
      { data: { id: TEST_ID, name: "Widget A" }, error: null },
    ]);

    const result = await entityService.update(supabase, widgetEntityWithView, TEST_ID, {
      name: "Widget A",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.invalidate).toEqual([
        ["widgets"],
        ["widgets_view"],
        ["widgets", TEST_ID],
        ["widgets_view", TEST_ID],
      ]);
    }
  });

  it("catches a synchronous throw as UNKNOWN", async () => {
    const { supabase } = makeThrowingSupabase(new Error("boom"));

    const result = await entityService.update(supabase, widgetEntity, TEST_ID, {
      name: "Widget A",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN");
      if (result.error.code === "UNKNOWN") {
        expect(result.error.message).toContain("Failed to update Widget");
      }
    }
  });
});

// =============================================================================
// remove()
// =============================================================================

describe("entityService.remove", () => {
  it('soft mode updates is_active: false rather than deleting', async () => {
    const { supabase, from, builders } = makeSupabase([{ data: null, error: null }]);

    const result = await entityService.remove(supabase, widgetEntity, TEST_ID, "soft");

    expect(from).toHaveBeenCalledWith("widgets");
    expect(builders[0].spies.update).toHaveBeenCalledWith({ is_active: false });
    expect(builders[0].spies.delete).not.toHaveBeenCalled();
    expect(builders[0].spies.eq).toHaveBeenCalledWith("id", TEST_ID);
    expect(result.success).toBe(true);
  });

  it("hard mode deletes the row", async () => {
    const { supabase, builders } = makeSupabase([{ data: null, error: null }]);

    const result = await entityService.remove(supabase, widgetEntity, TEST_ID, "hard");

    expect(builders[0].spies.delete).toHaveBeenCalled();
    expect(builders[0].spies.update).not.toHaveBeenCalled();
    expect(builders[0].spies.eq).toHaveBeenCalledWith("id", TEST_ID);
    expect(result.success).toBe(true);
  });

  it("returns ok(undefined, invalidationKeys) on success", async () => {
    const { supabase } = makeSupabase([{ data: null, error: null }]);

    const result = await entityService.remove(supabase, widgetEntityWithView, TEST_ID, "hard");

    expect(result).toEqual({
      success: true,
      data: undefined,
      invalidate: [
        ["widgets"],
        ["widgets_view"],
        ["widgets", TEST_ID],
        ["widgets_view", TEST_ID],
      ],
    });
  });

  it("maps a Supabase error on soft-delete via parseSupabaseError", async () => {
    const { supabase } = makeSupabase([
      { data: null, error: { code: "23503", message: "referenced elsewhere" } },
    ]);

    const result = await entityService.remove(supabase, widgetEntity, TEST_ID, "soft");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("FK_VIOLATION");
    }
  });

  it("maps a Supabase error on hard-delete via parseSupabaseError", async () => {
    const { supabase } = makeSupabase([
      { data: null, error: { code: "23503", message: "referenced elsewhere" } },
    ]);

    const result = await entityService.remove(supabase, widgetEntity, TEST_ID, "hard");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("FK_VIOLATION");
    }
  });

  it("catches a synchronous throw as UNKNOWN", async () => {
    const { supabase } = makeThrowingSupabase(new Error("boom"));

    const result = await entityService.remove(supabase, widgetEntity, TEST_ID, "hard");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN");
      if (result.error.code === "UNKNOWN") {
        expect(result.error.message).toContain("Failed to delete Widget");
      }
    }
  });
});

// =============================================================================
// transition() — hooks.validate branch
//
// entity-transitions.test.ts already covers the state-machine graph walk,
// terminal states, and PGRST116 races thoroughly. It does not exercise
// `stateMachine.hooks.validate`, so that branch is filled in here.
// =============================================================================

describe("entityService.transition — hooks.validate", () => {
  const widgetWithHook = {
    ...widgetEntity,
    stateMachine: {
      stateField: "status",
      states: ["draft", "archived", "active"],
      initialState: "draft",
      // Two source states can structurally reach "active"; the hook adds a
      // stricter business rule on top (only a fresh "draft" may
      // auto-activate — reactivating from "archived" is blocked here).
      transitions: { draft: ["active"], archived: ["active"] },
      hooks: {
        validate: {
          // NOTE: validate hooks receive ONLY the projected state field.
          // entity-service.ts fetches the current row via
          // `.select(sm.stateField).eq("id", id).single()` (see
          // entity-service.ts ~line 302) before running this hook, so
          // `data` here is really just `{ status: "..." }` — no other
          // column (e.g. `name`) is ever populated at this read, and
          // inspecting one would be a no-op in production.
          active: (data: Widget) =>
            data.status === "draft" ? null : "must be in draft status to activate",
        },
      },
    },
  } as unknown as EntityConfig<Widget>;

  it("blocks the transition and never issues the write when the hook returns an error string", async () => {
    const { supabase, from } = makeSupabase([{ data: { status: "archived" }, error: null }]);

    const result = await entityService.transition(supabase, widgetWithHook, TEST_ID, "active");

    expect(from).toHaveBeenCalledTimes(1); // only the read; no write attempted
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({
        code: "INVALID_TRANSITION",
        from: "archived",
        to: "active",
        message: "must be in draft status to activate",
      });
    }
  });

  it("proceeds to the write when the hook returns null", async () => {
    const { supabase, from, rpc } = makeSupabase([
      { data: { status: "draft" }, error: null },
      { data: { id: TEST_ID, status: "active", name: "Widget A" }, error: null },
    ]);

    const result = await entityService.transition(supabase, widgetWithHook, TEST_ID, "active");

    expect(from).toHaveBeenCalledTimes(1); // read
    expect(rpc).toHaveBeenCalledTimes(1); // transactional write + effects
    expect(result.success).toBe(true);
  });
});
