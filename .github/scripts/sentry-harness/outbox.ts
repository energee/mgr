/**
 * The Sentry harness "outbox" contract — the trust boundary between the
 * uncredentialed agent job and the credentialed lander (issue #668).
 *
 * `sentry-harness.yml`'s `fix-error` job runs a generative agent over raw
 * Sentry event text (production messages, URLs, request bodies) and holds no
 * write credential. Instead of pushing and opening a PR itself, the agent
 * writes `outbox/plan.json` (small scalars only) plus one markdown body file
 * per outcome, leaves its code changes in the working tree, and a deterministic
 * step packs everything into an artifact. The separate `land-fix` job — which
 * holds the write scopes and runs no agent — validates that artifact with the
 * functions here, then applies the patch with `git apply` and publishes via
 * `gh`. Bodies live in files rather than inline JSON so a long markdown PR body
 * never has to survive JSON escaping: a malformed body file is a validation
 * error, but a malformed `plan.json` throws the whole 45-minute run away.
 *
 * Everything in the artifact is untrusted agent output, so every function in
 * this file is a *rejecting* parser: it either returns a normalized value or
 * throws. Nothing here executes, evaluates, or shell-interpolates the agent's
 * text — the lander passes it to `git`/`gh` as argv entries and body files.
 *
 * Pure and side-effect free so `outbox.test.ts` can exercise the rules
 * directly; the I/O lives in `.github/scripts/land-sentry-fix.ts`.
 */

/** Root-cause classification from step 0 of the fix prompt. */
export type Classification = "A" | "B" | "C" | "D";

/**
 * Markdown body the agent writes for each outcome section. Fixed names, so
 * `plan.json` never carries a path the lander would have to sanitize.
 */
export const BODY_FILES = {
  pr: "pr-body.md",
  issue: "issue-body.md",
  comment: "comment-body.md",
  quietRun: "evidence.md",
} as const;

/** What the agent asks the lander to publish. Absent sections are `null`. */
export type OutboxPlan = {
  classification: Classification;
  /** Open a PR from the packed patch. */
  pr: { title: string; body: string } | null;
  /** File a new investigation issue. */
  issue: { title: string; body: string } | null;
  /** Comment on an existing investigation issue instead of filing a duplicate. */
  comment: { issue: number; body: string } | null;
  /** No artifact at all (stale event) — evidence for the durable-outcome gate. */
  quietRun: { reason: string; evidence: string } | null;
};

/**
 * A patch may not touch CI, or any file that is *itself* an executor one hop
 * from CI. A Sentry fix is an application-code fix; nothing about one
 * legitimately rewrites the workflow that produced it, the `Makefile` that
 * `make check` runs, a script under `scripts/`, the `package.json` lifecycle
 * hooks `bun install` runs, or the `.claude/` hooks that fire in every local
 * agent session.
 *
 * Stated honestly, because the first version of this list said otherwise: this
 * is **not** a general defense against a hostile patch. What the list does is
 * refuse the *build and automation surface*: the places where a change is
 * executed without anyone reading it as code under review. Test files used to
 * be the disclosed gap — prompt step 5 requires one, and it ran in CI on the
 * unreviewed fix PR like any other file (#699). That path is now closed by the
 * quarantine below (`validatePatch` + the conditional exclude in
 * `vitest.config.ts`), not by this prefix list.
 *
 * Prefix matching, so a bare filename entry (`Makefile`) also rejects
 * `Makefile.local`. Over-rejection is the safe direction here: the fallback is
 * an investigation issue, which the prompt already tells the agent to use when
 * a fix genuinely needs one of these files.
 */
export const FORBIDDEN_PATCH_PREFIXES = [
  // CI itself, including dependabot/CODEOWNERS/issue templates.
  ".github/",
  // `make check` and everything it shells out to.
  "Makefile",
  "makefile",
  "scripts/",
  // `bun install` runs lifecycle scripts from here; the lockfile decides what
  // code `bun install` fetches in the first place.
  "package.json",
  "bun.lock",
  "bunfig.toml",
  // Harness configuration: hooks and skills that execute in agent sessions.
  ".claude/",
  ".agents/",
] as const;

/**
 * The one filename shape an agent-authored test may take (#699).
 *
 * Prompt step 5 requires a reproducing Vitest test, and until this rule that
 * test executed in CI on the unreviewed fix PR under `test.yml` — agent code
 * reaching an executor one hop later, in a different workflow. The remedy is a
 * quarantine, not a ban: the test must be a NEW file under `src/` named
 * `<name>.sentry.test.ts(x)`, and `vitest.config.ts` excludes that
 * pattern when the CI run's head ref is a `sentry-fix/` branch. The test
 * still runs in the agent's own job (schedule/dispatch runs have no head
 * ref), locally, and on every run after a human reviews and merges the PR —
 * it just never executes on the PR the agent authored before review.
 *
 * Enforced here so the vitest exclude cannot be dodged: any other path CI
 * selects as a test — vitest's `*.test.*`/`*.spec.*` globs, Playwright's
 * `e2e/` tree, the integration suite `db-lint.yml` runs — is rejected,
 * including *modifications* to existing test files, which would otherwise be
 * an unquarantined place to put code. Over-rejection is the safe direction:
 * the prompt's fallback is an investigation issue.
 */
