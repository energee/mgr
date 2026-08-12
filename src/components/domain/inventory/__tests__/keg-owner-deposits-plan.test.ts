/**
 * Regression test for planDepositSave's blank-vs-zero handling.
 *
 * A blank field means "no override"; an explicit `0` is a legitimate,
 * distinct override that must be persisted (see the docblock on
 * planDepositSave for why deleting it silently reinstates a nonzero
 * deposit via the customer_keg_balances-family views' COALESCE fallback).
 */

import { describe, it, expect } from "vitest";
import { planDepositSave } from "../keg-owner-deposits-plan";

const KEG_OWNER_ID = "owner-1";
const FORMAT_ID = "format-1";

describe("planDepositSave", () => {
  it("upserts an explicit zero override instead of deleting it", () => {
    const { upserts, deletes } = planDepositSave(
      KEG_OWNER_ID,
      [FORMAT_ID],
      { [FORMAT_ID]: "0" },
      []
    );

    expect(deletes).toEqual([]);
    expect(upserts).toEqual([
      { keg_owner_id: KEG_OWNER_ID, selling_format_id: FORMAT_ID, deposit_amount: 0 },
    ]);
  });

  it("deletes an existing override when the field is cleared to blank", () => {
    const existing = [
      { id: "dep-1", keg_owner_id: KEG_OWNER_ID, selling_format_id: FORMAT_ID, deposit_amount: 10 },
    ];

    const { upserts, deletes } = planDepositSave(
      KEG_OWNER_ID,
      [FORMAT_ID],
      { [FORMAT_ID]: "" },
      existing
    );

    expect(upserts).toEqual([]);
    expect(deletes).toEqual(["dep-1"]);
  });

  it("upserts a positive value normally", () => {
    const { upserts, deletes } = planDepositSave(
      KEG_OWNER_ID,
      [FORMAT_ID],
      { [FORMAT_ID]: "15.50" },
      []
    );

    expect(deletes).toEqual([]);
    expect(upserts).toEqual([
      { keg_owner_id: KEG_OWNER_ID, selling_format_id: FORMAT_ID, deposit_amount: 15.5 },
    ]);
  });
});
