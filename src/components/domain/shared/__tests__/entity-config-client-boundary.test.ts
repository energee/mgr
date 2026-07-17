// Regression: MGR-S (SENTRY-7611936148) — createRevisionHistoryDisplay() is
// invoked eagerly at module scope inside every entity's presentation.tsx
// (e.g. `component: createRevisionHistoryDisplay("batches")`). presentation.tsx
// itself carries no "use client" directive, so when a Server Component
// imports an assembled entity (rather than its server-safe core), this
// factory call executes on the server. If the module that defines the
// factory carries "use client", Next.js replaces its exports with client
// references that can only be rendered as JSX, not called as plain
// functions — throwing "Attempted to call X() from the server but X is on
// the client." The same factory-function pattern exists for
// createQBOSyncDisplay. Both factories now live in files with no "use
// client" directive; only the real hook-using components
// (RevisionHistory, QBOSyncSection) keep the directive, in their own files.
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const REVISION_HISTORY_DISPLAY = readFileSync(
  resolve(__dirname, "../revision-history-display.tsx"),
  "utf-8"
);
const QBO_SYNC_DISPLAY = readFileSync(
  resolve(__dirname, "../qbo-sync-display.tsx"),
  "utf-8"
);
const QBO_SYNC_SECTION = readFileSync(
  resolve(__dirname, "../qbo-sync-section.tsx"),
  "utf-8"
);

describe("entity presentation custom-section factories stay server-safe (MGR-S regression)", () => {
  it("revision-history-display.tsx (createRevisionHistoryDisplay) has no 'use client' directive", () => {
    expect(REVISION_HISTORY_DISPLAY).not.toMatch(/^\s*["']use client["'];/m);
  });

  it("qbo-sync-display.tsx (createQBOSyncDisplay) has no 'use client' directive", () => {
    expect(QBO_SYNC_DISPLAY).not.toMatch(/^\s*["']use client["'];/m);
  });

  it("qbo-sync-section.tsx no longer exports the eagerly-invoked factory", () => {
    expect(QBO_SYNC_SECTION).not.toMatch(/export function createQBOSyncDisplay/);
  });

  it("qbo-sync-section.tsx (real hook-based component) keeps its 'use client' directive", () => {
    expect(QBO_SYNC_SECTION).toMatch(/^"use client";/);
  });
});
