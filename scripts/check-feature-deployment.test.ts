/**
 * scripts/check-feature-deployment.test.ts
 *
 * Covers the deployment-record gate from #654: `docs/feature_list.json` must
 * separate "code and tests pass" (`state`) from "the migration is applied on
 * live" (`deployment`), and the separation has to be enforced rather than
 * documented.
 *
 * Both directions are tested deliberately — a gate is only worth having if the
 * failing path actually fails. The `live` cases pin the part that does real
 * work: opening the live-catalog snapshot and looking for the objects the
 * declared migration creates. The last block pins the committed tracker, so
 * the shipped data cannot drift out of contract.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditFeatureDeployment,
  auditUnauditedBacklog,
  catalogHas,
  createdCatalogObjects,
  LIVE_CATALOG_SNAPSHOT,
  readRetiredObjects,
  UNAUDITED,
  type AuditContext,
  type FeatureEntry,
} from "./check-feature-deployment";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Deterministic context. Two migrations on disk: one creating a table, a
 * function and a trigger that the fake catalog carries, one creating nothing
 * the catalog can record (a column-add — the "not verifiable" case).
 */
const MIGRATION_SQL: Record<string, string> = {
  "00250_beer_order_imports.sql": [
    "-- CREATE TABLE commented_out_table (id uuid);",
    "CREATE TABLE beer_order_import_runs (id uuid PRIMARY KEY);",
    "CREATE OR REPLACE FUNCTION apply_beer_order_import(p_run_id uuid) RETURNS void AS $$ $$;",
    "CREATE TRIGGER beer_order_touch BEFORE UPDATE ON beer_order_import_runs",
  ].join("\n"),
  "00281_notify_data_integrity_findings.sql": "ALTER TABLE batches ADD COLUMN notified_at timestamptz;",
  "00139_cogs_and_projection_rpcs.sql":
    "CREATE OR REPLACE FUNCTION cogs_by_period(a date) RETURNS void AS $$ $$;\n" +
    "CREATE OR REPLACE FUNCTION project_revenue(a date) RETURNS void AS $$ $$;",
};

const CATALOG = [
  "TABLE|beer_order_import_runs",
  "FUNC|apply_beer_order_import(p_run_id uuid)|abc123",
  "TRIG|beer_order_touch|beer_order_import_runs|def456",
  "FUNC|cogs_by_period(a date)|ghi789",
];

const ctx: AuditContext = {
  migrationFiles: Object.keys(MIGRATION_SQL),
  readMigration: (name) => MIGRATION_SQL[name] ?? "",
  liveCatalog: CATALOG,
  pathExists: (path) => path === LIVE_CATALOG_SNAPSHOT,
  today: "2026-07-30",
};

function audit(feature: FeatureEntry, override: Partial<AuditContext> = {}): string[] {
  return auditFeatureDeployment([feature], { ...ctx, ...override }).violations;
}

const liveRecord = {
  state: "live",
  observed_live_on: "2026-07-15",
  verified_by: [LIVE_CATALOG_SNAPSHOT, "#516"],
};
const backed = {
  id: "F201",
  state: "passing",
  migrations: ["00250_beer_order_imports.sql"],
};

describe("auditFeatureDeployment — entries that satisfy the contract", () => {
  it("accepts a passing feature audited as needing no schema change", () => {
    expect(audit({ id: "F001", state: "passing", migrations: [] })).toEqual([]);
  });

  it("accepts an entry that honestly declares itself unaudited", () => {
    expect(audit({ id: "F100", state: "passing", migrations: UNAUDITED })).toEqual([]);
  });

  it("accepts a migration-backed passing feature with a live record", () => {
    expect(audit({ ...backed, deployment: liveRecord })).toEqual([]);
  });

  it("accepts a pending record with a tracking issue and a fresh date", () => {
    expect(
      audit({
        id: "F900",
        state: "passing",
        migrations: ["00250_beer_order_imports.sql"],
        deployment: { state: "pending", pending_since: "2026-07-01", tracking_issue: 440 },
      }),
    ).toEqual([]);
  });

  it("does not require a record from a feature that is not yet claiming done", () => {
    expect(audit({ id: "F901", state: "in_progress", migrations: ["00250_beer_order_imports.sql"] })).toEqual(
      [],
    );
  });

  it("accepts migrations named in the entry's own text when they are declared", () => {
    expect(
      audit({
        ...backed,
        evidence: "RPC in supabase/migrations/00250_beer_order_imports.sql; migration 00250 live",
        deployment: liveRecord,
      }),
    ).toEqual([]);
  });
});

