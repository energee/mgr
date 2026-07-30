// Contract coverage for the Sentry harness lander (issue #668).
//
// `land-sentry-fix.ts` is the only credentialed code path in the split design:
// it takes an untrusted artifact and turns it into pushed commits, PRs and
// issue comments. Validating `outbox.ts` is not coverage of that — the parser
// never touches git or gh — so this file drives the real sequence:
//
//   * real `git`, against a scratch repository with a real bare `origin`, so
//     `worktree add` / `apply` / `commit` / `ls-remote` / `push` all execute
//     for real and a broken argv fails here rather than in production;
//   * a stub `gh` on PATH that records every argv it was handed, so the
//     "agent text never reaches a shell" rule is checked as data rather than
//     asserted in a comment.
//
// The stub is written as an extensionless Node script (Node treats those as
// CommonJS) instead of a shell script, so nothing in the fixture re-introduces
// the shell interpolation the lander exists to avoid.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { landSentryFix } from "./land-sentry-fix";

// Every case here spawns real `git` (init, worktree add, apply, commit,
// ls-remote, push) plus the stub `gh`. Alone that is well under a second a
// case; sharing a worker pool with the other ~210 files it is not, and the 5s
// default made this file the only flaky one in `make check`.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const PR_URL = "https://github.com/energee/mgr/pull/9001";
const ISSUE_URL = "https://github.com/energee/mgr/issues/9002";
const COMMENT_URL = "https://github.com/energee/mgr/issues/9002#issuecomment-1";

const GH_STUB = `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_STUB_LOG, JSON.stringify(args) + "\\n");
const state = JSON.parse(fs.readFileSync(process.env.GH_STUB_STATE, "utf8"));
const [a, b] = args;
if (a === "pr" && b === "list") {
  process.stdout.write(state.existingPrUrl || "");
} else if (a === "pr" && b === "create") {
  process.stdout.write(state.prUrl);
} else if (a === "issue" && b === "create") {
  process.stdout.write(state.issueUrl);
} else if (a === "issue" && b === "view") {
  const labels = state.labels[args[2]];
  if (labels === undefined) {
    process.stderr.write("gh stub: no such issue " + args[2]);
    process.exit(1);
  }
  process.stdout.write(labels.join(","));
} else if (a === "issue" && b === "comment") {
  process.stdout.write(state.commentUrl);
} else {
  process.stderr.write("gh stub: unhandled " + args.join(" "));
  process.exit(1);
}
`;

type Harness = {
  root: string;
  workspace: string;
  outboxDir: string;
  baseSha: string;
  ghLog: string;
  ghState: string;
};

let harness: Harness;
let originalPath: string | undefined;

/** Run a real git command, failing the test loudly with git's own stderr. */
function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { encoding: "utf8", cwd });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}${result.stdout}`);
  }
  return result.stdout.trim();
}

function ghCalls(): string[][] {
  const log = readFileSync(harness.ghLog, "utf8").trim();
  return log ? log.split("\n").map((line) => JSON.parse(line) as string[]) : [];
}

function setGhState(state: Record<string, unknown>): void {
  writeFileSync(
    harness.ghState,
    JSON.stringify({
      prUrl: PR_URL,
      issueUrl: ISSUE_URL,
      commentUrl: COMMENT_URL,
      existingPrUrl: "",
      labels: { "77": ["sentry-fix", "needs-human"], "1": ["documentation"] },
      ...state,
    }),
  );
}

/** `outbox/` as the packing step would have uploaded it. */
function writeOutbox(files: Record<string, string>): void {
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(harness.outboxDir, name), contents);
  }
}

const FOO_PATCH = [
  "diff --git a/src/lib/foo.ts b/src/lib/foo.ts",
  "--- a/src/lib/foo.ts",
  "+++ b/src/lib/foo.ts",
  "@@ -1 +1 @@",
  "-export const a = 1;",
  "+export const a = 2;",
  "",
].join("\n");

const diffFor = (path: string): string =>
  `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+x\n`;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "land-sentry-test-"));
  const workspace = join(root, "work");
  const origin = join(root, "origin.git");
  const outboxDir = join(root, "outbox");
  const bin = join(root, "bin");
  mkdirSync(outboxDir);
  mkdirSync(bin);

  git(["-c", "init.defaultBranch=main", "init", "--bare", origin], root);
  git(["-c", "init.defaultBranch=main", "init", workspace], root);
  git(["config", "user.name", "Fixture"], workspace);
  git(["config", "user.email", "fixture@example.com"], workspace);
  mkdirSync(join(workspace, "src", "lib"), { recursive: true });
  writeFileSync(join(workspace, "src", "lib", "foo.ts"), "export const a = 1;\n");
  git(["add", "-A"], workspace);
  git(["commit", "-m", "chore: fixture base"], workspace);
  git(["remote", "add", "origin", origin], workspace);
  git(["push", "origin", "HEAD:refs/heads/main"], workspace);

  const ghPath = join(bin, "gh");
  writeFileSync(ghPath, GH_STUB);
  chmodSync(ghPath, 0o755);

  harness = {
    root,
    workspace,
    outboxDir,
    baseSha: git(["rev-parse", "HEAD"], workspace),
    ghLog: join(root, "gh-calls.log"),
    ghState: join(root, "gh-state.json"),
  };
  writeFileSync(harness.ghLog, "");
  setGhState({});

  originalPath = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`;
  process.env.GH_STUB_LOG = harness.ghLog;
  process.env.GH_STUB_STATE = harness.ghState;
});

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.GH_STUB_LOG;
  delete process.env.GH_STUB_STATE;
});

