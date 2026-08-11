/**
 * Incremental update.
 *
 *   bun tools/codegraph/update.ts              # since the graph's last commit
 *   bun tools/codegraph/update.ts origin/main  # since an explicit ref
 *   bun tools/codegraph/update.ts --llm        # also refresh the LLM pass
 *
 * A deliberate split, and it differs from the cookbook's advice for a reason.
 *
 * The EXPENSIVE pass is incremental. LLM extraction is cached by content hash,
 * so a file whose bytes are unchanged is never sent to a model again. That is
 * where "the graph accumulates, it never rebuilds from scratch" actually earns
 * its keep: the second run over 360 files costs nothing.
 *
 * The CHEAP passes are rebuilt whole, on purpose. The AST and SQL passes take
 * about 7 seconds combined, and patching them per-file would be both slower to
 * write and less correct: the AST pass resolves imports and call targets
 * against a whole-program TypeScript compile, so editing one file can change
 * edges in files that were not touched (a renamed export invalidates every
 * importer). Splicing per-file deltas into a stale graph would silently leave
 * those behind. Seven seconds buys exactness, so we spend it.
 *
 * The last processed commit is recorded on the graph so the next run knows its
 * own diff range.
 */
/* eslint-disable no-console -- CLI entry point: stdout is the output. */
import { execFileSync } from "node:child_process";
import { runAstPass } from "./ast";
import { runSqlPass } from "./sql";
import { runLlmPass, llmCorpus } from "./extract";
import { resolveGraph } from "./resolve";
import { merge, save, gitCommit, tryLoad, llmPart, carryProfiles, GRAPH_PATH } from "./store";

/** Files changed between `ref` and HEAD, repo-relative. */
function changedFiles(repoRoot: string, ref: string): string[] {
  // execFile with an argument array - `ref` comes from argv, so never build a
  // shell string out of it.
  const out = execFileSync("git", ["diff", "--name-only", `${ref}..HEAD`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

async function main(): Promise<void> {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  const withLlm = argv.includes("--llm");
  const explicitRef = argv.find((a) => !a.startsWith("--"));

  const head = gitCommit(root);
  const prevGraph = tryLoad(root);
  const previous = prevGraph?.commit;

  const ref = explicitRef ?? previous;
  let changed: string[] = [];
  if (ref && ref !== head) {
    try {
      changed = changedFiles(root, ref);
    } catch {
      console.error(`Could not diff ${ref}..HEAD; treating this as a full build.`);
    }
  }

  if (ref === head && !withLlm) {
    console.log(`graph is already at ${head.slice(0, 8)}; nothing to do`);
    return;
  }

  console.log(
    ref
      ? `updating ${ref.slice(0, 8)}..${head.slice(0, 8)} (${changed.length} file(s) changed)`
      : `no previous graph - full build at ${head.slice(0, 8)}`,
  );

  const t0 = Date.now();
  const sql = runSqlPass(root);
  const ast = runAstPass(root);
  const parts = [sql, ast];
  // The AST pass is the authority on which endpoints exist; the LLM pass is
  // held to it so it cannot invent routes.
  const knownEndpoints = new Set(
    ast.entities
      .filter((e) => e.type === "API_ENDPOINT" || e.type === "WEBHOOK")
      .map((e) => e.name),
  );

  const reExtracted = new Set<string>();
  if (withLlm) {
    const corpus = llmCorpus(root);
    // Filter to changed files when we have a diff; otherwise run the whole
    // corpus, which the content-hash cache makes nearly free on a re-run.
    const targets =
      changed.length > 0 ? corpus.filter((f) => changed.includes(f)) : corpus;
    if (targets.length === 0) {
      console.log("  llm: no corpus files changed");
    } else {
      console.log(`  llm: ${targets.length} file(s) (cache skips unchanged)`);
      for (const f of targets) reExtracted.add(f);
      parts.push(
        await runLlmPass(root, {
          files: targets,
          knownEndpoints,
          onProgress: (d, t, f, cached) =>
            console.log(`    [${d}/${t}] ${cached ? "cached" : "ran   "} ${f}`),
        }),
      );
    }
  }

  // Carry prior LLM facts for every file not re-extracted this run (all of
  // them, without --llm), and hub profiles — no pass reproduces either.
  parts.push(llmPart(prevGraph, reExtracted));
  const { graph: mergedGraph } = merge(parts);
  const { graph, report } = resolveGraph(mergedGraph);
  carryProfiles(prevGraph, graph);
  save(root, graph, head);

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`wrote ${GRAPH_PATH} @ ${head.slice(0, 8)} in ${secs}s`);
  console.log(`  entities=${graph.nodes.length} relations=${graph.links.length}`);
  console.log(
    `  resolved: ${report.merged.length} merged, ${report.edgesRewritten} edge(s) rewritten, ` +
      `${report.suspicious.length} suspicious`,
  );
  for (const s of report.suspicious) {
    console.log(`    ? ${s.canonical} <- ${s.aliases.join(", ")}  (${s.reason})`);
  }
}

if (import.meta.main) await main();