export const SENTRY_TEST_FILE_RE = /^src\/.+\.sentry\.test\.tsx?$/;

/**
 * Paths CI executes as tests without the quarantine name being enough:
 * Playwright's `testDir` (`playwright.config.ts`) and the integration suite's
 * `include` root (`vitest.integration.config.ts`). Pinned against both by
 * ci-workflows.test.ts so a config change can't silently drift this list.
 */
export const EXECUTED_TEST_DIRS = ["e2e/", "src/__tests__/integration/"] as const;

/** Anything vitest or Playwright would select as a test file. */
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** True when a patch path is a test file CI would execute unreviewed, and isn't quarantine-shaped. */
function isUnquarantinedTestPath(path: string): boolean {
  const inExecutedDir = EXECUTED_TEST_DIRS.some((dir) => path.startsWith(dir));
  const isExecuted = TEST_FILE_RE.test(path) || inExecutedDir;
  const isQuarantined = SENTRY_TEST_FILE_RE.test(path) && !inExecutedDir;
  return isExecuted && !isQuarantined;
}

/** Refuse absurd patches outright rather than pushing them. */
export const MAX_PATCH_BYTES = 2 * 1024 * 1024;

/** GitHub rejects bodies over 65536 characters; stay clear of the edge. */
export const MAX_BODY_CHARS = 60_000;

/** Conventional-commit prefixes AGENTS.md constraint 16 permits. */
const CONVENTIONAL_PREFIX = /^(feat|fix|chore|docs|refactor|perf|ci)(\([^)]*\))?!?: \S/;

function fail(message: string): never {
  throw new Error(`outbox: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * First line only, with control bytes collapsed to spaces. Written as a
 * character map rather than a regex so no control-character escape is needed,
 * and so a lone CR cannot smuggle a second visible line past the `\n` split.
 */
function singleLine(value: string): string {
  return [...value.split("\n")[0]]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? " " : char;
    })
    .join("");
}

/** A non-empty single-line string, control characters collapsed to spaces. */
function requireLine(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  const line = singleLine(value).trim().slice(0, max).trim();
  if (!line) fail(`${field} must not be empty`);
  return line;
}

/** A non-empty body, truncated to what GitHub will accept. */
function requireBody(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  if (!value.trim()) fail(`${field} must not be empty`);
  if (value.length <= MAX_BODY_CHARS) return value;
  return `${value.slice(0, MAX_BODY_CHARS)}\n\n_(truncated by the lander at ${MAX_BODY_CHARS} characters)_`;
}

function optionalSection<T>(
  value: unknown,
  field: string,
  read: (record: Record<string, unknown>) => T,
): T | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) fail(`${field} must be an object or null`);
  return read(value);
}

/**
 * Parse and validate `outbox/plan.json`, pulling each section's body through
 * `readBody` (given `BODY_FILES` names; return `""` for a missing file).
 *
 * The cross-field rules encode the prompt's triage contract, so the harness's
 * most important rule — a database/third-party root cause gets an investigation
 * issue and *not* a compensating code PR — is enforced deterministically here
 * instead of resting on the agent's compliance.
 */
export function parsePlan(json: string, readBody: (file: string) => string): OutboxPlan {
  let document: unknown;
  try {
    document = JSON.parse(json) as unknown;
  } catch (error) {
    fail(`plan.json is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isRecord(document)) fail("plan.json must contain a JSON object");

  const classification = document.classification;
  if (
    classification !== "A" &&
    classification !== "B" &&
    classification !== "C" &&
    classification !== "D"
  ) {
    fail(`classification must be one of A, B, C, D (got ${JSON.stringify(classification)})`);
  }

  const plan: OutboxPlan = {
    classification,
    pr: optionalSection(document.pr, "pr", (record) => ({
      title: requireLine(record.title, "pr.title", 100),
      body: requireBody(readBody(BODY_FILES.pr), BODY_FILES.pr),
    })),
    issue: optionalSection(document.issue, "issue", (record) => ({
      title: requireLine(record.title, "issue.title", 160),
      body: requireBody(readBody(BODY_FILES.issue), BODY_FILES.issue),
    })),
    comment: optionalSection(document.comment, "comment", (record) => {
      const issue = record.issue;
      if (typeof issue !== "number" || !Number.isInteger(issue) || issue <= 0) {
        fail(`comment.issue must be a positive integer issue number (got ${JSON.stringify(issue)})`);
      }
      return { issue, body: requireBody(readBody(BODY_FILES.comment), BODY_FILES.comment) };
    }),
    quietRun: optionalSection(document.quietRun, "quietRun", (record) => ({
      reason: requireLine(record.reason, "quietRun.reason", 300),
      evidence: requireBody(readBody(BODY_FILES.quietRun), BODY_FILES.quietRun),
    })),
  };

  if (!plan.pr && !plan.issue && !plan.comment && !plan.quietRun) {
    fail("plan.json declares no outcome: set at least one of pr, issue, comment, quietRun");
  }
  if ((plan.classification === "B" || plan.classification === "C") && plan.pr) {
    fail(
      `classification ${plan.classification} must not open a code PR — file an investigation issue instead (prompt step 0)`,
    );
  }
  // (A) is "there is a defect in this repo's code", not "a patch exists". The
  // prompt's Investigation-Issue Fallback tells the agent to file an issue when
  // three attempts fail to produce a working fix for an (A), and the first
  // version of this rule threw on exactly that plan — turning the prompt's own
  // documented give-up path into a red run that published nothing, where the
  // pre-split design filed the issue and stayed green. Either outcome is
  // durable; declaring neither is the failure.
  if (plan.classification === "A" && !plan.pr && !plan.issue) {
    fail(
      "classification A must produce a PR (the fix) or an issue (the 3-attempts-failed fallback)",
    );
  }
  if (plan.classification === "D" && !(plan.pr && plan.issue)) {
    fail("classification D must open BOTH a PR (the reporting fix) and an investigation issue");
  }
  if (plan.issue && plan.comment) {
    fail(
      "plan.json sets both issue and comment: file a new issue or comment on the existing one, not both",
    );
  }

  return plan;
}

