import { describe, expect, it } from "vitest";
import {
  BODY_FILES,
  commitSubject,
  fixBranch,
  MAX_BODY_CHARS,
  MAX_PATCH_BYTES,
  parseBaseSha,
  parsePlan,
  patchPaths,
  validatePatch,
  type OutboxPlan,
} from "./outbox";

const BODIES: Record<string, string> = {
  [BODY_FILES.pr]: "## Sentry Fix\n\nRoot cause: null deref in handleBar.",
  [BODY_FILES.issue]: "Classification (B). Postgres 42501 on get_foo.",
  [BODY_FILES.comment]: "New evidence: the GRANT is still missing on live.",
  [BODY_FILES.quietRun]: "Evidence:\n$ git log --all --diff-filter=D -- src/app/gone/page.tsx",
};

const read = (file: string): string => BODIES[file] ?? "";
const readNothing = (): string => "";

function plan(overrides: Record<string, unknown>): string {
  return JSON.stringify({ classification: "A", pr: { title: "fix: guard the null" }, ...overrides });
}

describe("parsePlan", () => {
  it("accepts an (A) plan and pulls the PR body from its own file", () => {
    const parsed = parsePlan(plan({}), read);

    expect(parsed.classification).toBe("A");
    expect(parsed.pr).toEqual({ title: "fix: guard the null", body: BODIES[BODY_FILES.pr] });
    expect(parsed.issue).toBeNull();
    expect(parsed.comment).toBeNull();
    expect(parsed.quietRun).toBeNull();
  });

  it("rejects an unknown classification", () => {
    expect(() => parsePlan(plan({ classification: "E" }), read)).toThrow(/classification must be one of/);
  });

  it("rejects invalid JSON and non-objects", () => {
    expect(() => parsePlan("{not json", read)).toThrow(/not valid JSON/);
    expect(() => parsePlan('["a"]', read)).toThrow(/must contain a JSON object/);
  });

  it("rejects a section whose body file is missing or empty", () => {
    expect(() => parsePlan(plan({}), readNothing)).toThrow(/pr-body\.md must not be empty/);
  });

  it("truncates an over-long body rather than dropping the outcome", () => {
    const long = "x".repeat(MAX_BODY_CHARS + 500);
    const parsed = parsePlan(plan({}), (file) => (file === BODY_FILES.pr ? long : ""));

    expect(parsed.pr?.body.length).toBeLessThan(long.length);
    expect(parsed.pr?.body).toContain("truncated by the lander");
  });

  it("normalizes a title to one control-character-free line", () => {
    const parsed = parsePlan(plan({ pr: { title: "fix: keep one\rline\nsecond line" } }), read);

    expect(parsed.pr?.title).toBe("fix: keep  one line");
  });

  it("rejects an empty or non-string title", () => {
    expect(() => parsePlan(plan({ pr: { title: "   " } }), read)).toThrow(/pr\.title must not be empty/);
    expect(() => parsePlan(plan({ pr: { title: 7 } }), read)).toThrow(/pr\.title must be a string/);
  });

  it("requires at least one declared outcome", () => {
    expect(() => parsePlan(JSON.stringify({ classification: "C" }), read)).toThrow(
      /declares no outcome/,
    );
  });

  // The prompt's Investigation-Issue Fallback documents exactly this plan for
  // an (A) the agent could not fix in three attempts. An earlier rule required
  // a `pr` unconditionally and threw here, turning a documented give-up path
  // into a red run that published nothing.
  it("accepts an (A) that gave up after 3 attempts and asks for an issue", () => {
    const parsed = parsePlan(
      JSON.stringify({ classification: "A", issue: { title: "[sentry] MGR-42: gave up" } }),
      read,
    );

    expect(parsed.pr).toBeNull();
    expect(parsed.issue?.title).toBe("[sentry] MGR-42: gave up");
  });

  it("rejects an (A) that declares neither a PR nor an issue", () => {
    expect(() =>
      parsePlan(JSON.stringify({ classification: "A", quietRun: { reason: "nothing to do" } }), read),
    ).toThrow(/classification A must produce a PR .* or an issue/);
  });

  // The harness's single most important rule: a database or third-party root
  // cause gets an investigation issue, never a compensating code PR.
  it.each(["B", "C"])("refuses a code PR for classification %s", (classification) => {
    expect(() => parsePlan(plan({ classification }), read)).toThrow(/must not open a code PR/);
  });

  it("requires both a PR and an issue for an observability gap (D)", () => {
    expect(() => parsePlan(plan({ classification: "D" }), read)).toThrow(/must open BOTH/);
    const parsed = parsePlan(
      plan({ classification: "D", issue: { title: "[sentry] MGR-42: unknown" } }),
      read,
    );

    expect(parsed.pr).not.toBeNull();
    expect(parsed.issue?.title).toBe("[sentry] MGR-42: unknown");
  });

  it("accepts a comment on an existing triage issue", () => {
    const parsed = parsePlan(
      JSON.stringify({ classification: "B", comment: { issue: 123 } }),
      read,
    );

    expect(parsed.comment).toEqual({ issue: 123, body: BODIES[BODY_FILES.comment] });
  });

  it.each([0, -3, 1.5, "123", null])("rejects a bad comment issue number (%s)", (issue) => {
    expect(() =>
      parsePlan(JSON.stringify({ classification: "B", comment: { issue } }), read),
    ).toThrow(/comment\.issue must be a positive integer|comment must be an object/);
  });

  it("refuses to both file an issue and comment on one", () => {
    expect(() =>
      parsePlan(
        JSON.stringify({
          classification: "B",
          issue: { title: "[sentry] MGR-42: missing GRANT" },
          comment: { issue: 9 },
        }),
        read,
      ),
    ).toThrow(/not both/);
  });

  it("accepts a quiet run carrying evidence", () => {
    const parsed = parsePlan(
      JSON.stringify({ classification: "C", quietRun: { reason: "culprit route deleted" } }),
      read,
    );

    expect(parsed.quietRun).toEqual({
      reason: "culprit route deleted",
      evidence: BODIES[BODY_FILES.quietRun],
    });
  });

  it("rejects a non-object section", () => {
    expect(() => parsePlan(plan({ issue: "please file one" }), read)).toThrow(
      /issue must be an object or null/,
    );
  });
});

