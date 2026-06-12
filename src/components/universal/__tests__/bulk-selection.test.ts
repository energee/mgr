/**
 * Bulk selection + bulk delete tests (audit finding 08):
 * - syncSelectionSnapshots keeps id-keyed selection usable across page
 *   flips: off-page rows keep their last-seen snapshot, on-page rows
 *   refresh, deselected ids are dropped
 * - executeBulkDelete reports per-row failures for hard deletes (bulk
 *   DELETE first, per-row fallback when it fails) and treats soft
 *   deactivation as all-or-nothing
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// Prevents env-var validation in @/lib/env from throwing at import time
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    from: () => ({ select: () => ({ data: [], error: null }) }),
  })),
}));

// Prevents @sentry/nextjs initialisation errors in jsdom
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { syncSelectionSnapshots } from "@/components/universal/entity-data-table";
import { executeBulkDelete } from "@/components/universal/entity-delete-dialog";

// ---------------------------------------------------------------------------
// syncSelectionSnapshots
// ---------------------------------------------------------------------------

type Row = { id: string; status: string };

const page1: Row[] = [
  { id: "a", status: "draft" },
  { id: "b", status: "draft" },
];
const page2: Row[] = [
  { id: "c", status: "ready" },
  { id: "d", status: "ready" },
];

describe("syncSelectionSnapshots", () => {
  it("returns the selected rows from the current page", () => {
    const snapshots = new Map<string, Row>();
    const selected = syncSelectionSnapshots(snapshots, { a: true }, page1);
    expect(selected).toEqual([{ id: "a", status: "draft" }]);
  });

  it("retains off-page snapshots across a page flip", () => {
    const snapshots = new Map<string, Row>();
    syncSelectionSnapshots(snapshots, { a: true }, page1);
    // Page flip: rows now contain only page2, selection grows by "c"
    const selected = syncSelectionSnapshots(
      snapshots,
      { a: true, c: true },
      page2
    );
    expect(selected.map((r) => r.id).sort()).toEqual(["a", "c"]);
    // "a" kept its page-1 snapshot even though it's no longer fetched
    expect(selected.find((r) => r.id === "a")?.status).toBe("draft");
  });

  it("refreshes a snapshot when the row re-appears with new data", () => {
    const snapshots = new Map<string, Row>();
    syncSelectionSnapshots(snapshots, { a: true }, page1);
    const updatedPage1: Row[] = [{ id: "a", status: "ready" }];
    const selected = syncSelectionSnapshots(snapshots, { a: true }, updatedPage1);
    expect(selected[0]?.status).toBe("ready");
  });

  it("drops snapshots for deselected ids and ignores false entries", () => {
    const snapshots = new Map<string, Row>();
    syncSelectionSnapshots(snapshots, { a: true, b: true }, page1);
    const selected = syncSelectionSnapshots(
      snapshots,
      { a: true, b: false },
      page1
    );
    expect(selected.map((r) => r.id)).toEqual(["a"]);
    expect(snapshots.has("b")).toBe(false);
  });

  it("clears all snapshots when selection is emptied", () => {
    const snapshots = new Map<string, Row>();
    syncSelectionSnapshots(snapshots, { a: true, b: true }, page1);
    const selected = syncSelectionSnapshots(snapshots, {}, page2);
    expect(selected).toEqual([]);
    expect(snapshots.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// executeBulkDelete
// ---------------------------------------------------------------------------

type FakeResult = { error: { code?: string; message?: string } | null };

/**
 * Minimal chainable stand-in for the PostgREST builder covering the three
 * shapes executeBulkDelete uses: update().in(), delete().in(), delete().eq().
 */
function makeFakeSupabase(handlers: {
  updateIn?: (ids: string[]) => FakeResult;
  deleteIn?: (ids: string[]) => FakeResult;
  deleteEq?: (id: string) => FakeResult;
}) {
  const calls = {
    updateIn: [] as string[][],
    deleteIn: [] as string[][],
    deleteEq: [] as string[],
  };
  const supabase = {
    from: () => ({
      update: () => ({
        in: async (_col: string, ids: string[]) => {
          calls.updateIn.push(ids);
          return handlers.updateIn?.(ids) ?? { error: null };
        },
      }),
      delete: () => ({
        in: async (_col: string, ids: string[]) => {
          calls.deleteIn.push(ids);
          return handlers.deleteIn?.(ids) ?? { error: null };
        },
        eq: async (_col: string, id: string) => {
          calls.deleteEq.push(id);
          return handlers.deleteEq?.(id) ?? { error: null };
        },
      }),
    }),
  };
  return {
    supabase: supabase as unknown as SupabaseClient<Database>,
    calls,
  };
}

const records = [
  { id: "1", title: "Pale Ale" },
  { id: "2", title: "Stout" },
  { id: "3", title: "Lager" },
];

const FK_ERROR = { code: "23503", message: "violates foreign key constraint" };

describe("executeBulkDelete", () => {
  it("hard mode: a single bulk DELETE on the happy path", async () => {
    const { supabase, calls } = makeFakeSupabase({});
    const result = await executeBulkDelete(
      supabase,
      "recipes",
      "Recipe",
      records,
      "hard"
    );
    expect(result.deletedIds).toEqual(["1", "2", "3"]);
    expect(result.failures).toEqual([]);
    expect(calls.deleteIn).toEqual([["1", "2", "3"]]);
    expect(calls.deleteEq).toEqual([]);
  });

  it("hard mode: falls back to per-row deletes and reports each failure", async () => {
    const { supabase, calls } = makeFakeSupabase({
      deleteIn: () => ({ error: FK_ERROR }),
      deleteEq: (id) => (id === "2" ? { error: FK_ERROR } : { error: null }),
    });
    const result = await executeBulkDelete(
      supabase,
      "recipes",
      "Recipe",
      records,
      "hard"
    );
    expect(result.deletedIds).toEqual(["1", "3"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ id: "2", title: "Stout" });
    expect(result.failures[0].reason).toContain("referenced by other records");
    expect(calls.deleteEq).toEqual(["1", "2", "3"]);
  });

  it("soft mode: one bulk UPDATE, all ids reported deleted on success", async () => {
    const { supabase, calls } = makeFakeSupabase({});
    const result = await executeBulkDelete(
      supabase,
      "suppliers",
      "Supplier",
      records,
      "soft"
    );
    expect(result.deletedIds).toEqual(["1", "2", "3"]);
    expect(result.failures).toEqual([]);
    expect(calls.updateIn).toEqual([["1", "2", "3"]]);
    expect(calls.deleteIn).toEqual([]);
  });

  it("soft mode: a failed UPDATE reports every record with the same reason", async () => {
    const { supabase } = makeFakeSupabase({
      updateIn: () => ({ error: { message: "permission denied" } }),
    });
    const result = await executeBulkDelete(
      supabase,
      "suppliers",
      "Supplier",
      records,
      "soft"
    );
    expect(result.deletedIds).toEqual([]);
    expect(result.failures).toHaveLength(3);
    expect(new Set(result.failures.map((f) => f.reason)).size).toBe(1);
  });
});
