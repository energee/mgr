/**
 * Graph query interface.
 *
 *   bun tools/codegraph/query.ts "batches"                 # k=2 subgraph as triples
 *   bun tools/codegraph/query.ts "what writes to batches"  # fuzzy seed + triples
 *   bun tools/codegraph/query.ts --answer "..."            # also draft an answer
 *   bun tools/codegraph/query.ts --hops 1 --exact "batches"
 *
 * Default output is the serialized subgraph, nothing else. That is the useful
 * primitive: inside Claude Code the harness already has a model, so printing
 * triples and letting it reason costs nothing and keeps the answer grounded.
 * `--answer` exists for standalone use and shells out to codex.
 *
 * Grounding rule (enforced in the prompt, and in the instructions the /graph
 * command carries): answer ONLY from the triples, cite the edges used, and say
 * plainly what the graph does not contain. Never fall back to general knowledge
 * about the code - an ungrounded answer defeats the point of building this.
 */
/* eslint-disable no-console -- CLI entry point: stdout is the output. */
import { load, isStale, rebuild, gitCommit, type Graph } from "./store";
import { codexExecSync } from "./codex";
import type { StoredEntity, StoredRelation } from "./schema";

type Subgraph = {
  seed: StoredEntity;
  triples: string[];
  nodes: StoredEntity[];
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Score a candidate node against a free-text query. Higher is better. */
function score(entity: StoredEntity, needle: string): number {
  const n = needle.toLowerCase();
  const name = entity.name.toLowerCase();
  if (name === n) return 1000;
  for (const a of entity.aliases) if (a.toLowerCase() === n) return 900;
  // Prefer a whole-word hit over an incidental substring: "orders" should not
  // rank `order_items` above `orders`.
  if (new RegExp(`(^|[^a-z0-9])${escapeRe(n)}([^a-z0-9]|$)`).test(name)) return 500;
  if (name.includes(n)) return 200 - Math.abs(name.length - n.length);
  for (const a of entity.aliases) if (a.toLowerCase().includes(n)) return 100;
  return -1;
}

/** Words that carry no entity signal when a whole question is passed in. */
const STOPWORDS = new Set([
  "what", "which", "who", "where", "how", "why", "does", "do", "is", "are",
  "the", "a", "an", "to", "from", "of", "on", "in", "for", "and", "or",
  "depends", "depend", "breaks", "break", "touch", "touches", "uses", "use",
  "change", "changes", "if", "i", "path", "full", "happens", "when",
]);

/** Find the best seed node for a free-text query. */
function findSeed(graph: Graph, query: string, exact = false): StoredEntity | undefined {
  if (exact) return graph.nodes.find((n) => n.name === query);

  const candidates = [
    query,
    ...query
      .split(/\s+/)
      .filter((w) => !STOPWORDS.has(w.toLowerCase()) && w.length > 2),
  ];
  // Sum across terms rather than taking the best single one. A node matching
  // both "square" and "webhook" must outrank one matching only "webhook" —
  // otherwise the two tie at the same per-term score and iteration order wins,
  // which is how "square webhook" resolved to a migration file that merely has
  // "webhook" in its filename.
  let best: StoredEntity | undefined;
  let bestScore = 0;
  for (const node of graph.nodes) {
    let total = 0;
    for (const term of candidates) {
      const s = score(node, term);
      // Longer search terms are stronger evidence, so weight by term length.
      if (s > 0) total += s + term.length;
    }
    if (total > bestScore) {
      bestScore = total;
      best = node;
    }
  }
  return best;
}

/**
 * BFS outward from `center` in BOTH directions for `hops` levels, and return
 * the induced subgraph serialized as sorted triples.
 */
function serializeSubgraph(
  graph: Graph,
  center: string,
  hops = 2,
): Subgraph | undefined {
  const seed = graph.nodes.find((n) => n.name === center);
  if (!seed) return undefined;

  const out = new Map<string, StoredRelation[]>();
  const inn = new Map<string, StoredRelation[]>();
  for (const l of graph.links) {
    (out.get(l.source) ?? out.set(l.source, []).get(l.source)!).push(l);
    (inn.get(l.target) ?? inn.set(l.target, []).get(l.target)!).push(l);
  }

  const nodes = new Set<string>([center]);
  let frontier = new Set<string>([center]);
  for (let i = 0; i < hops; i++) {
    const next = new Set<string>();
    for (const n of frontier) {
      for (const l of out.get(n) ?? []) if (!nodes.has(l.target)) next.add(l.target);
      for (const l of inn.get(n) ?? []) if (!nodes.has(l.source)) next.add(l.source);
    }
    for (const n of next) nodes.add(n);
    frontier = next;
  }

  // Induced subgraph: every edge with both endpoints inside the ball.
  const triples = graph.links
    .filter((l) => nodes.has(l.source) && nodes.has(l.target))
    .map((l) => `(${l.source}) --[${l.predicate}]--> (${l.target})`);

  const byName = new Map(graph.nodes.map((n) => [n.name, n]));
  return {
    seed,
    triples: [...new Set(triples)].sort(),
    nodes: [...nodes].map((n) => byName.get(n)).filter((n): n is StoredEntity => !!n),
  };
}

const GROUNDING = `You are answering a question about a codebase using ONLY the graph triples below.

Rules, in order of importance:
1. Use ONLY these triples. Do not use any general knowledge about how codebases, Next.js, Supabase, or this project work. If the triples do not answer the question, say so.
2. Cite the specific edges you used, written out as triples.
3. State explicitly what the graph does NOT contain that would be needed for a fuller answer.
4. Do not speculate about edges that "probably" exist. A missing edge means the graph does not know, not that the relationship is absent.`;

function answer(question: string, sub: Subgraph): string {
  const prompt =
    `${GROUNDING}\n\nQuestion: ${question}\n\n` +
    `Seed entity: ${sub.seed.name} (${sub.seed.type}) - ${sub.seed.description}\n\n` +
    `Triples (${sub.triples.length}):\n${sub.triples.join("\n")}\n`;
  return codexExecSync(prompt);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantAnswer = argv.includes("--answer");
  const exact = argv.includes("--exact");
  const hopsIdx = argv.indexOf("--hops");
  const hops = hopsIdx >= 0 ? Number(argv[hopsIdx + 1]) : 2;
  // NaN would silently skip the BFS and report a seed-only, zero-edge subgraph
  // as if the entity had no relationships - fail loudly instead.
  if (!Number.isInteger(hops) || hops < 0) {
    console.error(`--hops requires a non-negative integer, got: ${argv[hopsIdx + 1] ?? "(nothing)"}`);
    process.exit(2);
  }
  const query = argv
    .filter((a, i) => !a.startsWith("--") && !(hopsIdx >= 0 && i === hopsIdx + 1))
    .join(" ")
    .trim();

  if (!query) {
    console.error(
      'usage: bun tools/codegraph/query.ts [--hops N] [--exact] [--answer] "<entity or question>"',
    );
    process.exit(2);
  }

  let graph = load(process.cwd());

  // Auto-refresh rather than warn. The deterministic passes take ~7s and run
  // offline, so a stale answer is never worth saving that. LLM edges (~1% of
  // the graph) are preserved from the existing file rather than re-run, since
  // that needs a subscription; `update.ts --llm` refreshes those explicitly.
  if (!argv.includes("--no-refresh") && isStale(process.cwd(), graph)) {
    const root = process.cwd();
    graph = (await rebuild(root, gitCommit(root))).graph;
    console.error(`# graph was stale; rebuilt in-place (llm edges preserved)`);
  }
  const seed = findSeed(graph, query, exact);
  if (!seed) {
    console.error(
      `No entity matches "${query}". The graph has ${graph.nodes.length} entities.`,
    );
    process.exit(1);
  }

  const sub = serializeSubgraph(graph, seed.name, hops);
  if (!sub) {
    console.error(`Seed "${seed.name}" vanished between lookup and traversal.`);
    process.exit(1);
  }

  const src = sub.seed.db_source ? `, ${sub.seed.db_source}` : "";
  console.log(`# seed: ${sub.seed.name}  (${sub.seed.type}${src})`);
  console.log(`# ${sub.seed.description}`);
  console.log(`# k=${hops} subgraph: ${sub.nodes.length} nodes, ${sub.triples.length} edges`);
  console.log(`# graph built from commit ${graph.commit.slice(0, 8)}`);
  console.log();
  for (const t of sub.triples) console.log(t);

  if (wantAnswer) {
    console.log(`\n--- answer (grounded only in the triples above) ---\n`);
    console.log(answer(query, sub));
  }
}

if (import.meta.main) await main();
