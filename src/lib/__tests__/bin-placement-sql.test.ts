/**
 * Characterization tests for the 00219 bin-placement trigger
 * (audit 2026-07-10, finding TC-3 (a) and (c); backlog item 24).
 *
 * WHAT THESE ARE
 *   CHARACTERIZATION, not validation. They record what
 *   `place_finished_good_in_bin()` and its trigger currently DO — including
 *   two behaviours the audit flagged as known-unfixed. Each such assertion is
 *   marked `KNOWN-IMPERFECT` below. Do not read those as "this is correct";
 *   read them as "if you change this, change it deliberately". A future
 *   refactor that alters placement semantics must fail here first.
 *
 * WHY THEY ARE SQL-TEXT ASSERTIONS
 *   The vitest tier has no Postgres. The DB layer's only behavioural check is
 *   the self-rolling-back DO block inside the migration itself, which runs
 *   once at apply time and cannot regression-guard anything afterwards. So
 *   these follow the established structural idiom (see sql-def-helpers.ts,
 *   ttb-sql.test.ts, analyze-batch-performance.test.ts): parse the migration
 *   chain, assert on the LATEST definition. Ceiling of the idiom: it pins the
 *   *text* of the contract, not its runtime effect. Upgrade to the live-Postgres
 *   tier (vitest.integration.config.ts, backlog item 21) when fixtures exist —
 *   at which point these become the cheap first line, not the only line.
 */
import { describe, it, expect } from "vitest";
import { latestFunctionBody, migrationsMatching } from "./sql-def-helpers";

const body = latestFunctionBody("place_finished_good_in_bin");

describe("place_finished_good_in_bin (00219) — keg-skip guard", () => {
  it("is defined in the migration chain", () => {
    expect(body).not.toBeNull();
  });

  it("detects kegs canonically via selling_formats -> containers.type", () => {
    // The one sanctioned keg test in this schema (cf. 00183/00207/00221).
    // A cheaper-looking shortcut (e.g. a name/LIKE match, or a column on
    // finished_goods) would silently change which rows get placed.
    expect(body!).toMatch(/SELECT \(c\.type = 'keg'\)/);
    expect(body!).toMatch(/FROM selling_formats sf\s*\n\s*JOIN containers c ON c\.id = sf\.container_id/);
    expect(body!).toMatch(/WHERE sf\.id = NEW\.selling_format_id/);
  });

  it("returns without placing when the FG is a keg", () => {
    expect(body!).toMatch(/IF COALESCE\(v_is_keg, false\) THEN\s*\n\s*RETURN NEW;/);
  });

  it("KNOWN-IMPERFECT: a NULL selling_format_id FG is treated as NON-keg and IS placed", () => {
    // The keg probe returns no row when selling_format_id is NULL, leaving
    // v_is_keg NULL; COALESCE(..., false) then routes the FG down the
    // placement path. That is deliberate for external/manual FGs, but it is
    // the exact opposite of how 00221/00226's sellable_inventory treats the
    // same row: there the INNER JOIN on selling_formats DROPS it (see
    // sellable-inventory-sql.test.ts). So a NULL-format FG can be written
    // into bin_inventory and then never appear as sellable — stock that is
    // counted in the bin UI but invisible to the POS. Pinned as-is; the fix
    // belongs in one place, and picking which place is a product decision.
    expect(body!).toMatch(/COALESCE\(v_is_keg, false\)/);
    expect(body!).not.toMatch(/NEW\.selling_format_id IS NULL/);
  });
});

describe("place_finished_good_in_bin (00219) — bin resolution order", () => {
  it("resolves the packaging session's default_bin_id first", () => {
    expect(body!).toMatch(/IF NEW\.session_line_item_id IS NOT NULL THEN/);
    expect(body!).toMatch(/SELECT ps\.default_bin_id/);
    expect(body!).toMatch(/JOIN packaging_sessions ps ON ps\.id = sli\.session_id/);
  });

  it("falls back to a location-level is_default_fg bin only when the first resolution yielded NULL", () => {
    expect(body!).toMatch(/IF v_bin_id IS NULL THEN[\s\S]*?WHERE b\.is_default_fg AND b\.is_active/);
  });

  it("KNOWN-IMPERFECT: the fallback is LOCATION-BLIND — it picks the primary location's bin regardless of where the FG was produced", () => {
    // TC-3 (a). finished_goods carries no location column, and neither do
    // packaging_sessions / session_line_items, so the fallback has no FG-side
    // location to filter on. It orders by "primary location first, then oldest"
    // and takes one row. Consequence: an FG produced at a satellite location
    // with no session default_bin_id lands in the PRIMARY location's default
    // bin — physically wrong, and it shows up as sellable at a location that
    // does not have it. The assertion below pins the absence of any
    // FG-derived location predicate; delete it only alongside a real fix.
    expect(body!).toMatch(
      /ORDER BY \(l\.is_primary IS TRUE\) DESC, l\.created_at\s*\n\s*LIMIT 1;/,
    );
    const start = body!.indexOf("FROM bins b");
    const fallback = body!.slice(start, body!.indexOf("LIMIT 1;", start));
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback).not.toMatch(/NEW\./);
    expect(fallback).not.toMatch(/location_id\s*=/);
  });
});