describe("parseBaseSha", () => {
  it("accepts a 40-hex sha with surrounding whitespace", () => {
    expect(parseBaseSha(" 0123456789abcdef0123456789abcdef01234567\n")).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
  });

  it.each(["", "main", "0123456789abcdef", "0123456789ABCDEF0123456789abcdef01234567", "$(id)"])(
    "rejects %s",
    (value) => {
      expect(() => parseBaseSha(value)).toThrow(/must be a 40-character commit SHA/);
    },
  );
});

describe("patchPaths", () => {
  it("collects paths from diff, rename and file headers", () => {
    const patch = [
      "diff --git a/src/lib/foo.ts b/src/lib/foo.ts",
      "--- a/src/lib/foo.ts",
      "+++ b/src/lib/foo.ts",
      "@@ -1 +1 @@",
      "-const a = 1;",
      "+const a = 2;",
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
      "diff --git a/added.bin b/added.bin",
      "--- /dev/null",
      "+++ b/added.bin",
      "GIT binary patch",
    ].join("\n");

    expect(patchPaths(patch).sort()).toEqual(["added.bin", "new.ts", "old.ts", "src/lib/foo.ts"]);
  });
});

describe("validatePatch", () => {
  const prPlan = (): OutboxPlan => parsePlan(plan({}), read);
  const issuePlan = (): OutboxPlan =>
    parsePlan(JSON.stringify({ classification: "B", comment: { issue: 5 } }), read);
  const diff = (path: string): string =>
    `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`;

  it("accepts an application-code patch for a PR plan", () => {
    expect(validatePatch(prPlan(), diff("src/lib/foo.ts"))).toEqual(["src/lib/foo.ts"]);
  });

  it("rejects a PR plan with an empty patch", () => {
    expect(() => validatePatch(prPlan(), "   \n")).toThrow(/asks for a PR but the packed patch is empty/);
  });

  // The other half of the triage contract: a (B)/(C) triage that also left code
  // changes is the compensating patch the prompt forbids.
  it("rejects a non-PR plan that carried a patch, naming the paths", () => {
    expect(() => validatePatch(issuePlan(), diff("src/lib/foo.ts"))).toThrow(
      /asks for no PR but the working tree carried changes \(src\/lib\/foo\.ts\)/,
    );
  });

  it("accepts an empty patch for a non-PR plan", () => {
    expect(validatePatch(issuePlan(), "")).toEqual([]);
  });

  // Every executor the repo runs, not just the workflow files: `make check`
  // runs the Makefile and `scripts/*`, `bun install` runs package.json
  // lifecycle scripts, and `.claude/settings.json` defines hooks that fire in
  // every local agent session. The first version of this list stopped at
  // `.github/**` while claiming to close "the one path".
  it.each([
    ".github/workflows/sentry-harness.yml",
    ".github/actions/require-durable-outcome/action.yml",
    ".github/scripts/land-sentry-fix.ts",
    ".github/dependabot.yml",
    "Makefile",
    "scripts/db-push.sh",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    ".claude/settings.json",
    ".agents/skills/verify/SKILL.md",
  ])("refuses a patch touching %s", (path) => {
    expect(() => validatePatch(prPlan(), diff(path))).toThrow(/build\/tooling entry point/);
  });

  it("still accepts the harness-state files the prompt tells the agent to write", () => {
    const paths = [
      "src/lib/foo.ts",
      "docs/feature_list.json",
      "docs/progress/2026-07-30-sentry-1.md",
      ".harness/sessions/2026-07-30-SENTRY-1.md",
    ];
    expect(validatePatch(prPlan(), paths.map(diff).join("")).sort()).toEqual([...paths].sort());
  });

  // #699: prompt step 5 requires a reproducing test, and that file used to run
  // in CI on the unreviewed fix PR under test.yml — agent code reaching an
  // executor one hop later. Agent tests are therefore quarantined by name:
  // NEW `src/**/*.sentry.test.ts(x)` files only (vitest.config.ts excludes
  // that glob when the head ref is `sentry-fix/*`), and every other path CI
  // would select as a test is rejected, including edits to existing tests.
  it("accepts a quarantine-named repro test next to the fix", () => {
    const paths = ["src/lib/foo.ts", "src/lib/foo.sentry.test.ts"];
    expect(validatePatch(prPlan(), paths.map(diff).join("")).sort()).toEqual([...paths].sort());
    expect(validatePatch(prPlan(), diff("src/components/bar.sentry.test.tsx"))).toEqual([
      "src/components/bar.sentry.test.tsx",
    ]);
  });

  it.each([
    // an ordinary unit test executes on the fix PR under test.yml
    "src/lib/foo.test.ts",
    "src/components/bar.spec.tsx",
    // Playwright runs everything under e2e/ on every PR — the quarantine name
    // does not help there, and spec helpers are imported by specs that run
    "e2e/foo.spec.ts",
    "e2e/bar.sentry.test.ts",
    // the "setup" project matches *.setup.ts, not *.test.*/*.spec.* — only
    // the directory check (not TEST_FILE_RE) catches this one
    "e2e/auth.setup.ts",
    // db-lint.yml executes the integration suite when the patch also carries a
    // migration (which the prefix list allows)
    "src/__tests__/integration/foo.test.ts",
    "src/__tests__/integration/foo.sentry.test.ts",
    // quarantine suffix outside src/ is not quarantined by vitest's glob roots
    "packages/foo.sentry.test.ts",
  ])("refuses a test file CI would execute on the unreviewed PR (%s)", (path) => {
    expect(() => validatePatch(prPlan(), diff(path))).toThrow(/test files CI would execute/);
  });

  it("refuses a patch over the size ceiling", () => {
    const huge = `${diff("src/lib/foo.ts")}${"+x\n".repeat(MAX_PATCH_BYTES)}`;
    expect(() => validatePatch(prPlan(), huge)).toThrow(/over the .* ceiling/);
  });
});

