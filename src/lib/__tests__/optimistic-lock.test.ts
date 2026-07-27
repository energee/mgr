// @vitest-environment node
/**
 * updateWithOptimisticLock is the client-side counterpart to
 * entityService.update()'s version-locked path (src/services/entity-service.ts:240-259),
 * which special-cases PGRST116 into a CONFLICT result. This file exists because
 * that special case was missing here — see the "conflicted" test below.
 */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { updateWithOptimisticLock } from "../optimistic-lock";

type QueryResult = { data: unknown; error: unknown };

function makeSupabase(result: QueryResult) {
  const spies = { eq: vi.fn(), update: vi.fn(), select: vi.fn(), single: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  builder.update = (...args: unknown[]) => {
    spies.update(...args);
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    spies.eq(...args);
    return builder;
  };
  builder.select = (...args: unknown[]) => {
    spies.select(...args);
    return builder;
  };
  builder.single = () => {
    spies.single();
    return Promise.resolve(result);
  };
  const from = vi.fn(() => builder);
  const supabase = { from } as unknown as SupabaseClient<Database>;
  return { supabase, spies };
}

describe("updateWithOptimisticLock", () => {
  it("reports a version conflict (PGRST116, .single() matched zero rows) as conflicted:true", async () => {
    const { supabase } = makeSupabase({
      data: null,
      error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    });

    const result = await updateWithOptimisticLock(
      supabase,
      "widgets",
      "widget-1",
      { name: "New name" },
      3
    );

    expect(result.success).toBe(false);
    expect(result.conflicted).toBe(true);
    expect(result.error).toBe("Record was modified by another user. Please refresh and try again.");
  });

  it("reports a non-conflict database error as conflicted:false", async () => {
    const { supabase } = makeSupabase({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });

    const result = await updateWithOptimisticLock(
      supabase,
      "widgets",
      "widget-1",
      { name: "New name" },
      3
    );

    expect(result.success).toBe(false);
    expect(result.conflicted).toBe(false);
    expect(result.error).toBe("duplicate key value");
  });

  it("returns the updated record on success", async () => {
    const updated = { id: "widget-1", version: 4, name: "New name" };
    const { supabase } = makeSupabase({ data: updated, error: null });

    const result = await updateWithOptimisticLock(
      supabase,
      "widgets",
      "widget-1",
      { name: "New name" },
      3
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(updated);
  });
});
