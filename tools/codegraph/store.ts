/**
 * Graph assembly and persistence.
 *
 * Merges the deterministic passes (and later the LLM pass), drops orphaned
 * edges, and writes NetworkX node-link JSON to tools/codegraph/graph.json so
 * Python tooling can load it with networkx.node_link_graph() unchanged.
 *
 * Every edge carries provenance (file_path + extractor; the commit is stamped
 * once at the top level, so rebuilds do not rewrite every line). The shape
 * maps 1:1 onto three Postgres tables - entities(name, type, description,
 * file_path, summary), relations(source, target, predicate, file_path,
 * extractor), aliases(entity, alias) - so moving off JSON later touches only
 * this file.
 */
import { execSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { StoredEntity, StoredRelation } from "./schema";
import { runAstPass } from "./ast";
import { runSqlPass } from "./sql";
import { runFeaturesPass } from "./features";
import { resolveGraph, type ResolutionReport } from "./resolve";

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
   * most common way a graph goes wrong mid-session). The digest also folds in
   * EXTRACTOR_VERSION so extractor code changes invalidate old graphs.
   */
  inputs?: { count: number; digest: string };
  nodes: StoredEntity[];
  links: StoredRelation[];
};

/**
 * Version of the extractor code itself, folded into the staleness digest.
 * INPUT_GLOBS only covers extraction *inputs*, so a parser change merged
 * without a manual rebuild would otherwise be invisible to auto-refresh
 * forever. Bump this whenever a change under tools/codegraph/ alters what the
 * deterministic passes emit (same idiom as PROMPT_VERSION in extract.ts).
 */
const EXTRACTOR_VERSION = 3;

/**
 * Glob patterns for every file the extraction passes read. Keep in sync with
 * ast.ts (src), sql.ts (migrations + snapshot) and extract.ts (llmCorpus).
 */