const land = (): string[] =>
  landSentryFix({ outboxDir: harness.outboxDir, issueId: "4242", workspace: harness.workspace });

describe("landSentryFix — the (A) fix path", () => {
  beforeEach(() => {
    writeOutbox({
      "plan.json": JSON.stringify({ classification: "A", pr: { title: "guard the null deref" } }),
      "pr-body.md": "## Sentry Fix\n\nRoot cause: `$(whoami)` and `; rm -rf /` in the body.\n",
      "base-sha": `${harness.baseSha}\n`,
      "fix.patch": FOO_PATCH,
    });
  });

  it("applies the patch at the recorded base and pushes the branch to origin", () => {
    land();

    const pushed = git(["ls-remote", "--heads", "origin", "sentry-fix/SENTRY-4242"], harness.workspace);
    expect(pushed).toContain("refs/heads/sentry-fix/SENTRY-4242");

    const landedFile = git(
      ["show", "refs/remotes/origin/sentry-fix/SENTRY-4242:src/lib/foo.ts"],
      harness.workspace,
    );
    expect(landedFile).toBe("export const a = 2;");
  });

  it("normalizes the commit subject to a conventional prefix (AGENTS.md 16)", () => {
    land();
    git(["fetch", "origin", "sentry-fix/SENTRY-4242"], harness.workspace);
    const subject = git(["log", "-1", "--format=%s", "FETCH_HEAD"], harness.workspace);

    expect(subject).toBe("fix: guard the null deref");
  });

  it("passes the body as a file and never as an argument", () => {
    land();
    const create = ghCalls().find((call) => call[0] === "pr" && call[1] === "create");

    expect(create).toBeDefined();
    expect(create).toContain("--body-file");
    // The agent's shell metacharacters must appear only inside the file.
    expect(create?.join(" ")).not.toContain("rm -rf");
    const bodyFile = create?.[create.indexOf("--body-file") + 1] ?? "";
    expect(readFileSync(bodyFile, "utf8")).toContain("rm -rf");
  });

  it("writes the PR url into sentry-outcome.md for the durable-outcome gate", () => {
    land();

    expect(readFileSync(join(harness.workspace, "sentry-outcome.md"), "utf8")).toBe(
      `Outcome: ${PR_URL}\n`,
    );
  });

  // The failure this used to have: a plain push to a fixed branch name.
  it("succeeds on a re-run and reports the PR that is already open", () => {
    land();
    setGhState({ existingPrUrl: PR_URL });
    writeFileSync(join(harness.workspace, "sentry-outcome.md"), "");

    expect(() => land()).not.toThrow();
    expect(readFileSync(join(harness.workspace, "sentry-outcome.md"), "utf8")).toBe(
      `Outcome: ${PR_URL}\n`,
    );
    // One create on the first run, none on the second.
    expect(ghCalls().filter((call) => call[0] === "pr" && call[1] === "create")).toHaveLength(1);
  });

  it("refuses a patch whose base commit is not in the repository", () => {
    writeOutbox({ "base-sha": "0123456789abcdef0123456789abcdef01234567\n" });

    expect(() => land()).toThrow(/worktree add/);
  });
});

