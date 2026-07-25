/**
 * Handler-level tests for the batch and recipe detail REST routes.
 *
 * These exercise the real `withPermission`-wrapped handlers with a mocked
 * Supabase client so the HTTP contract of the documented REST surface is
 * pinned end to end:
 *
 * - DELETE must answer 204 with an empty body after the row is gone (#609).
 *   The route reaches `successResponse(null, undefined, 204)`, so a helper that
 *   cannot build a null-body response surfaces here as a 500.
 * - PATCH must refuse to flip `batches.status`; state changes belong to
 *   `POST /api/batches/[id]/transfer`, which runs `transition_entity_atomic`
 *   and its side effects (#601).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const session = {
    roles: ["admin"] as string[],
    status: "active",
  };

  /** Queued { data, error } responses keyed by table, shifted per `.from()`. */
  const queues: Record<string, { data: unknown; error: unknown }[]> = {};
  /** Builders created per table, in call order — assert chain args on these. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callsByTable: Record<string, any[]> = {};

  const CHAIN = ["select", "eq", "single", "update", "delete", "order", "limit"];

  function makeBuilder(response: { data: unknown; error: unknown }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const method of CHAIN) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = (
      resolve?: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(response).then(resolve, reject);
    return builder;
  }

  const from = vi.fn((table: string) => {
    if (table === "user_profiles") {
      return makeBuilder({
        data: { roles: session.roles, status: session.status },
        error: null,
      });
    }
    const queue = queues[table];
    if (!queue || queue.length === 0) {
      throw new Error(`no queued response for table "${table}"`);
    }
    const builder = makeBuilder(queue.shift()!);
    (callsByTable[table] ??= []).push(builder);
    return builder;
  });

  const createClient = vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
    from,
  }));

  return { session, queues, callsByTable, from, createClient };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  createAdminClient: vi.fn(),
}));

import {
  PATCH as patchBatch,
  DELETE as deleteBatch,
} from "@/app/api/batches/[id]/route";
import {
  PATCH as patchRecipe,
  DELETE as deleteRecipe,
} from "@/app/api/recipes/[id]/route";

const routeContext = { params: Promise.resolve({ id: "batch-1" }) };

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/batches/batch-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: "DELETE" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.roles = ["admin"];
  mocks.session.status = "active";
  for (const key of Object.keys(mocks.queues)) delete mocks.queues[key];
  for (const key of Object.keys(mocks.callsByTable)) delete mocks.callsByTable[key];
});

describe("DELETE /api/batches/[id]", () => {
  it("returns 204 with an empty body after the row is deleted", async () => {
    mocks.queues.batches = [{ data: null, error: null }];

    const response = await deleteBatch(
      deleteRequest("/api/batches/batch-1"),
      routeContext,
    );

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe("");
    expect(mocks.callsByTable.batches[0].delete).toHaveBeenCalled();
  });
});

describe("DELETE /api/recipes/[id]", () => {
  it("returns 204 with an empty body when no batches reference the recipe", async () => {
    mocks.queues.batches = [{ data: null, error: null }];
    mocks.queues.recipes = [{ data: null, error: null }];

    const response = await deleteRecipe(deleteRequest("/api/recipes/recipe-1"), {
      params: Promise.resolve({ id: "recipe-1" }),
    });

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("still returns 409 when the recipe has associated batches", async () => {
    mocks.queues.batches = [{ data: null, error: null }];
    // The count guard reads `count`, not `data`; patch it onto the response.
    mocks.queues.batches[0] = Object.assign(mocks.queues.batches[0], { count: 3 });

    const response = await deleteRecipe(deleteRequest("/api/recipes/recipe-1"), {
      params: Promise.resolve({ id: "recipe-1" }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("CONFLICT");
  });
});

describe("PATCH /api/batches/[id]", () => {
  it("rejects a status field and never issues an update", async () => {
    const response = await patchBatch(
      patchRequest({ status: "completed" }),
      routeContext,
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("/transfer");
    // No `.from("batches")` at all — the state flip must not reach Postgres.
    expect(mocks.callsByTable.batches).toBeUndefined();
  });

  it("applies non-state fields normally", async () => {
    mocks.queues.batches = [
      { data: { id: "batch-1", notes: "dry hopped" }, error: null },
    ];

    const response = await patchBatch(
      patchRequest({ notes: "dry hopped" }),
      routeContext,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ id: "batch-1", notes: "dry hopped" });
    expect(mocks.callsByTable.batches[0].update).toHaveBeenCalledWith({
      notes: "dry hopped",
    });
  });
});

describe("PATCH /api/recipes/[id]", () => {
  // `recipeSchema.partial()` still fires `.default()` for absent keys, so the
  // old payload carried status:"draft" / is_active:true and demoted any recipe
  // edited through this route. Only submitted fields may reach the UPDATE.
  it("does not inject schema defaults for fields the caller omitted", async () => {
    mocks.queues.recipes = [
      { data: { id: "recipe-1", name: "Renamed" }, error: null },
    ];

    const response = await patchRecipe(
      new NextRequest("http://localhost/api/recipes/recipe-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
      { params: Promise.resolve({ id: "recipe-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.callsByTable.recipes[0].update).toHaveBeenCalledWith({
      name: "Renamed",
    });
  });
});
