/** Operator messaging for ambiguous QuickBooks remote/local outcomes. */
import { describe, expect, it } from "vitest";
import { parseQBOError } from "../qbo-sync-section";

describe("parseQBOError", () => {
  it("distinguishes a remote success that needs local mapping reconciliation", () => {
    const result = parseQBOError(
      "QuickBooks accepted Invoice I-9, but MGR could not save its mapping. " +
        "The remote document exists; retry sync to reconcile it safely."
    );

    expect(result.friendly).toBe(
      "QuickBooks saved the document, but MGR could not save its link. Retry Sync to reconcile it safely."
    );
  });

  it("keeps the generic fallback for unrelated failures", () => {
    expect(parseQBOError("unexpected failure").friendly).toBe(
      "Sync failed. Check the sync log for details."
    );
  });
});