describe("landSentryFix — rejections happen before anything is published", () => {
  const expectNothingPublished = (): void => {
    expect(ghCalls()).toEqual([]);
    expect(git(["ls-remote", "--heads", "origin"], harness.workspace)).not.toContain("sentry-fix/");
  };

  it("fails loudly when the agent wrote no plan", () => {
    expect(() => land()).toThrow(/plan\.json is missing or empty/);
    expectNothingPublished();
  });

  it.each(["Makefile", "scripts/db-push.sh", "package.json", ".claude/settings.json"])(
    "refuses a patch touching %s",
    (path) => {
      writeOutbox({
        "plan.json": JSON.stringify({ classification: "A", pr: { title: "fix: sneak" } }),
        "pr-body.md": "body\n",
        "base-sha": `${harness.baseSha}\n`,
        "fix.patch": diffFor(path),
      });

      expect(() => land()).toThrow(/build\/tooling entry point/);
      expectNothingPublished();
    },
  );

  it("refuses a (B) triage that left code changes in the tree", () => {
    writeOutbox({
      "plan.json": JSON.stringify({ classification: "B", issue: { title: "[sentry] X: 42501" } }),
      "issue-body.md": "body\n",
      "base-sha": `${harness.baseSha}\n`,
      "fix.patch": FOO_PATCH,
    });

    expect(() => land()).toThrow(/compensating patch is forbidden/);
    expectNothingPublished();
  });
});

describe("landSentryFix — issue and comment paths", () => {
  it("files the investigation issue for a (B) triage with a clean tree", () => {
    writeOutbox({
      "plan.json": JSON.stringify({ classification: "B", issue: { title: "[sentry] X: 42501" } }),
      "issue-body.md": "Missing GRANT on get_foo.\n",
      "base-sha": `${harness.baseSha}\n`,
      "fix.patch": "",
    });

    land();
    const create = ghCalls().find((call) => call[0] === "issue" && call[1] === "create");

    expect(create).toContain("sentry-fix");
    expect(create).toContain("needs-human");
    expect(readFileSync(join(harness.workspace, "sentry-outcome.md"), "utf8")).toBe(
      `Outcome: ${ISSUE_URL}\n`,
    );
  });

  it("files the issue for an (A) the agent could not fix in 3 attempts", () => {
    writeOutbox({
      "plan.json": JSON.stringify({ classification: "A", issue: { title: "[sentry] X: gave up" } }),
      "issue-body.md": "Three attempts, no working fix.\n",
      "base-sha": `${harness.baseSha}\n`,
      "fix.patch": "",
    });

    expect(() => land()).not.toThrow();
    expect(readFileSync(join(harness.workspace, "sentry-outcome.md"), "utf8")).toBe(
      `Outcome: ${ISSUE_URL}\n`,
    );
  });

  it("comments on a prior triage issue this harness filed", () => {
    writeOutbox({
      "plan.json": JSON.stringify({ classification: "C", comment: { issue: 77 } }),
      "comment-body.md": "Still failing, same code.\n",
      "base-sha": `${harness.baseSha}\n`,
      "fix.patch": "",
    });

    land();

    expect(ghCalls().some((call) => call[0] === "issue" && call[1] === "comment")).toBe(true);
  });

  // The agent picks the number, so the target has to be checked, not trusted.
  it("refuses to comment on an issue the harness did not file", () => {
    writeOutbox({
      "plan.json": JSON.stringify({ classification: "C", comment: { issue: 1 } }),
      "comment-body.md": "arbitrary text on an arbitrary issue\n",
      "base-sha": `${harness.baseSha}\n`,
      "fix.patch": "",
    });

    expect(() => land()).toThrow(/not labelled `sentry-fix`/);
    expect(ghCalls().some((call) => call[1] === "comment")).toBe(false);
  });

  it("records evidence and publishes nothing for a quiet run", () => {
    writeOutbox({
      "plan.json": JSON.stringify({
        classification: "C",
        quietRun: { reason: "culprit route deleted from main" },
      }),
      "evidence.md": "$ git log --all --diff-filter=D -- src/app/gone/page.tsx\n<sha> removed it\n",
      "base-sha": `${harness.baseSha}\n`,
      "fix.patch": "",
    });

    land();

    expect(ghCalls()).toEqual([]);
    expect(readFileSync(join(harness.workspace, "sentry-outcome.md"), "utf8")).toContain(
      "Evidence:\n$ git log --all --diff-filter=D",
    );
  });
});
