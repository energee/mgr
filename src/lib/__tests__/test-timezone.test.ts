/**
 * Guard for the vitest timezone pin (issue #568).
 *
 * Tests that characterize date-only rendering (e.g. backward-planner's "renders
 * a day early") only reproduce under a behind-UTC zone. `test.env.TZ` in
 * vitest.config.ts is inert under `pool: "threads"`, so the pin is applied at
 * config module scope instead. This test fails if that ever stops taking effect.
 */
import { describe, expect, it } from "vitest";

describe("vitest timezone pin", () => {
  it("runs tests in America/New_York, not the host zone", () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/New_York",
    );
  });

  it("puts Date behind UTC (date-only strings parse to the previous local day)", () => {
    // 2026-07-01T00:00:00Z is 2026-06-30 20:00 in America/New_York.
    expect(new Date("2026-07-01").getDate()).toBe(30);
  });
});