/** The base commit the agent worked from, as recorded by the packing step. */
export function parseBaseSha(text: string): string {
  const sha = text.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    fail(`base-sha must be a 40-character commit SHA (got ${JSON.stringify(sha)})`);
  }
  return sha;
}

/**
 * Repository-relative paths a unified diff touches.
 *
 * Collected from `diff --git`, `---`/`+++` and rename headers. Deliberately
 * over-collects: a removed line whose own content began with `--` yields a
 * spurious entry, which can only ever cause a *rejection*, never a miss.
 */
export function patchPaths(patch: string): string[] {
  const paths = new Set<string>();
  const add = (raw: string): void => {
    const value = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!value || value === "/dev/null") return;
    paths.add(value.replace(/^[ab]\//, ""));
  };

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const rest = line.slice("diff --git ".length);
      const split = rest.indexOf(" b/");
      if (split === -1) {
        add(rest);
        continue;
      }
      add(rest.slice(0, split));
      add(rest.slice(split + 1));
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) add(line.slice(4));
    else if (line.startsWith("rename from ")) add(line.slice("rename from ".length));
    else if (line.startsWith("rename to ")) add(line.slice("rename to ".length));
  }

  return [...paths];
}

/**
 * Check the packed patch against the plan and the patch rules. Throws on the
 * first violation; returns the paths it will touch.
 *
 * The empty/non-empty cross-check is the other half of the triage contract: a
 * (B)/(C) triage that also left code changes in the tree is exactly the
 * "compensating patch" the prompt forbids, and it fails the run loudly rather
 * than being quietly discarded.
 */
export function validatePatch(plan: OutboxPlan, patch: string): string[] {
  const wantsPatch = plan.pr !== null;
  const hasPatch = patch.trim().length > 0;

  if (wantsPatch && !hasPatch) fail("plan.json asks for a PR but the packed patch is empty");
  if (!wantsPatch && hasPatch) {
    fail(
      `plan.json asks for no PR but the working tree carried changes (${patchPaths(patch).join(", ")}) — a compensating patch is forbidden (prompt step 0)`,
    );
  }
  if (!hasPatch) return [];

  const bytes = Buffer.byteLength(patch, "utf8");
  if (bytes > MAX_PATCH_BYTES) {
    fail(`patch is ${bytes} bytes, over the ${MAX_PATCH_BYTES}-byte ceiling`);
  }

  const paths = patchPaths(patch);
  const forbidden = paths.filter((path) =>
    FORBIDDEN_PATCH_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );
  if (forbidden.length > 0) {
    fail(
      `patch touches CI or a build/tooling entry point (${forbidden.join(", ")}); make that change by hand`,
    );
  }

  const unquarantined = paths.filter(isUnquarantinedTestPath);
  if (unquarantined.length > 0) {
    fail(
      `patch touches test files CI would execute on the unreviewed fix PR (${unquarantined.join(", ")}); agent-authored tests must be NEW files named src/**/<name>.sentry.test.ts, and existing tests must be left alone (#699)`,
    );
  }

  return paths;
}

/**
 * Commit subject for the landed patch: the agent's PR title, forced to satisfy
 * AGENTS.md constraint 16. Sanitized rather than rejected — a 45-minute fix
 * should not be thrown away over a missing prefix.
 */
export function commitSubject(title: string): string {
  const first = singleLine(title).trim();
  if (!first) return "fix: apply Sentry harness fix";
  if (CONVENTIONAL_PREFIX.test(first)) return first.slice(0, 100).trim();
  return `fix: ${first}`.slice(0, 100).trim();
}

/** Branch the lander pushes for a given Sentry issue id. */
export function fixBranch(issueId: string): string {
  if (!/^[0-9]+$/.test(issueId)) fail(`issue id must be numeric (got ${JSON.stringify(issueId)})`);
  return `sentry-fix/SENTRY-${issueId}`;
}
