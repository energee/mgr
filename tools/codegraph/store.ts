/**
 * Graph assembly and persistence.
 *
 * Merges the deterministic passes (and later the LLM pass), drops orphaned
 * edges, and writes NetworkX node-link JSON to tools/codegraph/graph.json so
 * Python tooling can load it with networkx.node_link_graph() unchanged.
 *
 * Every edge carries provenance (file_path + commit + extractor). The shape
 * maps 1:1 onto three Postgres tables - entities(name, type, description,
 * file_path, summary), relations(source, target, predicate, file_path, commit,
 * extractor), aliases(entity, alias) - so moving off JSON later touches only
 * this file.
 */
import { execSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { StoredEntity, StoredRelation } from "./schema";

export const GRAPH_PATH = "tools/codegraph/graph.json";

export type Graph = {
  /** Commit the graph was last built or updated from. */
  commit: string;
  built_at: string;
  /**
   * Fingerprint of every file the passes read. This - not `commit` - is what
   * determines staleness. Comparing commits is both too noisy (it fires on
   * commits touching docs/progress or CI config, which the graph never reads)
   * and too weak (it reports "fresh" for uncommitted working-tree edits, the
   * most common way a graph goes wrong mid-session).
   */
  inputs?: { count: number; digest: string };
  nodes: StoredEntity[];
  links: StoredRelation[];
};

/**
 * Glob patterns for every file the extraction passes read. Keep in sync with
 * ast.ts (src), sql.ts (migrations + snapshot) and extract.ts (llmCorpus).
 */
const INPUT_GLOBS = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "supabase/migrations/*.sql",
  "supabase/live-catalog.snapshot.txt",
  "docs/agents/*.md",
  "docs/spec/*.md",
  "docs/data-model/*.md",
  "README.md",
  "AGENTS.md",
];

/**
 * Content fingerprint of the input set, including uncommitted modifications.
 *
 * Uses `git ls-files -s` for tracked blob SHAs (git already has them, so this
 * costs no file reads) and layers the working tree on top: any file git reports
 * as modified is hashed from disk, so an uncommitted edit changes the digest.
 */
export function inputFingerprint(repoRoot: string): { count: number; digest: string } {
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  const staged = git(["ls-files", "-s", "--", ...INPUT_GLOBS])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      // "<mode> <sha> <stage>\t<path>"
      const [meta, path] = line.split("\t");
      return { path, sha: meta.split(" ")[1] ?? "" };
    });

  // Overlay working-tree state so uncommitted edits and deletions register.
  const dirty = new Set(
    git(["diff", "--name-only", "--", ...INPUT_GLOBS]).split("\n").filter(Boolean),
  );
  const entries = staged.map((e) => {
    if (!dirty.has(e.path)) return `${e.path}:${e.sha}`;
    try {
      return `${e.path}:${createHash("sha256").update(readFileSync(join(repoRoot, e.path))).digest("hex")}`;
    } catch {
      return `${e.path}:DELETED`;
    }
  });

  entries.sort();
  return {
    count: entries.length,
    digest: createHash("sha256").update(entries.join("\n")).digest("hex").slice(0, 16),
  };
}

/** True when the graph no longer matches the files it was built from. */
export function isStale(repoRoot: string, graph: Graph): boolean {
  if (!graph.inputs) return true; // built before fingerprints existed
  return inputFingerprint(repoRoot).digest !== graph.inputs.digest;
}

export function gitCommit(repoRoot: string): string {
  return execSync("git rev-parse HEAD", { cwd: repoRoot }).toString().trim();
}

/** Key an edge for dedup: the same triple from the same file is one edge. */
const edgeKey = (r: StoredRelation) =>
  `${r.source} ${r.predicate} ${r.target} ${r.file_path}`;

export type MergeReport = {
  entities: number;
  relations: number;
  droppedOrphans: number;
};

export type GraphPart = { entities: StoredEntity[]; relations: StoredRelation[] };

export function merge(parts: GraphPart[]): {
  graph: Omit<Graph, "commit" | "built_at">;
  report: MergeReport;
} {
  const nodes = new Map<string, StoredEntity>();
  for (const p of parts) {
    for (const e of p.entities) {
      const prev = nodes.get(e.name);
      if (!prev) {
        nodes.set(e.name, { ...e, aliases: [...e.aliases] });
        continue;
      }
      // Prefer a snapshot-confirmed node over a chain-only one; union aliases.
      const better =
        prev.db_source === "snapshot"
          ? prev
          : e.db_source === "snapshot"
            ? e
            : prev;
      nodes.set(e.name, {
        ...better,
        aliases: [...new Set([...prev.aliases, ...e.aliases])],
      });
    }
  }

  const seen = new Set<string>();
  const links: StoredRelation[] = [];
  let dropped = 0;
  for (const p of parts) {
    for (const r of p.relations) {
      // No orphaned edges: every relation must connect two extracted entities.
      if (!nodes.has(r.source) || !nodes.has(r.target)) {
        dropped++;
        continue;
      }
      const k = edgeKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      links.push(r);
    }
  }

  return {
    graph: { nodes: [...nodes.values()], links },
    report: { entities: nodes.size, relations: links.length, droppedOrphans: dropped },
  };
}

export function save(
  repoRoot: string,
  graph: Omit<Graph, "commit" | "built_at">,
  commit: string,
): void {
  const out: Graph = {
    commit,
    built_at: new Date().toISOString(),
    inputs: inputFingerprint(repoRoot),
    ...graph,
  };
  writeFileSync(join(repoRoot, GRAPH_PATH), JSON.stringify(out, null, 1));
}

export function load(repoRoot: string): Graph {
  const p = join(repoRoot, GRAPH_PATH);
  if (!existsSync(p)) {
    throw new Error(`No graph at ${GRAPH_PATH}. Run: bun tools/codegraph/build.ts`);
  }
  return JSON.parse(readFileSync(p, "utf8")) as Graph;
}
