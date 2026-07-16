/** Operator messaging for ambiguous QuickBooks remote/local outcomes. */
import { describe, expect, it } from "vitest";
import { parseQBOError } from "../qbo-sync-section";

describe("parseQBOError", () => {
  it("distinguishes a remote success that needs local mapping reconciliation", () => {
    const result = parseQBOError(
      "QuickBooks accepted Invoice I-9, but MGR could not save its mapping. " +
        "The remote document exists; retry sync to reconcile it safely."
    );

    expect(result.friendly).toContain("WITHOUT editing this record first");
    expect(result.friendly).toContain(
      "edits made before reconciling will not reach QuickBooks on the retry"
    );
  });

  it("keeps the generic fallback for unrelated failures", () => {
    expect(parseQBOError("unexpected failure").friendly).toBe(
      "Sync failed. Check the sync log for details."
    );
  });
});
