/**
 * squareSyncOutcome — how the Sync button reports a partial sync (#610).
 *
 * POST /api/square/sync deliberately returns 200 when the catalog leg succeeds
 * and the inventory leg fails, carrying the failure only as
 * `data.inventory.success === false`. Its one caller branched on `res.ok`
 * alone and fired `toast.success("Square sync completed")` over an inventory
 * push that never landed. This helper is the branch, extracted so it is
 * testable without mounting the settings page (the repo has no
 * @testing-library/react).
 */

import { describe, expect, it } from "vitest";
import { squareSyncOutcome } from "@/integrations/square/sync-outcome";

describe("squareSyncOutcome", () => {
  it("reports success when both legs land", () => {
    expect(
      squareSyncOutcome({
        catalog: { itemsSynced: 3 },
        inventory: { success: true, totalSynced: 4, totalFailed: 0, binsProcessed: 2 },
      }),
    ).toEqual({ level: "success", message: "Square sync completed" });
  });

  it("reports success for an inventory run with no work to do", () => {
    // binsProcessed 0 / totalFailed 0 is a clean no-op, not a failure.
    expect(
      squareSyncOutcome({
        catalog: { itemsSynced: 0 },
        inventory: { success: true, totalSynced: 0, totalFailed: 0, binsProcessed: 0 },
      }).level,
    ).toBe("success");
  });

  it("warns on a soft inventory failure (success false) instead of toasting success", () => {
    const outcome = squareSyncOutcome({
      catalog: { itemsSynced: 3 },
      inventory: { success: false, totalSynced: 0, totalFailed: 5, binsProcessed: 1 },
    });
    expect(outcome.level).toBe("warning");
    expect(outcome.message).toContain("inventory");
    expect(outcome.message).toContain("5");
  });

  it("warns when items failed even though success was reported true", () => {
    expect(
      squareSyncOutcome({
        catalog: {},
        inventory: { success: true, totalSynced: 2, totalFailed: 1, binsProcessed: 1 },
      }).level,
    ).toBe("warning");
  });

  it("warns and surfaces the message from the combined route's partial-success shape", () => {
    const outcome = squareSyncOutcome({
      catalog: { itemsSynced: 1 },
      inventory: { success: false, error: "boom" },
    });
    expect(outcome.level).toBe("warning");
    expect(outcome.message).toContain("boom");
  });

  it("warns when the inventory leg is missing entirely", () => {
    expect(squareSyncOutcome({ catalog: {} }).level).toBe("warning");
    expect(squareSyncOutcome(undefined).level).toBe("warning");
  });
});
