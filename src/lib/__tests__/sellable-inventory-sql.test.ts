/**
 * Characterization tests for the sellable_inventory read model
 * (00221, packaged quantity clamped in 00226).
 * Audit 2026-07-10 finding TC-3 (b); backlog item 24.
 *
 * WHAT THESE ARE
 *   CHARACTERIZATION, not validation. The `KNOWN-IMPERFECT` cases below pin
 *   behaviour the audit flagged and nobody has fixed — most importantly the
 *   packaged branch's INNER JOIN onto selling_formats, which silently DROPS
 *   finished goods with a NULL selling_format_id from the POS's view of stock.
 *   The assertions document the current semantics so a refactor cannot change
 *   them by accident; they do not bless them as right.
 *
 * WHY SQL-TEXT
 *   Same ceiling as bin-placement-sql.test.ts / ttb-sql.test.ts: no Postgres
 *   in the vitest tier, so these parse the migration chain and assert on the
 *   latest definition (sql-def-helpers.ts). Structural, not behavioural —
 *   TC-2's seeded receive->fill->ship round-trip is the real test and belongs
 *   in the live-Postgres tier (backlog item 21).
 */
import { describe, it, expect } from "vitest";
import { migrationsMatching } from "./sql-def-helpers";

/** The migrations that define the view, in apply order; the last one wins. */
const definers = migrationsMatching(
  /CREATE OR REPLACE VIEW public\.sellable_inventory/,
);

/**
 * The latest view body.
 *
 * NOT `latestViewBody()` from sql-def-helpers: that helper terminates the
 * body at the first `;`, and 00226's inline `-- ponytail:` comment contains
 * one ("this only fixes the READ path; the bin counter ..."), which truncates
 * the body before the keg branch. Slicing to the trailing `COMMENT ON VIEW`
 * is exact for this statement. (Left as a local workaround rather than a
 * change to the shared helper, which other suites depend on.)
 */
function latestBody(): string {
  const sql = definers[definers.length - 1].sql;
  const start = sql.indexOf("CREATE OR REPLACE VIEW public.sellable_inventory");
  const end = sql.indexOf("COMMENT ON VIEW sellable_inventory", start);
  return sql.slice(start, end);
}

const body = latestBody();

describe("sellable_inventory — definition provenance", () => {
  it("is defined in the migration chain", () => {
    expect(definers.length).toBeGreaterThan(0);
    expect(body).toContain("CREATE OR REPLACE VIEW public.sellable_inventory");
  });

  it("was introduced by 00221 and last redefined by 00226 — self-invalidates if superseded", () => {
    // A later redefinition must fail this test, forcing the rest of the file
    // to be re-read against the new body rather than passing on stale text.
    expect(definers.map((d) => d.file)).toEqual([
      "00221_sellable_inventory_view.sql",
      "00226_bin_inventory_integrity.sql",
    ]);
  });

  it("runs with the caller's RLS (security_invoker)", () => {
    const latest = definers[definers.length - 1].sql;
    expect(latest).toMatch(
      /CREATE OR REPLACE VIEW public\.sellable_inventory\s*\n\s*WITH \(security_invoker = true\) AS/,
    );
  });
});

