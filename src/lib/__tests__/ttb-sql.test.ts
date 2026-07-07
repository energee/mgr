/**
 * TTB summary SQL regression tests (audit 2026-07-06, finding H2)
 *
 * Structural assertions on the latest migration definitions of the three
 * get_ttb_*_summary functions (00203). Pins the finished-goods volume
 * contract shared with the client-side computeUnitFillVolumeBbl
 * (src/domain/consumption-planning.ts):
 *
 *     per-FG-unit bbl = COALESCE(volume_bbl, volume_oz / 3968) x unit_count
 *
 * and the classification of taproom sales as taxpaid removals. These are
 * regulatory-grade contracts (TTB Form 5130.9) — a regression here is a
 * compliance bug, not a cosmetic one. See sql-def-helpers.ts for the idiom's
 * ceiling (structural, not DB-behavioral).
 */
import { describe, it, expect } from "vitest";
import { latestFunctionBody } from "./sql-def-helpers";

/** The shared per-unit volume expression both summaries must use. */
const FG_VOLUME_EXPR =
  /fg\.quantity \* COALESCE\(c\.volume_bbl, c\.volume_oz \/ 3968\.0\) \* sf\.unit_count/;

/** The broken pre-00203 expression (no unit_count, no keg volume_bbl). */
const BROKEN_VOLUME_EXPR = /fg\.quantity \* c\.volume_oz \/ 3968\.0/;

describe("get_ttb_inventory_summary volume math", () => {
  const body = latestFunctionBody("get_ttb_inventory_summary");

  it("is defined in a migration", () => {
    expect(body).not.toBeNull();
  });

  it("computes per-unit volume as COALESCE(volume_bbl, volume_oz/3968) x unit_count", () => {
    expect(body!).toMatch(FG_VOLUME_EXPR);
    expect(body!).not.toMatch(BROKEN_VOLUME_EXPR);
  });
});

describe("get_ttb_production_summary volume math", () => {
  const body = latestFunctionBody("get_ttb_production_summary");

  it("is defined in a migration", () => {
    expect(body).not.toBeNull();
  });

  it("computes per-unit volume as COALESCE(volume_bbl, volume_oz/3968) x unit_count", () => {
    expect(body!).toMatch(FG_VOLUME_EXPR);
    expect(body!).not.toMatch(BROKEN_VOLUME_EXPR);
  });
});

describe("get_ttb_removals_summary classification", () => {
  const body = latestFunctionBody("get_ttb_removals_summary");

  it("is defined in a migration", () => {
    expect(body).not.toBeNull();
  });

  it("counts taproom sales as taxpaid removals (domestic bucket)", () => {
    // taproom_sale must appear inside the taxpaid_domestic CASE arm — i.e.
    // before the export arm — not merely anywhere in the body.
    const domesticArm = body!.slice(0, body!.indexOf("taxpaid_export_bbl"));
    expect(domesticArm).toMatch(/destination_type = 'taproom_sale'/);
  });

  it("keeps taproom sales out of the tax-free samples bucket", () => {
    const samplesArm = body!.slice(
      body!.indexOf("taxpaid_export_bbl"),
      body!.indexOf("losses_bbl"),
    );
    expect(samplesArm).not.toMatch(/taproom_sale/);
  });
});
