// Regression: MGR-6 — next/dynamic with ssr:false in a "use client" component
// emits an implicit <Suspense> in server HTML at a different sibling position
// than the client, causing a hydration mismatch. The fix uses React.lazy with
// an explicit <Suspense> pinned at position 3 in the outer flex column so the
// Suspense boundary is at the same tree position on both server and client.
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const SRC = resolve(__dirname, "../chat-layout.tsx");
const source = readFileSync(SRC, "utf-8");

describe("ChatLayout hydration guard (MGR-6 regression)", () => {
  it("does not use next/dynamic (which caused the ssr:false Suspense mismatch)", () => {
    expect(source).not.toMatch(/from ["']next\/dynamic["']/);
  });

  it("uses React.lazy for deferred ChatPanel loading", () => {
    expect(source).toMatch(/\blazy\s*\(/);
  });

  it("wraps ChatPanel in an explicit <Suspense> boundary", () => {
    expect(source).toMatch(/<Suspense\b/);
  });

  it("provides a null Suspense fallback to avoid layout shift", () => {
    expect(source).toMatch(/fallback=\{null\}/);
  });

  it("wraps Suspense in an ErrorBoundary to survive chunk-load failures", () => {
    expect(source).toMatch(/ErrorBoundary/);
  });
});
