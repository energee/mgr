/**
 * Full graph build from the deterministic passes (AST + SQL).
 *
 * Free and fast (~10s) - no API calls, no network. The LLM pass is separate
 * (extract.ts) and only adds semantic edges no parser can produce.
 *
 *   bun tools/codegraph/build.ts
 */
/* eslint-disable no-console -- CLI entry point: stdout is the output. */
import { runAstPass } from "./ast";
import { runSqlPass } from "./sql";
import { merge, save, gitCommit, tryLoad, llmPart, carryProfiles, GRAPH_PATH } from "./store";

const root = process.cwd();
const commit = gitCommit(root);
const t0 = Date.now();

// LLM edges and hub profiles come from paid passes the deterministic build
// cannot reproduce — carry them from the existing graph or they are deleted.
const prev = tryLoad(root);
const sql = runSqlPass(root);
const ast = runAstPass(root);
const { graph, report } = merge([sql, ast, llmPart(prev)]);
carryProfiles(prev, graph);
save(root, graph, commit);

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`built ${GRAPH_PATH} @ ${commit.slice(0, 8)} in ${secs}s`);
console.log(
  `  entities=${report.entities} relations=${report.relations} ` +
    `dropped_orphans=${report.droppedOrphans}`,
);