const INPUT_GLOBS = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "supabase/migrations/*.sql",
  "supabase/live-catalog.snapshot.txt",
  "docs/feature_list.json",
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
  const hashOnDisk = (path: string) => {
    try {
      return `${path}:${createHash("sha256").update(readFileSync(join(repoRoot, path))).digest("hex")}`;
    } catch {
      return `${path}:DELETED`;
    }
  };
  const entries = staged.map((e) =>
    dirty.has(e.path) ? hashOnDisk(e.path) : `${e.path}:${e.sha}`,
  );

  // Untracked files are invisible to both commands above, yet a brand-new
  // source file changes the graph as much as an edit does - without this a
  // never-added file leaves the graph reporting "fresh" forever.
  for (const path of git(["ls-files", "-o", "--exclude-standard", "--", ...INPUT_GLOBS])
    .split("\n")
    .filter(Boolean)) {
    entries.push(hashOnDisk(path));
  }

  entries.sort();
  return {
    count: entries.length,
    digest: createHash("sha256")
      .update(`extractor:v${EXTRACTOR_VERSION}\n${entries.join("\n")}`)
      .digest("hex")
      .slice(0, 16),
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
export const edgeKey = (r: StoredRelation) =>
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

/**
 * `inputs` (the staleness fingerprint) is recomputed from the current tree by
 * default, which is correct ONLY when the extraction passes just ran. A caller
 * that merely annotates a loaded graph (summarize.ts) MUST pass the loaded
 * graph's own `inputs` through - re-stamping from a tree that changed since
 * the build would mark a stale graph fresh and permanently disable
 * auto-refresh for it.
 */
export function save(
  repoRoot: string,
  graph: Omit<Graph, "commit" | "built_at">,
  commit: string,
  inputs?: Graph["inputs"],
): Graph {
  const out: Graph = {
    commit,
    built_at: new Date().toISOString(),
    inputs: inputs ?? inputFingerprint(repoRoot),
    ...graph,
  };
  // Write-then-rename so a concurrent reader (query.ts auto-refresh in another
  // session) never parses a torn graph.json — same pattern as extract.ts cache
  // entries.
  const dest = join(repoRoot, GRAPH_PATH);
  const tmp = `${dest}.tmp`;
  writeFileSync(tmp, JSON.stringify(out, null, 1));
  renameSync(tmp, dest);
  return out;
}

export function load(repoRoot: string): Graph {
  const p = join(repoRoot, GRAPH_PATH);
  if (!existsSync(p)) {
    throw new Error(`No graph at ${GRAPH_PATH}. Run: bun tools/codegraph/build.ts`);
  }
  return JSON.parse(readFileSync(p, "utf8")) as Graph;
}

/** load(), or undefined when no graph exists yet (first build). */
export function tryLoad(repoRoot: string): Graph | undefined {
  try {
    return load(repoRoot);
  } catch {
    return undefined;
  }
}

/**
 * The LLM-extracted slice of a previous graph, as a mergeable part.
 *
 * Every rebuild path MUST include this (minus any files the LLM pass is about
 * to re-extract), because the deterministic passes cannot reproduce LLM facts
 * and a merge without them silently deletes them — which is exactly how the
 * committed graph lost all its LLM edges once: build.ts merged [sql, ast] and
 * nobody noticed until an audit counted zero.
 */
export function llmPart(prev: Graph | undefined, excludeFiles?: Set<string>): GraphPart {
  if (!prev) return { entities: [], relations: [] };
  const keep = (fp: string) => !excludeFiles?.has(fp);
  return {
    entities: prev.nodes.filter((n) => n.extractor === "llm" && keep(n.file_path)),
    relations: prev.links.filter((l) => l.extractor === "llm" && keep(l.file_path)),
  };
}

/**
 * The one rebuild pipeline: passes -> merge (with LLM carry-over) -> resolve ->
 * carryProfiles -> save. Every entry point (build.ts, update.ts, query.ts's
 * auto-refresh) runs THIS; they differ only in whether they supply fresh LLM
 * output. Before this existed each entry point hand-assembled the pipeline and
 * they drifted: build.ts skipped resolveGraph entirely, and one caller's
 * missing llmPart() deleted every LLM edge from the committed graph.
 *
 * `llm` receives the endpoint names the AST pass found (the LLM validator's
 * anti-fabrication gate) and returns fresh LLM output plus the set of files it
 * re-extracted, so prior LLM facts for those files are not double-carried.
 */
export async function rebuild(
  repoRoot: string,
  commit: string,
  llm?: (
    knownEndpoints: Set<string>,
  ) => Promise<{ fresh: GraphPart; reExtracted: Set<string> }>,
): Promise<{ graph: Graph; merge: MergeReport; resolution: ResolutionReport }> {
  const prev = tryLoad(repoRoot);
  const parts: GraphPart[] = [runSqlPass(repoRoot), runAstPass(repoRoot), runFeaturesPass(repoRoot)];

  let reExtracted = new Set<string>();
  if (llm) {
    const knownEndpoints = new Set(
      parts[1].entities
        .filter((e) => e.type === "API_ENDPOINT" || e.type === "WEBHOOK")
        .map((e) => e.name),
    );
    const out = await llm(knownEndpoints);
    parts.push(out.fresh);
    reExtracted = out.reExtracted;
  }
  parts.push(llmPart(prev, reExtracted));

  const { graph: merged, report } = merge(parts);
  const { graph: resolved, report: resolution } = resolveGraph(merged, repoRoot);
  carryProfiles(prev, resolved);
  return { graph: save(repoRoot, resolved, commit), merge: report, resolution };
}

/**
 * Copy summarize.ts hub profiles (summary/key_facts/files) from a previous
 * graph onto same-named nodes of a rebuilt one, in place. Without this every
 * rebuild — including query.ts's auto-refresh — discards all profiles, since
 * the passes mint fresh nodes. Profiles carried this way can lag the edges
 * they describe; re-run summarize.ts to refresh them.
 */
export function carryProfiles(
  prev: Graph | undefined,
  graph: Omit<Graph, "commit" | "built_at">,
): void {
  if (!prev) return;
  const profiled = new Map(prev.nodes.filter((n) => n.summary).map((n) => [n.name, n]));
  for (const n of graph.nodes) {
    const p = profiled.get(n.name);
    if (p && !n.summary) {
      n.summary = p.summary;
      n.key_facts = p.key_facts;
      n.files = p.files;
    }
  }
}
