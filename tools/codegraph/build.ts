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
import { merge, save, gitCommit, GRAPH_PATH } from "./store";

const root = process.cwd();
const commit = gitCommit(root);
const t0 = Date.now();

const sql = runSqlPass(root, commit);
const ast = runAstPass(root, commit);
const { graph, report } = merge([sql, ast]);
save(root, graph, commit);

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`built ${GRAPH_PATH} @ ${commit.slice(0, 8)} in ${secs}s`);
console.log(
  `  entities=${report.entities} relations=${report.relations} ` +
    `dropped_orphans=${report.droppedOrphans}`,
);
