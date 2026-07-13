import { describe, expect, it } from "vitest";
import { buildFixPrompt } from "./prompt";
import type { SentryIssue } from "./types";

const issue: SentryIssue = {
  issueId: "12345",
  shortId: "MGR-42",
  title: "TypeError: Cannot read property 'name' of undefined",
  culprit: "src/lib/foo.ts in handleBar",
  permalink: "https://sentry.io/organizations/x/issues/12345/",
  stackTrace: "TypeError: ...\n  at handleBar (src/lib/foo.ts:42)",
  eventContext: "extra.code: 42501\nextra.hint: check policies",
  breadcrumbs: "[2026-04-16T13:59:00Z] info fetch: GET /rest/v1/rpc/get_foo",
  eventCount14d: 342,
  firstSeen: "2026-04-14T09:00:00Z",
  lastSeen: "2026-04-16T14:00:00Z",
  level: "error",
  environment: "development",
  tags: { browser: "Chrome 130", url: "/production/batches/..." },
};

describe("buildFixPrompt", () => {
  it("includes all core error fields in the prompt", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("12345");
    expect(prompt).toContain("MGR-42");
    expect(prompt).toContain("TypeError: Cannot read property 'name' of undefined");
    expect(prompt).toContain("src/lib/foo.ts in handleBar");
    expect(prompt).toContain("handleBar (src/lib/foo.ts:42)");
    expect(prompt).toContain("342");
  });

  it("enumerates the 14-step pipeline", () => {
    const prompt = buildFixPrompt(issue);
    for (let i = 1; i <= 14; i++) {
      expect(prompt).toContain(`${i}.`);
    }
  });

  it("requires the harness-state writes (feature_list, PROGRESS, session trace) and final make check gate", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("docs/feature_list.json");
    expect(prompt).toContain("PROGRESS.md");
    expect(prompt).toContain(".harness/sessions/");
    expect(prompt).toContain("make check");
  });

  it("mentions required quality gates (simplify, code-review)", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("/simplify");
    expect(prompt).toContain("/code-review:code-review");
  });

  it("specifies branch naming and labels", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("sentry-fix/SENTRY-12345");
    expect(prompt).toContain("sentry-fix");
    expect(prompt).toContain("automated");
  });

  it("embeds the event context and breadcrumbs — the payload that distinguishes a DB fault from a bad error handler", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("extra.code: 42501");
    expect(prompt).toContain("GET /rest/v1/rpc/get_foo");
  });

  it("puts the triage gate ahead of the fix pipeline and names the Postgres codes that decide it", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("Step 0");
    expect(prompt.indexOf("Step 0")).toBeLessThan(prompt.indexOf("## Pipeline"));
    for (const code of ["42501", "42883", "42P01"]) {
      expect(prompt).toContain(code);
    }
  });

  it("routes non-app-code root causes to an investigation issue, not a compensating code PR", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("gh issue create");
    expect(prompt).toContain("needs-human");
    expect(prompt).toContain("Do not open a code PR");
    expect(prompt).toContain("Improving the error handler is not a fix");
  });

  it("points triage at the live catalog snapshot and migration chain as evidence", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("supabase/live-catalog.snapshot.txt");
    expect(prompt).toContain("supabase/migrations/");
    expect(prompt).toContain("GRANT");
  });

  it("references AGENTS.md conventions", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("AGENTS.md");
  });
});
