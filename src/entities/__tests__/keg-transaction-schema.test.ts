/**
 * Keg Transaction Schema Tests (audit finding 23)
 *
 * kegTransactionSchema derives from_state/to_state from transaction_type via
 * a z.preprocess step, because the state selects are hidden for most types
 * (showWhen) while keg_transactions.to_state is NOT NULL with per-type CHECK
 * constraints (00032_keg_transactions.sql). The derivation must hold for
 * EVERY entry point — the bare /inventory/kegs/transactions/new page (no URL
 * prefill), URL-prefilled flows, and mid-form type changes that leave stale
 * states from the previously selected type. These tests pin the parsed
 * output, which entity-detail-unified inserts verbatim.
 */

import { describe, it, expect } from "vitest";
import { kegTransactionSchema } from "@/entities/keg-transaction";

const FORMAT_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

/** Minimal valid base — what the bare /new form submits besides the type. */
const base = { selling_format_id: FORMAT_ID, quantity: 2 };

describe("kegTransactionSchema state derivation (per-type)", () => {
  it("fill: derives empty -> filled with no states supplied (bare /new page)", () => {
    const result = kegTransactionSchema.parse({
      ...base,
      transaction_type: "fill",
      batch_id: BATCH_ID,
    });
    expect(result.from_state).toBe("empty");
    expect(result.to_state).toBe("filled");
  });

  it("receive: derives null -> empty (from_state must be NULL per CHECK)", () => {
    const result = kegTransactionSchema.parse({
      ...base,
      transaction_type: "receive",
    });
    expect(result.from_state).toBeNull();
    expect(result.to_state).toBe("empty");
  });

  it.each([
    ["ship", "filled", "shipped"],
    ["return", "shipped", "returned_dirty"],
  ])("%s: derives %s -> %s", (type, from, to) => {
    const result = kegTransactionSchema.parse({
      ...base,
      transaction_type: type,
      customer_id: CUSTOMER_ID,
    });
    expect(result.from_state).toBe(from);
    expect(result.to_state).toBe(to);
  });

  it("clean: derives returned_dirty -> empty", () => {
    const result = kegTransactionSchema.parse({
      ...base,
      transaction_type: "clean",
    });
    expect(result.from_state).toBe("returned_dirty");
    expect(result.to_state).toBe("empty");
  });

  it("maintain/retire: forces to_state but preserves the user-picked from_state", () => {
    const maintain = kegTransactionSchema.parse({
      ...base,
      transaction_type: "maintain",
      from_state: "filled",
    });
    expect(maintain.from_state).toBe("filled");
    expect(maintain.to_state).toBe("maintenance");

    const retire = kegTransactionSchema.parse({
      ...base,
      transaction_type: "retire",
      from_state: "empty",
    });
    expect(retire.from_state).toBe("empty");
    expect(retire.to_state).toBe("retired");
  });

  it("adjust: keeps both user-picked states", () => {
    const result = kegTransactionSchema.parse({
      ...base,
      transaction_type: "adjust",
      from_state: "shipped",
      to_state: "filled",
    });
    expect(result.from_state).toBe("shipped");
    expect(result.to_state).toBe("filled");
  });

  it("adjust: defaults a blank to_state so the NOT NULL constraint can't trip", () => {
    const result = kegTransactionSchema.parse({
      ...base,
      transaction_type: "adjust",
    });
    expect(result.to_state).toBe("empty");
  });
});

describe("kegTransactionSchema mid-form type-change staleness", () => {
  it("overwrites stale states left behind by a previously selected type", () => {
    // User started a return (shipped -> returned_dirty via URL prefill), then
    // switched the type to ship: the stale states must not survive — the
    // valid_ship_transaction CHECK requires filled -> shipped.
    const result = kegTransactionSchema.parse({
      ...base,
      transaction_type: "ship",
      customer_id: CUSTOMER_ID,
      from_state: "shipped",
      to_state: "returned_dirty",
    });
    expect(result.from_state).toBe("filled");
    expect(result.to_state).toBe("shipped");
  });
});

describe("kegTransactionSchema existing refinements still apply post-derivation", () => {
  it("fill without batch or finished good fails", () => {
    const result = kegTransactionSchema.safeParse({
      ...base,
      transaction_type: "fill",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["batch_id"]);
    }
  });

  it("ship without a customer fails", () => {
    const result = kegTransactionSchema.safeParse({
      ...base,
      transaction_type: "ship",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["customer_id"]);
    }
  });
});

describe("kegTransactionSchema packaging session linkage (audit finding 39)", () => {
  it("accepts packaging_session_id on a fill", () => {
    const result = kegTransactionSchema.parse({
      ...base,
      transaction_type: "fill",
      batch_id: BATCH_ID,
      packaging_session_id: SESSION_ID,
    });
    expect(result.packaging_session_id).toBe(SESSION_ID);
  });
});
