/**
 * Characterization tests for domain/ai/recipe-analyzer.ts
 *
 * Pins current behavior of the two thin RPC wrappers `analyzeStyleCompliance`
 * and `getRecipeSuggestions`. Both take a `SupabaseClient` as a parameter, so
 * no module mocking is needed -- a tiny fake `{ rpc }` object suffices (same
 * parameter-injection pattern as src/domain/__tests__/report-utils.test.ts).
 * Node env (no jsdom): pure async logic, no DOM.
 */

import { describe, it, expect, vi } from "vitest";
import {
  analyzeStyleCompliance,
  getRecipeSuggestions,
} from "../recipe-analyzer";

// Minimal fake matching only the surface these functions touch: `.rpc()`.
// Cast through `unknown` because the real signature is the full SupabaseClient.
function fakeSupabase(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as Parameters<typeof analyzeStyleCompliance>[0];
}

describe("analyzeStyleCompliance", () => {
  it("calls the analyze_recipe_style_compliance RPC with the recipe id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { overall_compliance: true }, error: null });
    await analyzeStyleCompliance(fakeSupabase(rpc), "recipe-1");
    expect(rpc).toHaveBeenCalledWith("analyze_recipe_style_compliance", {
      p_recipe_id: "recipe-1",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("returns the RPC data unchanged on success", async () => {
    const payload = { recipe_id: "recipe-1", overall_compliance: false };
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null });
    const result = await analyzeStyleCompliance(fakeSupabase(rpc), "recipe-1");
    expect(result).toBe(payload);
  });

  it("throws a wrapped Error with the RPC error message when the call fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "no such recipe" } });
    await expect(analyzeStyleCompliance(fakeSupabase(rpc), "bad")).rejects.toThrow(
      "Failed to analyze recipe: no such recipe",
    );
  });

  it("QUIRK: returns null data as-is (no shape validation despite the cast)", async () => {
    // The `data as unknown as StyleComplianceResult` cast does not guard against
    // null -- a successful RPC that resolves `data: null` returns null.
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const result = await analyzeStyleCompliance(fakeSupabase(rpc), "recipe-1");
    expect(result).toBeNull();
  });
});

describe("getRecipeSuggestions", () => {
  it("calls the suggest_recipe_improvements RPC with the recipe id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { suggestion_count: 0, suggestions: [] }, error: null });
    await getRecipeSuggestions(fakeSupabase(rpc), "recipe-9");
    expect(rpc).toHaveBeenCalledWith("suggest_recipe_improvements", {
      p_recipe_id: "recipe-9",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("returns the RPC data unchanged on success", async () => {
    const payload = { recipe_id: "recipe-9", suggestion_count: 1, suggestions: [] };
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null });
    const result = await getRecipeSuggestions(fakeSupabase(rpc), "recipe-9");
    expect(result).toBe(payload);
  });

  it("throws a wrapped Error with the RPC error message when the call fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "rpc boom" } });
    await expect(getRecipeSuggestions(fakeSupabase(rpc), "recipe-9")).rejects.toThrow(
      "Failed to get suggestions: rpc boom",
    );
  });

  it("QUIRK: returns null data as-is (no shape validation despite the cast)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const result = await getRecipeSuggestions(fakeSupabase(rpc), "recipe-9");
    expect(result).toBeNull();
  });
});
