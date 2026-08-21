// Pins the link classifier behind the docs-dream loop's deterministic report:
// relative targets are resolved against the linking file, and URL/anchor/
// mailto targets are never flagged.
import { describe, expect, it } from "vitest";
import { brokenLinksIn } from "./check-doc-links";

describe("check-doc-links", () => {
  it("flags a relative link whose target does not exist", () => {
    const broken = brokenLinksIn("docs/agents/ci.md", "[gone](no-such-file.md)");
    expect(broken).toEqual([{ file: "docs/agents/ci.md", target: "no-such-file.md" }]);
  });

  it("resolves targets relative to the linking file and strips anchors", () => {
    // gotchas.md is a real sibling of ci.md; the anchor must not break resolution.
    expect(brokenLinksIn("docs/agents/ci.md", "[g](gotchas.md#some-heading)")).toEqual([]);
  });

  it("ignores absolute URLs, mailto and pure anchors", () => {
    const contents = "[a](https://example.com) [b](mailto:x@y.z) [c](#local-heading)";
    expect(brokenLinksIn("AGENTS.md", contents)).toEqual([]);
  });
});