describe("sellable_inventory — packaged branch", () => {
  it("KNOWN-IMPERFECT: INNER-JOINs selling_formats, so a NULL-selling_format_id FG is silently EXCLUDED", () => {
    // TC-3 (b). The join exists only to reach containers.type for the keg
    // guard, but because it is an INNER JOIN it doubles as a filter: a
    // finished good with no selling_format_id never reaches the output, even
    // though 00219's placement trigger DOES write it into bin_inventory
    // (it treats a NULL format as non-keg — see bin-placement-sql.test.ts).
    // Net effect: such stock is counted in the bin UI and invisible to the
    // POS/Square sync, with no error anywhere. A LEFT JOIN with an explicit
    // `c.type IS DISTINCT FROM 'keg'` would include it; that is a product
    // decision, not a mechanical fix, so the current behaviour is pinned.
    expect(body).toMatch(/JOIN selling_formats sf ON sf\.id = fg\.selling_format_id/);
    expect(body).not.toMatch(/LEFT JOIN selling_formats/);
    expect(body).toMatch(/JOIN containers c\s+ON c\.id\s+= sf\.container_id/);
    expect(body).not.toMatch(/LEFT JOIN containers/);
  });

  it("excludes keg containers (the double-count guard)", () => {
    // Kegs are never written to bin_inventory by 00219, so this is
    // belt-and-suspenders; it is also the only thing standing between a
    // stray keg row in bin_inventory and a double count against branch (b).
    expect(body).toMatch(/WHERE c\.type <> 'keg'/);
  });

  it("clamps the reported quantity to ledger availability (00226)", () => {
    // The bin counter is decremented ONLY by the Square-sale path
    // (debit_bin_inventory), so order fulfilment / samples / losses /
    // quick-depletion — which write allocations, not the bin — would leave
    // the POS over-reporting. LEAST(bin, ledger) caps that on the READ path.
    expect(body).toMatch(
      /LEAST\(bi\.quantity, GREATEST\(0, fga\.available_quantity\)\)::integer AS quantity/,
    );
    expect(body).toMatch(
      /JOIN finished_goods_with_availability fga ON fga\.id = fg\.id/,
    );
  });

  it("KNOWN-IMPERFECT: the clamp fixes only the read path — the bin counter itself still drifts high", () => {
    // The migration says so in its own `ponytail:` note. The raw bi.quantity
    // is never corrected by the non-sale draws, so bin_inventory and the
    // allocation ledger disagree, and the LEAST() hides the disagreement
    // rather than resolving it. The deep fix (a bin dimension on allocations)
    // would make this LEAST() unnecessary — and would break this assertion,
    // which is the point.
    expect(body).toMatch(/LEAST\(/);
    expect(body).not.toMatch(/UPDATE bin_inventory/);
  });

  it("reports only positive on-hand, using the CLAMPED quantity not the raw bin count", () => {
    expect(body).toMatch(
      /AND LEAST\(bi\.quantity, GREATEST\(0, fga\.available_quantity\)\)\s*>\s*0/,
    );
    // The pre-00226 filter was on the raw bin count; a row whose bin count is
    // positive but whose ledger availability is 0 must NOT appear.
    expect(body).not.toMatch(/AND bi\.quantity > 0/);
  });
});

describe("sellable_inventory — keg branch", () => {
  it("reads keg_filled_contents directly, already netted and positive-only", () => {
    expect(body).toMatch(/FROM keg_filled_contents kfc/);
  });

  it("KNOWN-IMPERFECT: applies NEITHER the selling_formats join NOR the availability clamp to kegs", () => {
    // The two branches are asymmetric: a NULL-format keg row is NOT dropped
    // (nothing joins selling_formats on this side), and keg quantities are
    // NOT clamped to ledger availability (only the packaged side is). So the
    // same class of drift the 00226 clamp was written for is still
    // unmitigated for kegs. Recorded, not endorsed.
    const kegBranch = body.slice(body.indexOf("UNION ALL"));
    expect(kegBranch).not.toMatch(/selling_formats/);
    expect(kegBranch).not.toMatch(/LEAST\(/);
    expect(kegBranch).not.toMatch(/finished_goods_with_availability/);
  });
});

describe("sellable_inventory — common shape", () => {
  it("both branches emit the same seven columns, with a literal source tag", () => {
    expect(body).toMatch(/'packaged'::text AS source/);
    expect(body).toMatch(/'keg'::text AS source/);
    expect(body).toMatch(/UNION ALL/);
  });

  it("is a UNION ALL, so identical rows are NOT de-duplicated", () => {
    // Deliberate (the branches are disjoint by construction and UNION would
    // pay a sort), but it means the double-count guard above is the ONLY
    // thing preventing a keg from being counted twice.
    expect(body).not.toMatch(/UNION(?! ALL)/);
  });
});