describe("commitSubject", () => {
  it("keeps a conventional subject as written", () => {
    expect(commitSubject("fix: guard the null deref")).toBe("fix: guard the null deref");
    expect(commitSubject("refactor(domain)!: move it")).toBe("refactor(domain)!: move it");
  });

  it("prefixes a subject that lacks a conventional type (AGENTS.md constraint 16)", () => {
    expect(commitSubject("Guard the null deref")).toBe("fix: Guard the null deref");
    // `test:` is not in the permitted set, so it gets prefixed rather than kept.
    expect(commitSubject("test: add coverage")).toBe("fix: test: add coverage");
  });

  it("takes only the first line and strips control bytes", () => {
    expect(commitSubject("fix: one\nrm -rf /")).toBe("fix: one");
    expect(commitSubject("fix: one two")).toBe("fix: one two");
  });

  it("caps the subject length", () => {
    expect(commitSubject(`fix: ${"y".repeat(200)}`).length).toBe(100);
  });

  it("falls back when nothing survives sanitizing", () => {
    expect(commitSubject("")).toBe("fix: apply Sentry harness fix");
  });
});

describe("fixBranch", () => {
  it("derives the branch from a numeric Sentry issue id", () => {
    expect(fixBranch("12345")).toBe("sentry-fix/SENTRY-12345");
  });

  it.each(["", "12a", "../main", "1;id"])("rejects a non-numeric id (%s)", (id) => {
    expect(() => fixBranch(id)).toThrow(/must be numeric/);
  });
});
