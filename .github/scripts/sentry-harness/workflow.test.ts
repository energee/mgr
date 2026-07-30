import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agentHoldsWrite, agentJobsOf, flagValues } from "../workflow-egress";

const PATH = ".github/workflows/sentry-harness.yml";
const workflow = readFileSync(resolve(process.cwd(), PATH), "utf8");

/** The tools `fix-error`'s single agent step allows, parsed from claude_args. */
function allowedTools(): string[] {
  const agent = agentJobsOf(workflow).find((entry) => entry.name === "fix-error");
  expect(agent, "fix-error must parse as the agent job").toBeDefined();
  expect(agent!.steps).toHaveLength(1);
  return agent!.steps[0].argStrings
    .flatMap((args) => flagValues(args, "allowedTools"))
    .flatMap((value) => value.split(","))
    .map((tool) => tool.trim());
}

/** Job body from its key to the next top-level job key (or EOF). */
function job(name: string): string {
  const match = workflow.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)`));
  expect(match, `${PATH} has no job named ${name}`).not.toBeNull();
  return match![1];
}

describe("Sentry harness workflow", () => {
  it("allows the scoring job to read pull requests for deduplication", () => {
    expect(job("score-errors")).toMatch(
      /\n    permissions:\n      contents: read\n      pull-requests: read\n/,
    );
  });

  // Issue #668. The agent job reads raw Sentry event text and, because it can
  // Edit files and run `make check`/`bun run test`, can execute arbitrary code —
  // so no allowlist makes it exfiltration-proof. The remedy is that it holds
  // nothing worth stealing, which takes TWO things:
  //   - read-only `permissions:` (scopes this job's GITHUB_TOKEN),
  //   - `github_token:` on the agent step (otherwise the action mints a Claude
  //     App token hardcoded to contents/pull_requests/issues: write and assigns
  //     it to the agent's GITHUB_TOKEN/GH_TOKEN — no permissions block
  //     restrains that), and no `id-token: write` (the OIDC assertion that
  //     exchange needs).
  //
  // `persist-credentials: false` is NOT a third thing, and the earlier version
  // of this comment said it was. At the pinned action SHA, configureGitAuth()
  // writes `https://x-access-token:<token>@github.com/...` into the origin
  // remote right after checkout, so the workspace is not token-free either way.
  // The flag is still set — it covers the window before the action runs — and
  // still pinned below, but as hygiene, not as the control.
  describe("fix-error holds no push-capable credential (#668)", () => {
    const fixError = job("fix-error");

    it("declares only read scopes", () => {
      // Indented scope lines, not substrings — the job's comment block quotes
      // several of these in prose (see the persist-credentials test below).
      expect(fixError).toMatch(/\n {6}contents: read\n/);
      expect(fixError).not.toMatch(/\n {6}contents: write\n/);
      expect(fixError).not.toMatch(/\n {6}issues: write\n/);
      expect(fixError).not.toMatch(/\n {6}pull-requests: write\n/);
    });

    it("binds the agent to this job's own token instead of a minted app token", () => {
      expect(fixError).toMatch(/\n {10}github_token: \$\{\{ secrets\.GITHUB_TOKEN \}\}\n/);
      // No OIDC assertion available, so the app-token exchange cannot run even
      // if the input above were dropped.
      expect(fixError).not.toMatch(/\n {6}id-token: write\n/);
    });

    it("parses as holding no write credential from either source", () => {
      const parsed = agentJobsOf(workflow).find((entry) => entry.name === "fix-error");

      expect(parsed, "fix-error must still parse as the agent job").toBeDefined();
      expect(parsed!.mintsAppToken).toBe(false);
      expect(agentHoldsWrite(parsed!)).toBe(false);
    });

    // Matched as an indented `with:` input, not as a substring: the job's own
    // comment quotes "`persist-credentials: false`" in prose, and a plain
    // toContain passed with the real setting deleted.
    it("checks out without persisting checkout's own git credential", () => {
      expect(fixError).toMatch(/\n {10}persist-credentials: false\n/);
    });

    // A (B)/(C) triage must pack an EMPTY patch, and the packing step diffs
    // the whole tree — so an agent-run `bun install` that rewrote bun.lock
    // fails the lander. Install deterministically before the agent instead.
    it("installs dependencies deterministically before the agent runs", () => {
      expect(fixError).toMatch(/\n {8}run: bun install --frozen-lockfile\n/);
      expect(fixError.indexOf("bun install --frozen-lockfile")).toBeLessThan(
        fixError.indexOf("anthropics/claude-code-action"),
      );
    });

    // Asserted against the parsed allowlist, not the raw text — the comment
    // above it in the workflow legitimately names the removed grants.
    it("grants no write-capable gh command", () => {
      const tools = allowedTools();

      // `Bash(gh issue:*)` would re-grant create/comment through the glob.
      expect(tools).not.toContain("Bash(gh issue:*)");
      expect(tools).not.toContain("Bash(gh pr create:*)");
      expect(tools.filter((tool) => /gh (issue|pr) (create|comment|merge|edit|close)/.test(tool))).toEqual(
        [],
      );
      // Read-only gh stays: step 0 greps prior triage issues.
      expect(tools).toContain("Bash(gh issue list:*)");
      // The pipeline's validation commands must stay reachable, or the run
      // stalls on permission denials (this job's historical failure mode).
      for (const tool of ["Bash(bun:*)", "Bash(bunx:*)", "Bash(make:*)", "Bash(git:*)", "Task"]) {
        expect(tools, `${tool} is named by the prompt and must stay allowed`).toContain(tool);
      }
    });

    it("ships the agent's outcome as an artifact instead of pushing it", () => {
      expect(fixError).toContain("outbox/plan.json");
      expect(fixError).toContain("actions/upload-artifact@v7");
      expect(fixError).toContain("if-no-files-found: error");
      // The patch is derived by git from the tree, never authored by the agent.
      expect(fixError).toContain('git diff --cached --binary "$BASE_SHA"');
    });
  });

  describe("land-fix owns the writes and runs no agent", () => {
    const landFix = job("land-fix");

    it("holds the write scopes the agent gave up", () => {
      expect(landFix).toContain("contents: write");
      expect(landFix).toContain("pull-requests: write");
      expect(landFix).toContain("issues: write");
    });

    it("invokes no generative agent", () => {
      expect(landFix).not.toContain("claude-code-action");
      expect(agentJobsOf(workflow).map((entry) => entry.name)).toEqual(["fix-error"]);
    });

    // The artifact is untrusted agent output: it may be applied, never executed.
    it("applies the patch through the lander and never runs agent-authored code", () => {
      expect(landFix).toContain("bun .github/scripts/land-sentry-fix.ts");
      expect(landFix).not.toMatch(/\beval\b/);
      expect(landFix).not.toMatch(/bash \$\{\{|sh \$\{\{/);
      // Downloaded outside the work tree so it cannot overwrite the lander.
      expect(landFix).toContain("path: ${{ runner.temp }}/outbox");
    });

    it("fails the leg when the agent produced no outbox", () => {
      expect(landFix).toContain("steps.outbox.outcome != 'success'");
      expect(landFix).toContain("exit 1");
    });

    it("keeps the durable-outcome gate on the job that knows the outcome", () => {
      expect(landFix).toContain("require-durable-outcome");
      expect(landFix).toContain("match: SENTRY-${{ matrix.error.issueId }}");
      expect(landFix).toContain("outcome-file: sentry-outcome.md");
    });

    // One leg of a fail-fast: false matrix dying must not strand the others.
    it("still runs when a sibling fix leg failed", () => {
      expect(landFix).toContain("!cancelled()");
      expect(landFix).toContain("needs.score-errors.result == 'success'");
    });
  });
});
