// Deterministic doc-rot report for the docs-dream loop (docs-dream.yml).
// Scans the agent-facing markdown surface (AGENTS.md, CLAUDE.md, README.md,
// docs/**) for relative markdown links whose target file no longer exists and
// prints a markdown report. The deterministic step owns the link facts —
// including which surfaces are in scope (publish-health-audit pattern); the
// agent only interprets and fixes them.
// Always exits 0 — a broken link is the agent's work item, not a run failure.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOTS = ["AGENTS.md", "CLAUDE.md", "README.md"];
const DOCS_DIR = "docs";
// Historical-record surfaces the sweep agent is forbidden to edit (the
// workflow prompt's hard constraints name the same list) — reporting their
// rot would feed the agent work those constraints forbid, every single week.
const EXCLUDED = ["progress/", "superpowers/", "plans/", "audits/"];

// [text](target) where target is a relative path. Deliberate skips: any URI
// scheme (https:, mailto:, vscode:, …), protocol-relative //, and pure
// in-page anchors. Accidental skips it under-reports rather than flags:
// `[a](path "title")`, <angle-bracket> targets, and paths containing spaces.
// Anchors on files are stripped before the existence check (heading drift is
// the agent's judgment call, not ours).
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

export type BrokenLink = { file: string; target: string };

export function brokenLinksIn(file: string, contents: string): BrokenLink[] {
  const broken: BrokenLink[] = [];
  for (const match of contents.matchAll(LINK_RE)) {
    const raw = match[1];
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) continue;
    if (raw.includes("{")) continue; // template placeholder, not a path
    const target = raw.split("#")[0];
    if (!existsSync(resolve(dirname(file), decodeURIComponent(target)))) {
      broken.push({ file, target: raw });
    }
  }
  return broken;
}

if (import.meta.main) {
  const docs = readdirSync(DOCS_DIR, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md") && !EXCLUDED.some((dir) => f.startsWith(dir)))
    .map((f) => join(DOCS_DIR, f));
  const files = [...ROOTS, ...docs];
  const broken = files.flatMap((file) => brokenLinksIn(file, readFileSync(file, "utf8")));

  console.log(`## Doc link report (${files.length} files scanned)\n`);
  if (broken.length === 0) {
    console.log("No broken relative links.");
  } else {
    console.log(`${broken.length} broken relative link(s):\n`);
    for (const { file, target } of broken) console.log(`- \`${file}\` → \`${target}\``);
  }
}
