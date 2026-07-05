// @vitest-environment jsdom
/**
 * Characterization tests for RecipeScheduleDisplay (MashScheduleDisplay +
 * FermentationScheduleDisplay).
 *
 * These read-only recipe-detail displays had ZERO coverage, which is why the
 * B3 "read-only displays reuse the editors" merge was blocked as unverifiable
 * (see docs/plans/2026-06-30-dedup-extraction-backlog.md). This suite pins the
 * current render behavior — empty states, per-row type-label mapping with raw
 * fallback, and the footer total computations (including the days→weeks
 * rounding) — so any future refactor can be checked behavior-preserving.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). The temperature leaf `UnitDisplay` is stubbed so
 * these tests characterize the schedule display's OWN logic, not
 * unit-preference conversion.
 */

import { describe, it, expect, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@/components/ui/unit-input", () => ({
  UnitDisplay: ({ value }: { value: number | null }) => (
    <span data-testid="temp">{value == null ? "" : String(value)}</span>
  ),
}));

import {
  MashScheduleDisplay,
  FermentationScheduleDisplay,
} from "../recipe-schedule-display";

const { render } = setupRenderHarness();

const bodyRows = (c: HTMLElement) => c.querySelectorAll("tbody tr");

describe("MashScheduleDisplay", () => {
  it("shows an empty state when there are no steps", () => {
    const c = render(<MashScheduleDisplay data={{ mash_schedule: [] }} />);
    expect(c.textContent).toContain("No mash schedule defined");
    expect(bodyRows(c).length).toBe(0);
  });

  it("renders one 1-indexed row per step with mapped type label (raw fallback), name and duration", () => {
    const c = render(
      <MashScheduleDisplay
        data={{
          mash_schedule: [
            { step_type: "infusion", name: "Mash In", temp_f: 152, duration_min: 60 },
            { step_type: "mystery", name: "Weird Step", temp_f: 168, duration_min: 15 },
          ],
        }}
      />,
    );
    const rows = bodyRows(c);
    expect(rows.length).toBe(2);
    // index column is 1-based
    expect(rows[0].querySelector("td")?.textContent).toBe("1");
    expect(rows[1].querySelector("td")?.textContent).toBe("2");
    // known step_type maps to a label; unknown falls back to the raw value
    expect(c.textContent).toContain("Infusion");
    expect(c.textContent).toContain("mystery");
    expect(c.textContent).toContain("Mash In");
    expect(c.textContent).toContain("60 min");
    expect(c.textContent).toContain("15 min");
  });

  it("sums step durations in the footer as Total Mash Time", () => {
    const c = render(
      <MashScheduleDisplay
        data={{
          mash_schedule: [
            { step_type: "infusion", name: "A", temp_f: 150, duration_min: 60 },
            { step_type: "rest", name: "B", temp_f: 160, duration_min: 15 },
          ],
        }}
      />,
    );
    const footer = c.querySelector("tfoot");
    expect(footer?.textContent).toContain("Total Mash Time");
    expect(footer?.textContent).toContain("75 min");
  });
});

describe("FermentationScheduleDisplay", () => {
  it("shows an empty state when there are no stages", () => {
    const c = render(
      <FermentationScheduleDisplay data={{ fermentation_schedule: [] }} />,
    );
    expect(c.textContent).toContain("No fermentation schedule defined");
    expect(bodyRows(c).length).toBe(0);
  });

  it("renders stage label (raw fallback), name, optional notes and duration per row", () => {
    const c = render(
      <FermentationScheduleDisplay
        data={{
          fermentation_schedule: [
            {
              stage: "primary",
              name: "Primary Ferment",
              temp_f: 68,
              duration_days: 14,
              notes: "keep steady",
            },
            { stage: "weird", name: "Odd Stage", temp_f: 40, duration_days: 2 },
          ],
        }}
      />,
    );
    const rows = bodyRows(c);
    expect(rows.length).toBe(2);
    expect(c.textContent).toContain("Primary"); // mapped label
    expect(c.textContent).toContain("weird"); // raw fallback
    expect(c.textContent).toContain("Primary Ferment");
    expect(c.textContent).toContain("Odd Stage");
    expect(c.textContent).toContain("keep steady"); // notes shown when present
    expect(c.textContent).toContain("14 days");
    expect(c.textContent).toContain("2 days");
  });

  it("sums stage durations and rounds to whole weeks in the footer", () => {
    const c = render(
      <FermentationScheduleDisplay
        data={{
          fermentation_schedule: [
            { stage: "primary", name: "A", temp_f: 68, duration_days: 14 },
            { stage: "secondary", name: "B", temp_f: 60, duration_days: 2 },
          ],
        }}
      />,
    );
    const footer = c.querySelector("tfoot");
    expect(footer?.textContent).toContain("Total Fermentation Time");
    // 16 days → Math.round(16 / 7) = 2 weeks
    expect(footer?.textContent).toContain("16 days (2 weeks)");
  });
});
