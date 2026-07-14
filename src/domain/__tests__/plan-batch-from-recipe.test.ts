/**
 * Tests for preparePlanBatchPrefill (recipe "Plan Batch" entry points):
 * derives the "{brand} - {recipe}" batch name and volume from
 * batch_size_bbl, stages them in the prefill store for
 * /production/batches/new to consume, and degrades gracefully when the
 * recipe has no brand / no batch size or the brand lookup fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingle = vi.fn();
const createClient = vi.fn(() => ({
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle })),
    })),
  })),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => createClient(),
}));

import {
  preparePlanBatchPrefill,
  NEW_BATCH_PATH,
} from "@/domain/plan-batch-from-recipe";
import { usePrefillStore } from "@/contexts/prefill-store";

beforeEach(() => {
  vi.clearAllMocks();
  // Drain any staged prefill from a previous test
  usePrefillStore.getState().consume();
});

describe("preparePlanBatchPrefill", () => {
  it("stages brand-prefixed name, recipe_id and volume, and returns the create route", async () => {
    maybeSingle.mockResolvedValue({ data: { name: "Coastal" }, error: null });

    const url = await preparePlanBatchPrefill({
      id: "r-1",
      name: "Hazy IPA",
      brand_id: "b-1",
      batch_size_bbl: 15,
    });

    expect(url).toBe(NEW_BATCH_PATH);
    expect(usePrefillStore.getState().consume().prefillData).toEqual({
      recipe_id: "r-1",
      name: "Coastal - Hazy IPA",
      volume_bbl: 15,
    });
  });

  it("uses the bare recipe name and skips the brand fetch when brand_id is null", async () => {
    await preparePlanBatchPrefill({
      id: "r-2",
      name: "Pilsner",
      brand_id: null,
      batch_size_bbl: 10,
    });

    expect(createClient).not.toHaveBeenCalled();
    expect(usePrefillStore.getState().consume().prefillData).toEqual({
      recipe_id: "r-2",
      name: "Pilsner",
      volume_bbl: 10,
    });
  });

  it("falls back to the recipe name when the brand lookup returns nothing", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    await preparePlanBatchPrefill({
      id: "r-3",
      name: "Stout",
      brand_id: "b-gone",
      batch_size_bbl: 8,
    });

    expect(usePrefillStore.getState().consume().prefillData).toEqual({
      recipe_id: "r-3",
      name: "Stout",
      volume_bbl: 8,
    });
  });

  it("omits volume_bbl when the recipe has no batch size", async () => {
    await preparePlanBatchPrefill({
      id: "r-4",
      name: "Saison",
      brand_id: null,
      batch_size_bbl: null,
    });

    expect(usePrefillStore.getState().consume().prefillData).toEqual({
      recipe_id: "r-4",
      name: "Saison",
    });
  });
});