describe("place_finished_good_in_bin (00219) — never-block contract", () => {
  it("NOTICEs and returns when no bin can be resolved, rather than raising", () => {
    expect(body!).toMatch(/RAISE NOTICE 'place_finished_good_in_bin: finished_good % not placed/);
    expect(body!).toMatch(/RAISE NOTICE[\s\S]*?RETURN NEW;/);
  });

  it("KNOWN-IMPERFECT: contains no RAISE EXCEPTION at all, so an unplaceable FG fails SILENTLY", () => {
    // TC-3 (a), second half. The never-block decision is intentional (a brewer
    // must never be hard-blocked by missing bin config), but the cost is that
    // an FG can permanently miss bin_inventory with nothing surfaced to the
    // app: no error, no flag column, only a server-log NOTICE nobody reads.
    // Such stock is then invisible to the per-bin Square sync. Pinned so that
    // any future attempt to make placement blocking, or to surface the miss,
    // is a conscious edit here.
    expect(body!).not.toMatch(/RAISE EXCEPTION/);
    expect(body!).not.toMatch(/RAISE WARNING/);
  });

  it("places the FG's insert-time quantity and no-ops on an existing (fg, bin) row", () => {
    expect(body!).toMatch(
      /INSERT INTO bin_inventory \(finished_good_id, bin_id, quantity\)\s*\n\s*VALUES \(NEW\.id, v_bin_id, NEW\.quantity\)\s*\n\s*ON CONFLICT \(finished_good_id, bin_id\) DO NOTHING;/,
    );
  });
});

describe("on_finished_good_place_in_bin trigger (00219)", () => {
  const creators = migrationsMatching(
    /CREATE TRIGGER on_finished_good_place_in_bin/,
  );

  it("is created by exactly one migration (00219) — self-invalidates if superseded", () => {
    // If a later migration re-creates the trigger, this fails and forces the
    // rest of this file to be re-pointed at the new definition.
    expect(creators.map((c) => c.file)).toEqual(["00219_bin_placement.sql"]);
  });

  it("fires AFTER INSERT ON finished_goods FOR EACH ROW", () => {
    expect(creators[0].sql).toMatch(
      /CREATE TRIGGER on_finished_good_place_in_bin\s*\n\s*AFTER INSERT ON finished_goods\s*\n\s*FOR EACH ROW/,
    );
  });

  it("KNOWN-IMPERFECT: has no WHEN clause, so it fires for EVERY finished_goods insert", () => {
    // TC-3 (c). Every FG insert — kegs, zero-quantity rows, external/manual
    // rows — pays for the selling_formats -> containers probe before the
    // function decides to do nothing. A `WHEN (NEW.quantity > 0)` (or a
    // keg-excluding WHEN) would short-circuit in the executor. This is a
    // performance/clarity smell rather than a correctness bug, and it is
    // pinned only so that adding a WHEN clause is a deliberate change with a
    // test to update: a WHEN clause also silently changes which rows the
    // function ever sees.
    const stmt = creators[0].sql.match(
      /CREATE TRIGGER on_finished_good_place_in_bin[\s\S]*?;/,
    )![0];
    expect(stmt).not.toMatch(/\bWHEN\b/);
    expect(stmt).toMatch(/EXECUTE FUNCTION place_finished_good_in_bin\(\);/);
  });
});

describe("00219 — no backfill of pre-existing finished goods", () => {
  it("KNOWN-IMPERFECT: adds no INSERT INTO bin_inventory ... SELECT backfill", () => {
    // Header decision A6: existing finished_goods are NOT backfilled, so every
    // FG created before 00219 is permanently unplaced (and thus absent from
    // sellable_inventory's packaged branch) until something re-touches it.
    // Intentional — a blind backfill would have to invent a bin per historical
    // FG — but it means bin_inventory is NOT a complete picture of packaged
    // stock, and no code should assume it is.
    const m = migrationsMatching(/CREATE OR REPLACE FUNCTION place_finished_good_in_bin/);
    expect(m).toHaveLength(1);
    expect(m[0].sql).not.toMatch(/INSERT INTO bin_inventory[\s\S]{0,200}\bSELECT\b/);
  });
});
