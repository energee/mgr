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
import { runLlmPass, llmCorpus } from "./extract";
import { rebuild, gitCommit, tryLoad, isStale, GRAPH_PATH, type GraphPart } from "./store";

/**
 * Files changed since `ref`, repo-relative: the committed diff PLUS the
 * working tree (uncommitted edits and untracked files). Committed-only was a
 * bug: an uncommitted rewrite of a corpus file kept its stale LLM edges while
 * this tool reported success.
 */
function changedFiles(repoRoot: string, ref: string): string[] {
  // execFile with an argument array - `ref` comes from argv, so never build a
  // shell string out of it.
  const run = (args: string[]) =>
    execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  return [
    ...new Set([
      ...run(["diff", "--name-only", `${ref}..HEAD`]),
      ...run(["diff", "--name-only", "HEAD"]),
      ...run(["ls-files", "-o", "--exclude-standard"]),
    ]),
  ];
}

async function main(): Promise<void> {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  const withLlm = argv.includes("--llm");
  const explicitRef = argv.find((a) => !a.startsWith("--"));

  const head = gitCommit(root);
  const prev = tryLoad(root);
  const previous = prev?.commit;

  const ref = explicitRef ?? previous;
  let changed: string[] = [];
  if (ref && ref !== head) {
    try {
      changed = changedFiles(root, ref);
    } catch {
      console.error(`Could not diff ${ref}..HEAD; treating this as a full build.`);
    }
  }

  // Same commit is NOT the same inputs: uncommitted working-tree edits are the
  // most common way a graph goes stale mid-session, and isStale() exists for
  // exactly that. Only skip when the fingerprint matches too.
  if (ref === head && !withLlm && prev && !isStale(root, prev)) {
    console.log(`graph is already at ${head.slice(0, 8)} and matches the working tree; nothing to do`);
    return;
  }

  console.log(
    ref
      ? `updating ${ref.slice(0, 8)}..${head.slice(0, 8)} (${changed.length} file(s) changed)`
      : `no previous graph - full build at ${head.slice(0, 8)}`,
  );

  const t0 = Date.now();
  // rebuild() owns the pipeline (passes -> merge/carry -> resolve -> save);
  // this entry point only decides which files the LLM pass re-extracts.
  const { graph, resolution: report } = await rebuild(
    root,
    head,
    withLlm
      ? async (knownEndpoints) => {
          const none: GraphPart = { entities: [], relations: [] };
          const corpus = llmCorpus(root);
          // Filter to changed files when we have a diff; otherwise run the whole
          // corpus, which the content-hash cache makes nearly free on a re-run.
          const targets =
            changed.length > 0 ? corpus.filter((f) => changed.includes(f)) : corpus;
          if (targets.length === 0) {
            console.log("  llm: no corpus files changed");
            return { fresh: none, reExtracted: new Set<string>() };
          }
          console.log(`  llm: ${targets.length} file(s) (cache skips unchanged)`);
          const fresh = await runLlmPass(root, {
            files: targets,
            knownEndpoints,
            onProgress: (d, t, f, cached) =>
              console.log(`    [${d}/${t}] ${cached ? "cached" : "ran   "} ${f}`),
          });
          // Only files that actually produced output count as re-extracted:
          // marking a failed file re-extracted would make llmPart() drop its
          // previously cached facts on a run that reports success.
          const failed = new Set(fresh.failed);
          for (const f of fresh.failed) console.error(`  llm: FAILED ${f} (cached facts kept)`);
          return {
            fresh,
            reExtracted: new Set(targets.filter((f) => !failed.has(f))),
          };
        }
      : undefined,
  );

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
