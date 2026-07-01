/**
 * Characterization tests for resolveYeastLineageRoot
 * (src/domain/yeast-lineage.ts): the RPC-first / parent-chain-fallback
 * strategy for finding a yeast lineage's root pitch id.
 *
 * These tests pin the function's *actual* current behavior, including a
 * couple of quirks in the fallback walk (see comments below) rather than
 * asserting idealized behavior.
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { resolveYeastLineageRoot } from "@/domain/yeast-lineage";

type Pitch = {
  id: string;
  parent_pitch_id: string | null;
  source_type: string;
};

/**
 * Minimal fake Supabase client for resolveYeastLineageRoot:
 * - `.rpc()` resolves with `rpcResult` (stands in for the
 *   `get_yeast_lineage_root` RPC).
 * - `.from("yeast_pitches_with_remaining").select(...).eq("id", id).single()`
 *   looks `id` up in `pitches` and resolves `{ data: pitches[id] ?? null }`.
 * `lookups` records every id looked up, in order, for chain-walk assertions.
 * `onLookup` (optional) runs on every lookup, before resolving — used to cap
 * the cycle test instead of letting an actual infinite loop run.
 */
function makeMockSupabase(options: {
  rpcResult?: { data: unknown; error: unknown };
  pitches?: Record<string, Pitch>;
  onLookup?: (id: string, callNumber: number) => void;
} = {}) {
  const {
    rpcResult = { data: null, error: { message: "rpc unavailable" } },
    pitches = {},
    onLookup,
  } = options;
  const lookups: string[] = [];

  const supabase = {
    rpc: vi.fn(() => Promise.resolve(rpcResult)),
    from: vi.fn((_table: string) => ({
      select: vi.fn((_cols: string) => ({
        eq: vi.fn((_col: string, id: string) => ({
          single: vi.fn(() => {
            lookups.push(id);
            onLookup?.(id, lookups.length);
            return Promise.resolve({ data: pitches[id] ?? null });
          }),
        })),
      })),
    })),
  } as unknown as SupabaseClient<Database>;

  return { supabase, lookups };
}

