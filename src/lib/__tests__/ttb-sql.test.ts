/**
 * TTB summary SQL regression tests (audits 2026-07-06 H2, 2026-07-10 BD-1,
 * issue #603)
 *
 * Structural assertions on the latest migration definitions of the three
 * get_ttb_*_summary functions (00203 volume math, 00237 period keying, 00274
 * cellar removals).
 * Pins the finished-goods volume contract shared with the client-side
 * computeUnitFillVolumeBbl (src/domain/consumption-planning.ts):
 *
 *     per-FG-unit bbl = COALESCE(volume_bbl, volume_oz / 3968) x unit_count
 *
 * the classification of taproom sales as taxpaid removals, and the period
 * attribution of completed allocations: removals AND begin/end inventory must
 * key on COALESCE(a.completed_at, a.created_at) — completed_at is stamped at
 * order fulfillment, so a June-reserved/July-fulfilled removal reports in
 * July, not in June's possibly-filed month (BD-1). These are regulatory-grade
 * contracts (TTB Form 5130.9) — a regression here is a compliance bug, not a
 * cosmetic one. See sql-def-helpers.ts for the idiom's ceiling (structural,
 * not DB-behavioral).
 */
import { describe, it, expect } from "vitest";
import { latestFunctionBody } from "./sql-def-helpers";

/** The shared per-unit volume expression both summaries must use. */
const FG_VOLUME_EXPR =
  /fg\.quantity \* COALESCE\(c\.volume_bbl, c\.volume_oz \/ 3968\.0\) \* sf\.unit_count/;

/** The broken pre-00203 expression (no unit_count, no keg volume_bbl). */
const BROKEN_VOLUME_EXPR = /fg\.quantity \* c\.volume_oz \/ 3968\.0/;

/**
 * The 00237 period key for completed allocations: when the removal happened
 * (completed_at, stamped at fulfillment), falling back to created_at for
 * legacy rows completed before the stamp existed.
 */
const ALLOC_PERIOD_KEY = /COALESCE\(a\.completed_at, a\.created_at\)/g;

/** The broken pre-00237 keying (allocation-creation month, BD-1). */
const BROKEN_PERIOD_KEY = /AND a\.created_at [<>]/;

/**
 * The pre-00274 source narrowing (#603): it dropped every batch-sourced
 * removal — i.e. every cellar loss — before the losses_bbl arm saw it. Does
 * not collide with the CTE's `LEFT JOIN ... ON a.source_type = 'finished_good'`
 * (that occurrence is preceded by `ON`, not `AND`).
 */
const BROKEN_SOURCE_NARROWING = /AND a\.source_type = 'finished_good'/;

describe("get_ttb_inventory_summary volume math", () => {
  const body = latestFunctionBody("get_ttb_inventory_summary");

  it("is defined in a migration", () => {
    expect(body).not.toBeNull();
  });

  it("computes per-unit volume as COALESCE(volume_bbl, volume_oz/3968) x unit_count", () => {
    expect(body!).toMatch(FG_VOLUME_EXPR);
    expect(body!).not.toMatch(BROKEN_VOLUME_EXPR);
  });

  it("keys BOTH begin (alloc_before) and end (alloc_end) allocation terms on COALESCE(completed_at, created_at)", () => {
    // One occurrence per boundary; keying only one side would silently break
    // the begin + produced - removed = end identity.
    expect(body!.match(ALLOC_PERIOD_KEY)?.length).toBe(2);
    expect(body!).not.toMatch(BROKEN_PERIOD_KEY);
  });
});

describe("get_ttb_inventory_summary in-process period keying (issue #618)", () => {
  const body = latestFunctionBody("get_ttb_inventory_summary");

  it("derives the in-process terms from batch status HISTORY, not the live batches table", () => {
    // Pre-00286, ip_ending summed `batches.volume_bbl WHERE status IN (...)`
    // with no date filter at all — a live snapshot, so re-running a closed
    // month returned a different number every time a batch changed status.
    // The period-keyed definition reconstructs status at the period boundaries
    // from entity_revisions and must not read batches' current status at all.
    expect(body!).toMatch(/entity_revisions/);
    expect(body!).toMatch(/entity_type = 'batches'/);
    expect(body!).not.toMatch(/FROM batches/);
  });

  it("keys ip_beginning on period_start and ip_ending on period_end", () => {
    // One boundary reconstruction per term. Both filter revision history by
    // changed_at strictly before the boundary, which is also what guarantees
    // a month's in_process_ending equals the next month's in_process_beginning.
    expect(body!).toMatch(/r\.changed_at < pd\.period_start/);
    expect(body!).toMatch(/r\.changed_at < pd\.period_end_ts/);
  });

  it("counts a batch by its RECORDED status at the boundary, latest revision winning", () => {
    expect(body!).toMatch(/DISTINCT ON \(r\.entity_id\)/);
    expect(body!).toMatch(/new_data->>'status'/);
    expect(body!).toMatch(/'fermenting',\s*'conditioning',\s*'packaging'/);
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

  it("buckets removals by COALESCE(completed_at, created_at), not created_at (BD-1)", () => {
    // Both period boundaries (>= start, < end) must use the completed_at-first
    // key, matching the inventory summary's alloc terms, so a removal leaves
    // inventory in exactly the month it is reported as removed.
    expect(body!.match(ALLOC_PERIOD_KEY)?.length).toBe(2);
    expect(body!).not.toMatch(BROKEN_PERIOD_KEY);
  });

  // --- issue #603: batch-sourced (cellar) removals -------------------------
  // Behavioral coverage lives in
  // src/__tests__/integration/ttb-removals-batch-losses.test.ts (real
  // Postgres, runs in the db-lint workflow). These structural assertions are
  // the fast gate that keeps the contract from being dropped by the next
  // rewrite of this function — the 'finished_good' narrowing survived four.

  it("admits batch-sourced removals, not just finished goods (#603)", () => {
    // Every cellar-loss writer emits source_type='batch' (recordBatchLoss,
    // archive_batch, transition_entity_atomic's completion reconciliation).
    // Narrowed to finished goods, losses_bbl was structurally 0.00.
    expect(body!).toMatch(/a\.source_type IN \('finished_good', 'batch'\)/);
    expect(body!).not.toMatch(BROKEN_SOURCE_NARROWING);
  });

  it("classifies batch-sourced removals as cellar, never bottled (#603)", () => {
    // Load-bearing: get_ttb_tax_class(NULL) returns 'bottled' via its ELSE
    // branch, so without this arm batch rows are misfiled as packaged-beer
    // removals instead of cellar ones.
    expect(body!).toMatch(/WHEN a\.source_type = 'batch' THEN 'cellar'/);
  });

  it("excludes internal batch movements from removals (#603)", () => {
    // Packaging (destination 'finished_good') already leaves the cellar via
    // the production/packaging terms; 'transfer' and 'batch' are inter-vessel
    // moves and blends. Counting them would debit the cellar twice.
    expect(body!).toMatch(
      /a\.destination_type IN \('finished_good', 'transfer', 'batch'\)/,
    );
  });
});
