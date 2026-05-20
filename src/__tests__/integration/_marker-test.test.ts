/**
 * Marker test — viewer denied SELECT on keg_inventory
 *
 * EXPECTED RED UNTIL TASK 6 LANDS.
 *
 * keg_inventory currently has a `USING (true)` policy (or no restrictive
 * policy) introduced by migration 00168_recreate_keg_inventory_with_details.sql,
 * which means any authenticated user — including viewers — can SELECT from it.
 *
 * Task 6 of `docs/plans/2026-05-19-rls-single-source-of-truth-plan.md` will
 * add an `inventory:read` policy to keg_inventory. Once that migration lands
 * and is applied, change this `it.todo` to a real `it` test.
 *
 * This file intentionally uses `it.todo` (not `it.skip`) so it appears in
 * CI output as a tracking signal — "todo" shows up in the test summary,
 * "skip" is silent.
 */

import { describe, it } from "vitest";

describe("keg_inventory viewer access (tracking marker for Task 6)", () => {
  // TODO(task-6): Remove .todo and implement when migration 00XXX_fix_audit_2026_02_26_remaining.sql
  // adds `inventory:read` policy to keg_inventory. At that point a viewer-role client
  // should get zero rows back from keg_inventory (isDeniedSelect returns true).
  // See: docs/plans/2026-05-19-rls-single-source-of-truth-plan.md § Task 6
  it.todo(
    "viewer is denied SELECT on keg_inventory (EXPECTED RED until Task 6 migration is applied)",
  );
});
