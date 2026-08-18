/**
 * Tests for the deterministic tracker pass (features.ts) and the graph
 * doctor (doctor.ts). The tracker pass runs against the real
 * docs/feature_list.json — its contract is "declared facts, existing paths
 * only", which the live tracker exercises better than a fixture would. The
 * doctor runs against synthetic graphs so each defect class is pinned
 * independently of the repo's current findings.
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { runFeaturesPass } from "./features";
import { runChecks, unallowlisted, type Findings } from "./doctor";
import type { Graph } from "./store";
import type { StoredEntity, StoredRelation } from "./schema";

const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim();

describe("features pass", () => {
  const part = runFeaturesPass(repoRoot);

  it("mints a FEATURE node per tracker entry, tagged tracker", () => {
    const features = part.entities.filter((e) => e.type === "FEATURE");
    expect(features.length).toBeGreaterThanOrEqual(50);
    expect(features.every((f) => /^F\d{3}$/.test(f.name))).toBe(true);
    expect(features.every((f) => f.extractor === "tracker")).toBe(true);
  });

  it("links features to their declared migrations via requires", () => {
    // F201's migration list is load-bearing (see AGENTS.md deploy-state) —
    // if this edge vanishes the pass stopped reading `migrations[]`.
    expect(part.relations).toContainEqual(
      expect.objectContaining({
        source: "F201",
        predicate: "requires",
        target: "00250_beer_order_imports.sql",
      }),
    );
  });

  it("emits only paths that exist: every DOC and TEST node is on disk", () => {
    const paths = part.entities.filter((e) => e.type === "DOC" || e.type === "TEST");
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(() =>
        execSync(`git ls-files --error-unmatch -- "${p.name}"`, { cwd: repoRoot, stdio: "pipe" }),
      ).not.toThrow();
    }
  });

  it("never emits an edge with an endpoint it did not mint", () => {
    const names = new Set(part.entities.map((e) => e.name));
    for (const r of part.relations) {
      expect(names.has(r.source)).toBe(true);
      expect(names.has(r.target)).toBe(true);
    }
  });
});

describe("doctor", () => {
  const node = (
    name: string,
    type: StoredEntity["type"],
    extra?: Partial<StoredEntity>,
  ): StoredEntity => ({
    name,
    type,
    description: "",
    file_path: name,
    aliases: [],
    extractor: "ast",
    ...extra,
  });
  const edge = (
    source: string,
    predicate: StoredRelation["predicate"],
    target: string,
    file_path = source,
  ): StoredRelation => ({ source, predicate, target, file_path, extractor: "ast" });
  const graph = (nodes: StoredEntity[], links: StoredRelation[]): Graph => ({
    commit: "test",
    built_at: "",
    nodes,
    links,
  });

  it("flags a client write with no invalidation, but not a server one", () => {
    const g = graph(
      [
        node("src/components/a.tsx", "COMPONENT"),
        node("src/app/api/b/route.ts", "API_ENDPOINT"),
        node("orders", "TABLE"),
      ],
      [
        edge("src/components/a.tsx", "writes_to", "orders"),
        edge("src/app/api/b/route.ts", "writes_to", "orders"),
      ],
    );
    const f = runChecks(g);
    expect(Object.keys(f["stale-cache"])).toEqual(["src/components/a.tsx"]);
  });

  it("does not flag stale-cache when the same file invalidates a key", () => {
    const g = graph(
      [
        node("src/components/a.tsx", "COMPONENT"),
        node("orders", "TABLE"),
        node("orderKeys.all", "QUERY_KEY"),
      ],
      [
        edge("src/components/a.tsx", "writes_to", "orders"),
        edge("src/components/a.tsx", "invalidates", "orderKeys.all"),
      ],
    );
    expect(runChecks(g)["stale-cache"]).toEqual({});
  });

  it("flags multi-table writes without an atomic RPC, and clears them with one", () => {
    const nodes = [
      node("src/services/s.ts", "SERVICE"),
      node("orders", "TABLE"),
      node("order_items", "TABLE"),
      node("do_it_atomically", "DB_FUNCTION"),
    ];
    const writes = [
      edge("src/services/s.ts", "writes_to", "orders"),
      edge("src/services/s.ts", "writes_to", "order_items"),
    ];
    expect(Object.keys(runChecks(graph(nodes, writes))["multi-write"])).toEqual([
      "src/services/s.ts",
    ]);
    expect(
      runChecks(
        graph(nodes, [...writes, edge("src/services/s.ts", "invokes", "do_it_atomically")]),
      )["multi-write"],
    ).toEqual({});
  });

  it("flags snapshot-confirmed dead tables and functions, never chain-only ones", () => {
    const g = graph(
      [
        node("used", "TABLE", { db_source: "snapshot", extractor: "sql" }),
        node("dead", "TABLE", { db_source: "snapshot", extractor: "sql" }),
        node("chain_only", "TABLE", { db_source: "chain", extractor: "sql" }),
        node("dead_fn", "DB_FUNCTION", { db_source: "snapshot", extractor: "sql" }),
        node("trigger_fn", "DB_FUNCTION", { db_source: "snapshot", extractor: "sql" }),
        node("orders.trg", "TRIGGER", { db_source: "snapshot", extractor: "sql" }),
        node("src/a.ts", "MODULE"),
      ],
      [edge("src/a.ts", "reads_from", "used"), edge("orders.trg", "executes", "trigger_fn")],
    );
    expect(Object.keys(runChecks(g)["dead-db"]).sort()).toEqual(["dead", "dead_fn"]);
  });

  it("flags writes with no tested_by edge", () => {
    const g = graph(
      [
        node("src/services/s.ts", "SERVICE"),
        node("orders", "TABLE"),
        node("src/services/__tests__/s.test.ts", "TEST"),
      ],
      [edge("src/services/s.ts", "writes_to", "orders")],
    );
    expect(Object.keys(runChecks(g)["untested-writes"])).toEqual(["src/services/s.ts"]);
    const covered = graph(g.nodes, [
      ...g.links,
      edge("src/services/s.ts", "tested_by", "src/services/__tests__/s.test.ts"),
    ]);
    expect(runChecks(covered)["untested-writes"]).toEqual({});
  });

  it("unallowlisted is a ratchet: allowlisted entries drop, new ones survive", () => {
    const findings: Findings = { "multi-write": { a: "x", b: "y" }, "dead-db": {} };
    const allow: Findings = { "multi-write": { a: "grandfathered" } };
    expect(unallowlisted(findings, allow)).toEqual({ "multi-write": { b: "y" } });
  });
});
