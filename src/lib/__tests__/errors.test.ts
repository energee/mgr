/**
 * Tests for the friendly Postgres-error layer (src/lib/errors.ts):
 * field-aware unique-violation parsing (parsePostgresErrorDetailed),
 * unknown-error normalization for catch blocks (parseUnknownError), and the
 * curated CONSTRAINT_MESSAGES entries users actually hit.
 *
 * Baseline parsePostgresError behavior is covered in api-utils.test.ts; this
 * file focuses on the detailed/unknown variants added for the universal
 * save/transition/delete error paths.
 */

import { describe, it, expect } from "vitest";

import {
  parsePostgresError,
  parsePostgresErrorDetailed,
  parseUnknownError,
  CONSTRAINT_MESSAGES,
} from "../errors";
import type { PostgrestError } from "@supabase/supabase-js";

/** Create a minimal PostgrestError object for testing. */
function makePostgresError(
  code: string,
  message = "test error",
  details = "",
  hint = ""
): PostgrestError {
  return { code, message, details, hint, name: "PostgrestError" };
}

// =============================================================================
// parsePostgresErrorDetailed
// =============================================================================

describe("parsePostgresErrorDetailed", () => {
  it("extracts the column and value from a unique-violation details string", () => {
    const error = makePostgresError(
      "23505",
      'duplicate key value violates unique constraint "some_unknown_key"',
      "Key (sku)=(SKU-001) already exists."
    );
    const parsed = parsePostgresErrorDetailed(error);
    expect(parsed.field).toBe("sku");
    expect(parsed.message).toBe('"SKU-001" is already in use');
  });

  it("uses the curated constraint message AND extracts the field for known unique constraints", () => {
    const error = makePostgresError(
      "23505",
      'duplicate key value violates unique constraint "purchase_orders_po_number_key"',
      "Key (po_number)=(PO-2025-001) already exists."
    );
    const parsed = parsePostgresErrorDetailed(error);
    expect(parsed.field).toBe("po_number");
    expect(parsed.message).toBe("This PO number is already in use");
  });

  it("returns no field for composite unique keys", () => {
    const error = makePostgresError(
      "23505",
      'duplicate key value violates unique constraint "some_composite_key"',
      "Key (batch_id, reading_date)=(abc, 2025-01-01) already exists."
    );
    const parsed = parsePostgresErrorDetailed(error);
    expect(parsed.field).toBeUndefined();
    expect(parsed.message).toBe("A record with this value already exists");
  });

  it("returns no field when details are missing", () => {
    const error = makePostgresError("23505", "duplicate key value");
    const parsed = parsePostgresErrorDetailed(error);
    expect(parsed.field).toBeUndefined();
    expect(parsed.message).toBe("A record with this value already exists");
  });

  it("returns no field for check violations", () => {
    const error = makePostgresError(
      "23514",
      'violates check constraint "chk_quantity_positive"'
    );
    const parsed = parsePostgresErrorDetailed(error);
    expect(parsed.field).toBeUndefined();
    expect(parsed.message).toBe("Quantity must be greater than zero");
  });

  it("maps keg transaction check constraints to friendly messages", () => {
    const error = makePostgresError(
      "23514",
      'new row for relation "keg_transactions" violates check constraint "valid_fill_transaction"'
    );
    const parsed = parsePostgresErrorDetailed(error);
    expect(parsed.message).toBe(CONSTRAINT_MESSAGES.valid_fill_transaction);
  });
});

// =============================================================================
// parsePostgresError (string variant) stays consistent with detailed parsing
// =============================================================================

describe("parsePostgresError (with unique-violation details)", () => {
  it("names the colliding value for unknown unique constraints", () => {
    const error = makePostgresError(
      "23505",
      'duplicate key value violates unique constraint "recipes_name_key"',
      "Key (name)=(West Coast IPA) already exists."
    );
    expect(parsePostgresError(error)).toBe(
      '"West Coast IPA" is already in use'
    );
  });

  it("returns the curated message for orders_order_number_key", () => {
    const error = makePostgresError(
      "23505",
      'duplicate key value violates unique constraint "orders_order_number_key"',
      "Key (order_number)=(ORD-001) already exists."
    );
    expect(parsePostgresError(error)).toBe("This order number is already in use");
  });
});

// =============================================================================
// parseUnknownError
// =============================================================================

describe("parseUnknownError", () => {
  it("parses PostgrestError-shaped objects (code present)", () => {
    const parsed = parseUnknownError({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "batches_batch_number_key"',
      details: "Key (batch_number)=(BATCH-042) already exists.",
      hint: "",
    });
    expect(parsed.message).toBe("This batch number is already in use");
    expect(parsed.field).toBe("batch_number");
  });

  it("passes plain Error messages through verbatim", () => {
    const parsed = parseUnknownError(
      new Error("Status changed by someone else — refresh and try again")
    );
    expect(parsed.message).toBe(
      "Status changed by someone else — refresh and try again"
    );
    expect(parsed.field).toBeUndefined();
  });

  it("translates RLS errors carried by objects with a code", () => {
    const parsed = parseUnknownError({
      code: "42501",
      message: "permission denied for table batches",
    });
    expect(parsed.message).toBe(
      "You don't have permission to perform this action"
    );
  });

  it("uses a message property on non-Error objects", () => {
    const parsed = parseUnknownError({ message: "Network request failed" });
    expect(parsed.message).toBe("Network request failed");
  });

  it("falls back to a generic message for unrecognizable values", () => {
    expect(parseUnknownError(undefined).message).toBe(
      "An unexpected error occurred"
    );
    expect(parseUnknownError("boom").message).toBe(
      "An unexpected error occurred"
    );
    expect(parseUnknownError({ message: "" }).message).toBe(
      "An unexpected error occurred"
    );
  });
});

// =============================================================================
// CONSTRAINT_MESSAGES coverage for the constraints users actually hit
// =============================================================================

describe("CONSTRAINT_MESSAGES", () => {
  it("covers the hand-typed unique number constraints", () => {
    expect(CONSTRAINT_MESSAGES.purchase_orders_po_number_key).toBeTruthy();
    expect(CONSTRAINT_MESSAGES.orders_order_number_key).toBeTruthy();
    expect(CONSTRAINT_MESSAGES.batches_batch_number_key).toBeTruthy();
    expect(CONSTRAINT_MESSAGES.brew_logs_brew_number_key).toBeTruthy();
  });

  it("covers all keg_transactions state-transition checks (migration 00032)", () => {
    for (const name of [
      "valid_fill_transaction",
      "valid_ship_transaction",
      "valid_return_transaction",
      "valid_clean_transaction",
      "valid_receive_transaction",
      "valid_retire_transaction",
      "valid_maintain_transaction",
    ]) {
      expect(CONSTRAINT_MESSAGES[name]).toBeTruthy();
    }
  });
});
