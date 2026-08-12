/**
 * The one place the `codex exec` invocation lives.
 *
 * Every caller (extract.ts, query.ts --answer, summarize.ts) previously
 * hand-built the same nine-flag argv; a model or flag change was a three-file
 * edit and the hard-won invocation lore was only written down at one of them.
 * That lore, so it survives:
 *   - stdin MUST be closed or codex blocks forever on "Reading additional
 *     input from stdin..." and never calls the API.
 *   - `--ignore-user-config`: the global default is sol @ xhigh — far too slow.
 *   - "minimal" reasoning effort does not exist on these models; low is the floor.
 *   - execFile with an argument array: no shell, nothing in a prompt is interpreted.
 */
import { execFile, execFileSync } from "node:child_process";

export const MODEL = "gpt-5.3-codex-spark";
const EFFORT = "low";
const MAX_BUFFER = 32 * 1024 * 1024;

function argsFor(prompt: string, o: { schemaPath?: string; outPath?: string }): string[] {
  return [
    "exec",
    "--ignore-user-config",
    "-s",
    "read-only",
    "--ephemeral",
    "--skip-git-repo-check",
    "-m",
    MODEL,
    "-c",
    `model_reasoning_effort="${EFFORT}"`,
    ...(o.schemaPath ? ["--output-schema", o.schemaPath] : []),
    ...(o.outPath ? ["-o", o.outPath] : []),
    prompt,
  ];
}

/** Synchronous call returning stdout. Throws on non-zero exit. */
export function codexExecSync(prompt: string, o: { schemaPath?: string } = {}): string {
  return execFileSync("codex", argsFor(prompt, o), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_BUFFER,
  });
}

/** Async call writing the last message to outPath. Rejects on non-zero exit or timeout. */
export function codexExec(
  prompt: string,
  o: { schemaPath: string; outPath: string; cwd: string; timeoutMs: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "codex",
      argsFor(prompt, o),
      { cwd: o.cwd, timeout: o.timeoutMs, maxBuffer: MAX_BUFFER },
      (err) => (err ? reject(err) : resolve()),
    );
    child.stdin?.end();
  });
}