describe("resolveYeastLineageRoot", () => {
  describe("RPC path", () => {
    it("returns the RPC result directly when the RPC succeeds", async () => {
      const { supabase } = makeMockSupabase({
        rpcResult: { data: "root-123", error: null },
      });

      const result = await resolveYeastLineageRoot(supabase, "pitch-1");

      expect(result).toBe("root-123");
    });

    it("does not query the fallback view when the RPC succeeds", async () => {
      const { supabase } = makeMockSupabase({
        rpcResult: { data: "root-123", error: null },
      });

      await resolveYeastLineageRoot(supabase, "pitch-1");

      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("calls the RPC with p_pitch_id", async () => {
      const { supabase } = makeMockSupabase({
        rpcResult: { data: "root-1", error: null },
      });

      await resolveYeastLineageRoot(supabase, "pitch-42");

      expect(supabase.rpc).toHaveBeenCalledWith("get_yeast_lineage_root", {
        p_pitch_id: "pitch-42",
      });
    });

    it("quirk: falls back to the parent-chain walk when the RPC succeeds (no error) but returns falsy data", async () => {
      // The guard is `if (!rpcError && rpcResult)`, so a successful RPC
      // call that happens to resolve `data: null` (or "") is treated the
      // same as an RPC failure and triggers the client-side fallback.
      const { supabase } = makeMockSupabase({
        rpcResult: { data: null, error: null },
        pitches: {
          "pitch-1": {
            id: "pitch-1",
            parent_pitch_id: null,
            source_type: "fermentation",
          },
        },
      });

      const result = await resolveYeastLineageRoot(supabase, "pitch-1");

      expect(result).toBe("pitch-1");
      expect(supabase.from).toHaveBeenCalled();
    });
  });

  describe("fallback: single-generation lineage (RPC unavailable)", () => {
    it("returns the pitch's own id when it has no parent", async () => {
      const { supabase } = makeMockSupabase({
        pitches: {
          "pitch-1": {
            id: "pitch-1",
            parent_pitch_id: null,
            source_type: "fermentation",
          },
        },
      });

      const result = await resolveYeastLineageRoot(supabase, "pitch-1");

      expect(result).toBe("pitch-1");
    });

    it("returns the pitch's own id when source_type is 'purchase'", async () => {
      const { supabase } = makeMockSupabase({
        pitches: {
          "pitch-1": {
            id: "pitch-1",
            parent_pitch_id: null,
            source_type: "purchase",
          },
        },
      });

      const result = await resolveYeastLineageRoot(supabase, "pitch-1");

      expect(result).toBe("pitch-1");
    });

    it("quirk: treats source_type 'purchase' as terminal even if parent_pitch_id is set", async () => {
      // The loop condition is `!pitch.parent_pitch_id || pitch.source_type
      // === "purchase"` — an OR, not an AND. So a row shaped like a
      // "purchase" that (incorrectly, per the data model) still carries a
      // parent_pitch_id stops the walk anyway rather than continuing up.
      const { supabase, lookups } = makeMockSupabase({
        pitches: {
          "pitch-1": {
            id: "pitch-1",
            parent_pitch_id: "should-be-unreachable",
            source_type: "purchase",
          },
        },
      });

      const result = await resolveYeastLineageRoot(supabase, "pitch-1");

      expect(result).toBe("pitch-1");
      expect(lookups).toEqual(["pitch-1"]);
    });
  });

  describe("fallback: multi-generation chain", () => {
    it("walks multiple parent hops up to the root, terminating on null parent_pitch_id", async () => {
      const { supabase, lookups } = makeMockSupabase({
        pitches: {
          "gen-3": {
            id: "gen-3",
            parent_pitch_id: "gen-2",
            source_type: "fermentation",
          },
          "gen-2": {
            id: "gen-2",
            parent_pitch_id: "gen-1",
            source_type: "fermentation",
          },
          "gen-1": {
            id: "gen-1",
            parent_pitch_id: null,
            source_type: "purchase",
          },
        },
      });

      const result = await resolveYeastLineageRoot(supabase, "gen-3");

      expect(result).toBe("gen-1");
      expect(lookups).toEqual(["gen-3", "gen-2", "gen-1"]);
    });
  });

  describe("fallback: missing pitch / broken chain", () => {
    it("returns the original pitchId when the leaf pitch itself is not found", async () => {
      const { supabase } = makeMockSupabase({ pitches: {} });

      const result = await resolveYeastLineageRoot(supabase, "does-not-exist");

      expect(result).toBe("does-not-exist");
    });

    it("quirk: returns the original (outermost) pitchId, not the last-resolved ancestor, when a mid-chain parent is missing", async () => {
      // `return pitch?.id ?? pitchId` falls back to the *function argument*
      // `pitchId`, not to `currentId`. If the break happens a few hops up
      // the chain, this silently returns the original leaf id — neither
      // the last successfully-resolved ancestor ("gen-2") nor the id that
      // failed to resolve ("missing-parent").
      const { supabase } = makeMockSupabase({
        pitches: {
          "gen-3": {
            id: "gen-3",
            parent_pitch_id: "gen-2",
            source_type: "fermentation",
          },
          "gen-2": {
            id: "gen-2",
            parent_pitch_id: "missing-parent",
            source_type: "fermentation",
          },
          // "missing-parent" intentionally absent from `pitches`.
        },
      });

      const result = await resolveYeastLineageRoot(supabase, "gen-3");

      expect(result).toBe("gen-3");
    });

    it("returns the empty string unchanged when called with an empty pitchId and no matching row", async () => {
      const { supabase } = makeMockSupabase({ pitches: {} });

      const result = await resolveYeastLineageRoot(supabase, "");

      expect(result).toBe("");
    });
  });

  describe("fallback: cycle handling", () => {
    it("quirk: does not detect cycles and keeps walking indefinitely (no visited-set / iteration cap)", async () => {
      // A <-> B is a 2-node cycle. The real implementation has no cycle
      // guard, so left alone it would loop forever. To pin that behavior
      // without hanging the test suite, the mock throws once the lookup is
      // called more times than any real (acyclic) lineage ever would; the
      // resulting rejection — rather than a resolved value — is the
      // evidence that the loop was still going, not terminating on its own.
      const ITERATION_CAP = 25;
      let calls = 0;
      const pitches: Record<string, Pitch> = {
        A: { id: "A", parent_pitch_id: "B", source_type: "fermentation" },
        B: { id: "B", parent_pitch_id: "A", source_type: "fermentation" },
      };
      const { supabase } = makeMockSupabase({
        pitches,
        onLookup: () => {
          calls++;
          if (calls > ITERATION_CAP) {
            throw new Error("WATCHDOG: exceeded iteration cap without terminating");
          }
        },
      });

      await expect(resolveYeastLineageRoot(supabase, "A")).rejects.toThrow(
        "WATCHDOG: exceeded iteration cap without terminating",
      );
      expect(calls).toBeGreaterThan(ITERATION_CAP);
    });
  });
});
