#!/usr/bin/env bun
/**
 * Graph doctor: standing maintenance checks over the knowledge graph.
 *
 * Each check codifies a defect class this repo has actually shipped, as a
 * deterministic query over parser-exact edges — the graph already knows
 * enough to find these; this file just asks on every run instead of waiting
 * for someone to think of the question:
 *
 *   stale-cache      client module writes a table but invalidates no query
 *                    key — the classic "list doesn't refresh after save".
 *   multi-write      module writes 2+ tables with no atomic RPC in the same
 *                    file — a half-applied write on error (issue #822's
 *                    class; the transaction-safety gate was blind to these).
 *   dead-db          live database object no app code reads, writes, or
 *                    invokes — candidate for the grandfathered-allowlist
 *                    cleanup deferred since May.
 *   untested-writes  module that writes the database with no test coverage
 *                    edge at all.
 *
 * Usage:
 *   bun tools/codegraph/doctor.ts               # report, exit 0
 *   bun tools/codegraph/doctor.ts --strict      # exit 1 on unallowlisted findings
 *   bun tools/codegraph/doctor.ts --baseline    # write current findings to the allowlist
 *
 * Findings are suppressed via doctor-allowlist.json ({check: {name: reason}}).
 * The intended workflow is a ratchet: --baseline grandfathers today's state,
 * new findings surface as they are introduced, and allowlist entries are
 * removed as they are cleaned up. A finding here is a lead, not a verdict —
 * the graph's recall has known gaps (see README "Known gaps"), so confirm
 * against the source before filing or fixing.
 */
/* eslint-disable no-console -- CLI entry point: stdout is the output. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { load, type Graph } from "./store";

const ALLOWLIST_PATH = "tools/codegraph/doctor-allowlist.json";

export type Findings = Record<string, Record<string, string>>;

/** Client-side surfaces where a write without cache invalidation is a bug.
 *  Server code (api routes, services, scripts) has no React Query cache. */
const CLIENT_RE = /^src\/(components|hooks|app\/\(app\)|app\/portal)\//;

export function runChecks(graph: Graph): Findings {
  const byTarget = new Map<string, Map<string, Set<string>>>();
  for (const l of graph.links) {
    let t = byTarget.get(l.target);
    if (!t) byTarget.set(l.target, (t = new Map()));
    let tp = t.get(l.predicate);
    if (!tp) t.set(l.predicate, (tp = new Set()));
    tp.add(l.source);
  }
  const incoming = (name: string, pred: string) =>
    byTarget.get(name)?.get(pred) ?? new Set<string>();

  const findings: Findings = {
    "stale-cache": {},
    "multi-write": {},
    "dead-db": {},
    "untested-writes": {},
  };

  // Group data-access edges by the FILE they were extracted from, so a page
  // and a component it defines report once, and "same file" means what a
  // reviewer thinks it means.
  const writesByFile = new Map<string, Set<string>>();
  const filesWith = (pred: string) => {
    const files = new Set<string>();
    for (const l of graph.links) if (l.predicate === pred) files.add(l.file_path);
    return files;
  };
  for (const l of graph.links) {
    if (l.predicate !== "writes_to") continue;
    let w = writesByFile.get(l.file_path);
    if (!w) writesByFile.set(l.file_path, (w = new Set()));
    w.add(l.target);
  }
  const invalidatingFiles = filesWith("invalidates");
  const invokingFiles = filesWith("invokes");
  const testedFiles = new Set(
    graph.links.filter((l) => l.predicate === "tested_by").map((l) => l.source),
  );

  for (const [file, tables] of writesByFile) {
    const list = [...tables].sort().join(", ");
    if (CLIENT_RE.test(file) && !invalidatingFiles.has(file)) {
      findings["stale-cache"][file] = `writes ${list} but invalidates no query key`;
    }
    if (tables.size >= 2 && !invokingFiles.has(file)) {
      findings["multi-write"][file] =
        `writes ${tables.size} tables (${list}) with no atomic RPC in the same file`;
    }
    if (!testedFiles.has(file) && !file.includes("__tests__") && !/\.(test|spec)\./.test(file)) {
      findings["untested-writes"][file] = `writes ${list} with no tested_by edge`;
    }
  }

  for (const n of graph.nodes) {
    if (n.db_source !== "snapshot") continue;
    if (n.type === "TABLE") {
      const used =
        incoming(n.name, "reads_from").size +
        incoming(n.name, "writes_to").size +
        incoming(n.name, "derives_from").size;
      if (used === 0)
        findings["dead-db"][n.name] = "table: no app reads/writes and no view derives from it";
    } else if (n.type === "DB_FUNCTION") {
      const used = incoming(n.name, "invokes").size + incoming(n.name, "executes").size;
      if (used === 0)
        findings["dead-db"][n.name] = "function: no app .rpc() call and no trigger executes it";
    }
  }

  return findings;
}

function loadAllowlist(repoRoot: string): Findings {
  const p = join(repoRoot, ALLOWLIST_PATH);
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8")) as Findings;
}

/** Findings not covered by the allowlist — the ratchet's moving edge. */
export function unallowlisted(findings: Findings, allow: Findings): Findings {
  const fresh: Findings = {};
  for (const [check, entries] of Object.entries(findings)) {
    for (const [name, why] of Object.entries(entries)) {
      if (allow[check]?.[name] !== undefined) continue;
      (fresh[check] ??= {})[name] = why;
    }
  }
  return fresh;
}

if (import.meta.main) {
  const args = new Set(process.argv.slice(2));
  const repoRoot = resolve(execSync("git rev-parse --show-toplevel").toString().trim());
  const graph = load(repoRoot);
  const findings = runChecks(graph);

  if (args.has("--baseline")) {
    writeFileSync(join(repoRoot, ALLOWLIST_PATH), `${JSON.stringify(findings, null, 2)}\n`);
    const n = Object.values(findings).reduce((a, c) => a + Object.keys(c).length, 0);
    console.log(`baselined ${n} findings into ${ALLOWLIST_PATH}`);
    process.exit(0);
  }

  const fresh = unallowlisted(findings, loadAllowlist(repoRoot));
  let freshCount = 0;
  for (const [check, entries] of Object.entries(findings)) {
    const names = Object.keys(entries).sort();
    if (names.length === 0) continue;
    console.log(`\n## ${check} (${names.length})`);
    for (const name of names) {
      const isFresh = fresh[check]?.[name] !== undefined;
      if (isFresh) freshCount++;
      console.log(`${isFresh ? "  NEW " : "  ok  "}${name} — ${entries[name]}`);
    }
  }
  console.log(`\n${freshCount} finding(s) not in the allowlist.`);
  if (freshCount > 0) {
    console.log("Fix them, or re-baseline deliberately: bun tools/codegraph/doctor.ts --baseline");
  }
  if (args.has("--strict") && freshCount > 0) process.exit(1);
}
