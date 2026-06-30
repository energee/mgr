/**
 * Landed-cost derivation regression tests
 *
 * inventory_lots.landed_cost was a STORED column, populated only as an UPDATE
 * side-effect of calculate_landed_cost() (invoked lazily from a read-path
 * display helper) and never recomputed when PO inputs changed — so it went
 * stale and fed stale numbers into cogs_by_period.
 *
 * Fix (P0 #4): a read-time view inventory_lots_with_landed_cost computes landed
 * cost live (mirroring the mig-00146 allocation formula), and cogs_by_period
 * sources landed cost from that view instead of the stored column. These tests
 * guard that wiring at the migration level.
 *
 * Structural SQL assertions (no local Postgres / pgTAP harness), matching the
 * migration-reading pattern in state-machines.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const MIGRATIONS_DIR = resolve(__dirname, "../../../supabase/migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Body of the latest CREATE OR REPLACE FUNCTION `fnName`, or null. */
function latestFunctionBody(fnName: string): string | null {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION ${fnName}\\b[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`,
  );
  let body: string | null = null;
  for (const f of migrationFiles()) {
    const m = readFileSync(resolve(MIGRATIONS_DIR, f), "utf-8").match(re);
    if (m) body = m[1];
  }
  return body;
}

describe("landed-cost derivation", () => {
  it("a migration creates the inventory_lots_with_landed_cost view from PO data", () => {
    const creator = migrationFiles().find((f) =>
      /CREATE OR REPLACE VIEW inventory_lots_with_landed_cost\b/.test(
        readFileSync(resolve(MIGRATIONS_DIR, f), "utf-8"),
      ),
    );
    expect(creator).toBeDefined();
    const sql = readFileSync(resolve(MIGRATIONS_DIR, creator!), "utf-8");
    // The derivation must pull from the PO chain, not a stored column.
    expect(sql).toMatch(/po_line_items/);
    expect(sql).toMatch(/purchase_orders/);
  });

  it("cogs_by_period sources landed cost from the derivation view", () => {
    const body = latestFunctionBody("cogs_by_period");
    expect(body).not.toBeNull();
    expect(body!).toMatch(/inventory_lots_with_landed_cost/);
  });
});
