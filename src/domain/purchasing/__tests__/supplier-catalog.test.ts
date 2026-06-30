/**
 * Tests for supplier_catalog write helpers (setPreferredSupplier /
 * demoteOtherPreferredSuppliers): demote-then-upsert ordering, the
 * onConflict key matching the UNIQUE(supplier_id, catalog_type, catalog_id)
 * constraint, the minimal upsert payload (so existing price/lead-time/MOQ
 * survive), and error propagation from either statement.
 */

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import {
  setPreferredSupplier,
  demoteOtherPreferredSuppliers,
  SUPPLIER_CATALOG_CONFLICT,
} from "../supplier-catalog";

type Call = { method: string; args: unknown[] };

/**
 * Minimal thenable supabase mock: records every builder call in order and
 * resolves the Nth awaited statement with results[N] ({ error: null } when
 * unspecified).
 */
function makeMockSupabase(results: { error: unknown }[] = []) {
  const calls: Call[] = [];
  let statement = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const method of ["update", "upsert", "eq", "neq", "in", "select"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (
    resolve: (value: { error: unknown }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => {
    const result = results[statement++] ?? { error: null };
    return Promise.resolve(result).then(resolve, reject);
  };

  const supabase = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return builder;
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, calls };
}

const assignment = {
  supplierId: "sup-1",
  catalogType: "malt",
  catalogId: "malt-1",
};

describe("demoteOtherPreferredSuppliers", () => {
  it("clears is_preferred on other suppliers' rows for the same item", async () => {
    const { supabase, calls } = makeMockSupabase();

    await demoteOtherPreferredSuppliers(supabase, assignment);

    expect(calls).toEqual([
      { method: "from", args: ["supplier_catalog"] },
      { method: "update", args: [{ is_preferred: false }] },
      { method: "eq", args: ["catalog_type", "malt"] },
      { method: "eq", args: ["catalog_id", "malt-1"] },
      { method: "neq", args: ["supplier_id", "sup-1"] },
      { method: "eq", args: ["is_preferred", true] },
    ]);
  });

  it("throws the postgrest error when the update fails", async () => {
    const dbError = { code: "42501", message: "permission denied" };
    const { supabase } = makeMockSupabase([{ error: dbError }]);

    await expect(
      demoteOtherPreferredSuppliers(supabase, assignment)
    ).rejects.toBe(dbError);
  });
});

describe("setPreferredSupplier", () => {
  it("demotes other preferred rows, then upserts on the unique key with a minimal payload", async () => {
    const { supabase, calls } = makeMockSupabase();

    await setPreferredSupplier(supabase, assignment);

    // Demote statement first (asserted in detail above), then the upsert.
    const upsertIndex = calls.findIndex((c) => c.method === "upsert");
    const demoteIndex = calls.findIndex((c) => c.method === "update");
    expect(demoteIndex).toBeGreaterThanOrEqual(0);
    expect(upsertIndex).toBeGreaterThan(demoteIndex);

    // Payload carries only identity + is_preferred so existing
    // price/lead-time/MOQ columns are left untouched on conflict.
    expect(calls[upsertIndex].args).toEqual([
      {
        supplier_id: "sup-1",
        catalog_type: "malt",
        catalog_id: "malt-1",
        is_preferred: true,
      },
      { onConflict: SUPPLIER_CATALOG_CONFLICT },
    ]);
  });

  it("propagates a demote failure without attempting the upsert", async () => {
    const dbError = { code: "42501", message: "permission denied" };
    const { supabase, calls } = makeMockSupabase([{ error: dbError }]);

    await expect(setPreferredSupplier(supabase, assignment)).rejects.toBe(dbError);
    expect(calls.some((c) => c.method === "upsert")).toBe(false);
  });

  it("propagates an upsert failure", async () => {
    const dbError = { code: "23503", message: "fk violation" };
    const { supabase } = makeMockSupabase([{ error: null }, { error: dbError }]);

    await expect(setPreferredSupplier(supabase, assignment)).rejects.toBe(dbError);
  });
});
