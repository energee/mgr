/**
 * Hub-node summarization.
 *
 *   bun tools/codegraph/summarize.ts --dry-run     # show what would be profiled
 *   bun tools/codegraph/summarize.ts               # generate and write profiles
 *   bun tools/codegraph/summarize.ts --degree 10   # widen the net
 *
 * The cookbook suggests degree >= 3 as the cutoff. On its 22-node Apollo graph
 * that selects a handful of nodes; on this 3,892-node graph it selects 1,390 -
 * hours of calls, most of them worthless. Two changes make it useful here:
 *
 *   1. A higher degree floor (default 20, which selects ~144 nodes).
 *   2. A TYPE filter, which matters more than the degree. The highest-degree
 *      nodes in this repo are infrastructure - src/components/ui/button.tsx at
 *      135 edges, src/lib/utils.ts at 89. A generated paragraph about a button
 *      component is noise. Profiles earn their cost on domain hubs: tables,
 *      views, services, entity configs, endpoints, and database functions,
 *      where the 1-hop neighborhood genuinely says something a reader could
 *      not get from the node's own one-line description.
 *
 * Everything else keeps the single-sentence description the extractor wrote,
 * which for a policy or a migration is already the whole truth.
 */
/* eslint-disable no-console -- CLI entry point: stdout is the output. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codexExecSync } from "./codex";
import { load, save, GRAPH_PATH } from "./store";
import type { StoredEntity } from "./schema";

/** Types whose hubs are worth a generated profile. */
const SUMMARIZABLE = new Set([
  "TABLE",
  "VIEW",
  "DB_FUNCTION",
  "SERVICE",
  "ENTITY_CONFIG",
  "API_ENDPOINT",
  "WEBHOOK",
]);

const PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "key_facts"],
  properties: {
    summary: { type: "string" },
    key_facts: { type: "array", items: { type: "string" } },
  },
};

const PROMPT = `You are writing a profile for one node in a codebase knowledge graph.

Use ONLY the triples given. Do not use general knowledge about Next.js, Supabase, or brewery software. If the triples do not support a claim, leave it out.

summary: 2-3 sentences on what this thing is and how it sits in the system, according to the edges.
key_facts: 3-5 atomic facts, each traceable to a specific triple.`;

type Profile = { summary: string; key_facts: string[] };

function generate(
  entity: StoredEntity,
  triples: string[],
  schemaPath: string,
): Profile | undefined {
  const prompt =
    `${PROMPT}\n\nNode: ${entity.name} (${entity.type})\n` +
    `Its own description: ${entity.description}\n\n` +
    `1-hop neighborhood (${triples.length} edges):\n${triples.join("\n")}\n`;
  try {
    const out = codexExecSync(prompt, { schemaPath });
    const parsed: unknown = JSON.parse(out);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Profile).summary === "string" &&
      Array.isArray((parsed as Profile).key_facts)
    ) {
      return parsed as Profile;
    }
  } catch {
    // A failed profile is not fatal - the node keeps its one-line description.
  }
  return undefined;
}

function main(): void {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const degIdx = argv.indexOf("--degree");
  const minDegree = degIdx >= 0 ? Number(argv[degIdx + 1]) : 20;

  const graph = load(root);

  const degree = new Map<string, number>();
  const neighborhood = new Map<string, string[]>();
  const files = new Map<string, Set<string>>();
  for (const l of graph.links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    const triple = `(${l.source}) --[${l.predicate}]--> (${l.target})`;
    for (const n of [l.source, l.target]) {
      (neighborhood.get(n) ?? neighborhood.set(n, []).get(n)!).push(triple);
      (files.get(n) ?? files.set(n, new Set()).get(n)!).add(l.file_path);
    }
  }

  const hubs = graph.nodes.filter(
    (n) => SUMMARIZABLE.has(n.type) && (degree.get(n.name) ?? 0) >= minDegree,
  );

  console.log(
    `${hubs.length} hub node(s) at degree >= ${minDegree} among summarizable types ` +
      `(of ${graph.nodes.length} total)`,
  );
  if (dryRun) {
    for (const h of hubs.slice(0, 40)) {
      console.log(`  ${String(degree.get(h.name)).padStart(4)}  [${h.type}] ${h.name}`);
    }
    if (hubs.length > 40) console.log(`  ... ${hubs.length - 40} more`);
    return;
  }

  const cacheDir = join(root, "tools/codegraph/llm-cache");
  mkdirSync(cacheDir, { recursive: true });
  const schemaPath = join(cacheDir, "_profile_schema.json");
  writeFileSync(schemaPath, JSON.stringify(PROFILE_SCHEMA));

  let written = 0;
  for (const [i, hub] of hubs.entries()) {
    // Cap the neighborhood: a 195-edge hub does not need every edge described,
    // and an oversized prompt costs latency for no added signal.
    const triples = [...new Set(neighborhood.get(hub.name) ?? [])].sort().slice(0, 60);
    const profile = generate(hub, triples, schemaPath);
    if (profile) {
      hub.summary = profile.summary;
      hub.key_facts = profile.key_facts;
      hub.files = [...(files.get(hub.name) ?? [])].sort().slice(0, 20);
      written++;
    }
    console.log(`  [${i + 1}/${hubs.length}] ${profile ? "ok  " : "fail"} ${hub.name}`);
  }

  // Pass the loaded fingerprint through: this run only annotated nodes, so
  // re-stamping inputs from the current tree would mark a stale graph fresh.
  save(root, { nodes: graph.nodes, links: graph.links }, graph.commit, graph.inputs);
  console.log(`wrote ${written} profile(s) into ${GRAPH_PATH}`);
}

if (import.meta.main) main();
