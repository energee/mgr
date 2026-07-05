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

  it("includes diagnostic-PR fallback with needs-human label", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("needs-human");
    expect(prompt).toContain("diagnostic");
  });

  it("references AGENTS.md conventions", () => {
    const prompt = buildFixPrompt(issue);
    expect(prompt).toContain("AGENTS.md");
  });
});