describe("auditFeatureDeployment — entries that must fail", () => {
  it("fails a passing migration-backed feature with no deployment record", () => {
    const violations = audit(backed);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('F201: state "passing"');
    expect(violations[0]).toContain('no "deployment"');
  });

  it("fails an entry that omits the migrations declaration entirely", () => {
    const violations = audit({ id: "F002", state: "passing" });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('missing or malformed "migrations"');
  });

  it("fails a migrations value that is neither an array of names nor the sentinel", () => {
    expect(audit({ id: "F003", state: "passing", migrations: "00250" })[0]).toContain(
      'missing or malformed "migrations"',
    );
    expect(audit({ id: "F004", state: "passing", migrations: [""] })[0]).toContain(
      'missing or malformed "migrations"',
    );
  });

  it("fails a declared migration that is not in the chain (renumber/rename drift)", () => {
    const violations = audit({
      id: "F005",
      state: "passing",
      migrations: ["00260_duplicate_number.sql"],
      deployment: liveRecord,
    });
    expect(violations[0]).toContain("does not exist");
  });

  it("fails a migrations list that repeats a filename", () => {
    const violations = audit({
      ...backed,
      migrations: ["00250_beer_order_imports.sql", "00250_beer_order_imports.sql"],
      deployment: liveRecord,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("more than once");
  });

  it("fails when the entry's text names a migration path the list omits", () => {
    const violations = audit({
      id: "F200",
      state: "passing",
      migrations: [],
      evidence: "server RPC in supabase/migrations/00250_beer_order_imports.sql",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('"migrations" does not list it');
  });

  it("fails when the entry's text names a bare migration number the list omits", () => {
    const violations = audit({
      id: "F201",
      state: "passing",
      migrations: [],
      evidence: "migration 00250 confirmed applied live as of 2026-07-15",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("references migration 00250");
  });

  it("fails an unaudited entry whose own text names a migration — it is auditable now", () => {
    const violations = audit({
      id: "F132",
      state: "passing",
      migrations: UNAUDITED,
      evidence: "RPCs in supabase/migrations/00139_cogs_and_projection_rpcs.sql",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("auditable right now");
  });

  it("fails an unaudited entry that still carries a deployment record", () => {
    const violations = audit({
      id: "F133",
      state: "passing",
      migrations: UNAUDITED,
      deployment: liveRecord,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("must be anchored to migrations the entry actually declares");
  });

  it("rejects unknown keys, so prose cannot be parked inside the record", () => {
    const violations = audit({
      ...backed,
      deployment: { ...liveRecord, note: "live history 00250-00259" },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('unexpected key "note"');
  });

  it("rejects a live record without a real observed_live_on date", () => {
    expect(
      audit({
        ...backed,
        deployment: { state: "live", verified_by: [LIVE_CATALOG_SNAPSHOT] },
      })[0],
    ).toContain('requires "observed_live_on"');
    expect(
      audit({
        ...backed,
        deployment: {
          state: "live",
          observed_live_on: "2026-02-31",
          verified_by: [LIVE_CATALOG_SNAPSHOT],
        },
      })[0],
    ).toContain('requires "observed_live_on"');
  });

  it("rejects a future observed_live_on date", () => {
    const violations = audit({
      ...backed,
      deployment: {
        state: "live",
        observed_live_on: "2026-07-31",
        verified_by: [LIVE_CATALOG_SNAPSHOT],
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("is in the future");
  });

  it("rejects verified_by entries that are neither an existing path nor #NNN", () => {
    const violations = audit({
      ...backed,
      deployment: {
        state: "live",
        observed_live_on: "2026-07-15",
        verified_by: [LIVE_CATALOG_SNAPSHOT, "inferred from the snapshot, probably"],
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("neither an existing repo-relative path");
  });

  it("rejects a verified_by path that escapes the repo", () => {
    const violations = audit({
      ...backed,
      deployment: {
        state: "live",
        observed_live_on: "2026-07-15",
        verified_by: [LIVE_CATALOG_SNAPSHOT, "../../../etc/hosts"],
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("not a repo-relative path");
  });

  it("rejects a repeated verified_by item", () => {
    const violations = audit({
      ...backed,
      deployment: {
        state: "live",
        observed_live_on: "2026-07-15",
        verified_by: [LIVE_CATALOG_SNAPSHOT, LIVE_CATALOG_SNAPSHOT],
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("more than once");
  });

  it("rejects a live record with an empty verified_by list", () => {
    const violations = audit({
      ...backed,
      deployment: { state: "live", observed_live_on: "2026-07-15", verified_by: [] },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('requires a non-empty "verified_by"');
  });

  // The reviewer's probes against the previous revision: both of these passed
  // when `verified_by` was only a shape regex.
  it("rejects a live record whose only receipt is an unrelated repo file", () => {
    const violations = audit(
      {
        ...backed,
        deployment: { state: "live", observed_live_on: "2026-07-15", verified_by: ["README.md"] },
      },
      { pathExists: (path) => path === "README.md" || path === LIVE_CATALOG_SNAPSHOT },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(`must cite "${LIVE_CATALOG_SNAPSHOT}"`);
  });

  it("rejects a live record whose only receipt is an issue number", () => {
    const violations = audit({
      ...backed,
      deployment: { state: "live", observed_live_on: "2026-07-15", verified_by: ["#999999"] },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(`must cite "${LIVE_CATALOG_SNAPSHOT}"`);
  });

  it("rejects live when an object the migration creates is absent from the snapshot", () => {
    const violations = audit({
      id: "F132",
      state: "passing",
      migrations: ["00139_cogs_and_projection_rpcs.sql"],
      deployment: {
        state: "live",
        observed_live_on: "2026-07-15",
        verified_by: [LIVE_CATALOG_SNAPSHOT],
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("absent from");
    expect(violations[0]).toContain("function project_revenue");
    expect(violations[0]).not.toContain("cogs_by_period");
  });

  // retired_objects: an anchor-created object a LATER migration deliberately
  // dropped (00294-style dynamic SQL, invisible to static extraction).
  const projectionEntry = {
    id: "F132",
    state: "passing",
    migrations: ["00139_cogs_and_projection_rpcs.sql"],
    deployment: {
      state: "live",
      observed_live_on: "2026-07-15",
      verified_by: [LIVE_CATALOG_SNAPSHOT],
    },
  };
  const retiredCtx = {
    migrationFiles: [...Object.keys(MIGRATION_SQL), "00289_drop_orphaned_projection_rpcs.sql"],
    retiredObjects: { project_revenue: "00289_drop_orphaned_projection_rpcs.sql" },
  };

  it("accepts a snapshot-absent object recorded as retired by a later migration", () => {
    const result = auditFeatureDeployment([projectionEntry], { ...ctx, ...retiredCtx });
    expect(result.violations).toEqual([]);
    // cogs_by_period is still genuinely verified; the retired one is counted.
    expect(result.stats.liveSnapshotVerified).toBe(1);
    expect(result.stats.liveRetired).toBe(1);
  });

  it("does not count an anchor as verified when its every object is retired", () => {
    const result = auditFeatureDeployment([projectionEntry], {
      ...ctx,
      liveCatalog: [],
      migrationFiles: retiredCtx.migrationFiles,
      retiredObjects: {
        project_revenue: "00289_drop_orphaned_projection_rpcs.sql",
        cogs_by_period: "00289_drop_orphaned_projection_rpcs.sql",
      },
    });
    expect(result.violations).toEqual([]);
    expect(result.stats.liveSnapshotVerified).toBe(0);
    expect(result.stats.liveUnverifiable).toBe(1);
    expect(result.stats.liveRetired).toBe(2);
  });

  it("still rejects when the retirement names a missing or earlier migration", () => {
    // Migration not in the chain → the escape hatch must not apply.
    expect(
      audit(projectionEntry, {
        retiredObjects: { project_revenue: "00299_not_in_chain.sql" },
      }),
    ).toHaveLength(1);
    // Migration sorts BEFORE the anchor → a drop cannot precede the create.
    expect(
      audit(projectionEntry, {
        migrationFiles: [...Object.keys(MIGRATION_SQL), "00100_too_early.sql"],
        retiredObjects: { project_revenue: "00100_too_early.sql" },
      }),
    ).toHaveLength(1);
  });

  it("rejects a pending record with no tracking issue", () => {
    const violations = audit({
      ...backed,
      deployment: { state: "pending", pending_since: "2026-07-01" },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('requires "tracking_issue"');
  });

  it("rejects a pending record with no dated receipt", () => {
    const violations = audit({ ...backed, deployment: { state: "pending", tracking_issue: 440 } });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('requires "pending_since"');
  });

  it("rejects a pending record that has rotted past the re-confirmation window", () => {
    const violations = audit({
      ...backed,
      deployment: { state: "pending", pending_since: "2026-01-01", tracking_issue: 440 },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('"pending" since 2026-01-01');
    expect(violations[0]).toContain("limit 90");
  });

  it("rejects an unknown deployment state", () => {
    const violations = audit({ ...backed, deployment: { state: "probably-live" } });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('must be "live" or "pending"');
  });

  it("rejects a deployment record that is not anchored to a migration", () => {
    const violations = audit({
      id: "F001",
      state: "passing",
      migrations: [],
      deployment: liveRecord,
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("anchored to at least one migration");
  });
});

describe("auditFeatureDeployment — what the run reports about itself", () => {
  it("counts a live record it cannot verify separately from one it can", () => {
    const { violations, stats } = auditFeatureDeployment(
      [
        { ...backed, deployment: liveRecord },
        {
          id: "F902",
          state: "passing",
          // A column-add migration: nothing the snapshot records.
          migrations: ["00281_notify_data_integrity_findings.sql"],
          deployment: {
            state: "live",
            observed_live_on: "2026-07-15",
            verified_by: [LIVE_CATALOG_SNAPSHOT],
          },
        },
        { id: "F903", state: "passing", migrations: [] },
        { id: "F904", state: "passing", migrations: UNAUDITED },
      ],
      ctx,
    );

    expect(violations).toEqual([]);
    expect(stats).toMatchObject({
      checked: 4,
      migrationBacked: 2,
      live: 2,
      liveSnapshotVerified: 1,
      liveUnverifiable: 1,
      noSchema: 1,
      unaudited: 1,
      pending: 0,
    });
  });
});

describe("createdCatalogObjects / catalogHas", () => {
  it("extracts the object kinds the snapshot records, ignoring comments", () => {
    expect(createdCatalogObjects(MIGRATION_SQL["00250_beer_order_imports.sql"])).toEqual([
      { kind: "table", name: "beer_order_import_runs" },
      { kind: "function", name: "apply_beer_order_import" },
      { kind: "trigger", name: "beer_order_touch" },
    ]);
  });

  it("extracts nothing from a migration that only alters a table", () => {
    expect(createdCatalogObjects(MIGRATION_SQL["00281_notify_data_integrity_findings.sql"])).toEqual([]);
  });

  it("ignores views, which the snapshot does not carry", () => {
    expect(createdCatalogObjects("CREATE OR REPLACE VIEW batches_with_details AS SELECT 1;")).toEqual([]);
  });

  it("matches a function by name and a table by exact line", () => {
    expect(catalogHas(CATALOG, { kind: "function", name: "apply_beer_order_import" })).toBe(true);
    expect(catalogHas(CATALOG, { kind: "table", name: "beer_order_import_runs" })).toBe(true);
    expect(catalogHas(CATALOG, { kind: "table", name: "beer_order_import" })).toBe(false);
    expect(catalogHas(CATALOG, { kind: "trigger", name: "beer_order_touch" })).toBe(true);
    expect(catalogHas(CATALOG, { kind: "function", name: "project_revenue" })).toBe(false);
  });
});

describe("auditUnauditedBacklog — the ratchet on the unaudited backlog", () => {
  it("accepts a count that matches", () => {
    expect(auditUnauditedBacklog(32, { count: 32, tracking_issue: 696 })).toEqual([]);
  });

  it("fails when an entry was audited but the count was not lowered", () => {
    const violations = auditUnauditedBacklog(31, { count: 32, tracking_issue: 696 });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("Set it to 31");
  });

  it("fails, and asks for a reason, when the backlog grew", () => {
    const violations = auditUnauditedBacklog(33, { count: 32, tracking_issue: 696 });
    expect(violations[0]).toContain("why the backlog grew");
  });

  it("fails when the backlog is missing or has no tracking issue", () => {
    expect(auditUnauditedBacklog(0, undefined)[0]).toContain("is missing");
    expect(auditUnauditedBacklog(32, { count: 32 })[0]).toContain("tracking_issue");
  });

  it("rejects unknown keys, so prose cannot be parked there either", () => {
    const violations = auditUnauditedBacklog(32, {
      count: 32,
      tracking_issue: 696,
      note: "mostly fine probably",
    });
    expect(violations.some((v) => v.includes('unexpected key "note"'))).toBe(true);
  });
});

describe("the committed tracker", () => {
  const tracker = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "docs/feature_list.json"), "utf8"),
  ) as {
    features: (FeatureEntry & { evidence?: string; verification?: string })[];
    deployment_conventions?: Record<string, unknown>;
  };

  const realCtx: AuditContext = {
    migrationFiles: readdirSync(resolve(REPO_ROOT, "supabase/migrations")).filter((name) =>
      name.endsWith(".sql"),
    ),
    readMigration: (name) =>
      readFileSync(resolve(REPO_ROOT, "supabase/migrations", name), "utf8"),
    liveCatalog: readFileSync(resolve(REPO_ROOT, LIVE_CATALOG_SNAPSHOT), "utf8").split("\n"),
    pathExists: (path) => existsSync(resolve(REPO_ROOT, path)),
    today: new Date().toISOString().slice(0, 10),
    // Same reader main() uses, so this test exercises the real retirement map.
    retiredObjects: readRetiredObjects(tracker.deployment_conventions),
  };

  it("satisfies the deployment contract", () => {
    expect(auditFeatureDeployment(tracker.features, realCtx).violations).toEqual([]);
  });

  it("keeps the unaudited backlog count honest", () => {
    const { stats } = auditFeatureDeployment(tracker.features, realCtx);
    expect(
      auditUnauditedBacklog(stats.unaudited, tracker.deployment_conventions?.unaudited_backlog),
    ).toEqual([]);
  });

  it("does not silently claim an audit it did not do", () => {
    const { stats } = auditFeatureDeployment(tracker.features, realCtx);
    // The point of the sentinel: `noSchema` is a claim, so it may only cover
    // entries somebody checked. If this ever equals `checked`, the backfill
    // came back.
    //
    // This used to assert `stats.unaudited > 0`, which was a proxy for the
    // same thing that only held while the backlog was non-empty. #724 captured
    // the last live-only table and drove it to 0 by auditing, not by
    // backfilling, so the proxy started reporting a success as a failure.
    // Asserting the backfill signature directly survives that: a blanket `[]`
    // sweep shows up as every checked entry landing in `noSchema`, whatever
    // the sentinel count happens to be. The ratchet in `auditUnauditedBacklog`
    // (tested above) is what keeps re-adding a sentinel a visible edit.
    expect(stats.noSchema).toBeLessThan(stats.checked);
    expect(stats.migrationBacked).toBeGreaterThan(0);
    expect(stats.noSchema + stats.migrationBacked + stats.unaudited).toBe(stats.checked);
  });

  it("records F201's migration 00250 as live rather than as prose", () => {
    const f201 = tracker.features.find((f) => f.id === "F201");

    expect(f201?.migrations).toEqual(["00250_beer_order_imports.sql"]);
    expect(f201?.deployment).toMatchObject({ state: "live", observed_live_on: "2026-07-15" });
    // The stale-parenthetical failure mode: no live-migration range, and no
    // deployment claim left in the free-text field.
    expect(f201?.evidence ?? "").not.toMatch(/live history/i);
    expect(f201?.evidence ?? "").not.toMatch(/applied live/i);
  });

  it("has no feature whose verification command re-enters verify-feature.sh", () => {
    // F003's verification used to be `bash scripts/verify-feature.sh F003`,
    // i.e. the documented example command in AGENTS.md recursed forever.
    const recursive = tracker.features.filter((f) =>
      (f.verification ?? "").includes("verify-feature"),
    );
    expect(recursive.map((f) => f.id)).toEqual([]);
  });
});
