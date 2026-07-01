// @vitest-environment jsdom
/**
 * Characterization tests for FermentationScheduleEditor.
 *
 * A controlled editor ({ stages, onChange }) — no Supabase/react-query — whose
 * render logic (empty state, one row per stage, name/temp/duration binding,
 * the footer stage-count/total summary, and the default-collapsed notes
 * section) was uncovered. This pins that render behavior.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). The dnd-kit `Sortable` wrapper is stubbed to
 * pass-throughs (orthogonal drag chrome; avoids jsdom ResizeObserver gaps),
 * `UnitInput` is stubbed to a plain input, and the temperature-unit hook is
 * mocked — so the test targets the editor's own layout logic. `Collapsible`
 * (real Radix) is left un-stubbed: it renders no content for the closed
 * notes section by default, which is itself part of the render behavior
 * being pinned.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FermentationStage } from "../fermentation-schedule-editor";

vi.mock("@/hooks/use-unit-preferences", () => ({
  useTemperatureUnit: () => "F",
}));
vi.mock("@/components/ui/unit-input", () => ({
  UnitInput: ({ value }: { value: number | null }) => (
    <input aria-label="temp" defaultValue={value == null ? "" : String(value)} />
  ),
}));
vi.mock("@/components/ui/sortable", () => ({
  Sortable: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItemHandle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableOverlay: () => null,
}));

import { FermentationScheduleEditor } from "../fermentation-schedule-editor";

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(el: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const noop = () => {};
const nameValues = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('input[placeholder="Stage name"]')).map(
    (i) => (i as HTMLInputElement).value,
  );

describe("FermentationScheduleEditor", () => {
  it("shows an empty state (and no stage rows) when there are no stages", () => {
    const c = render(<FermentationScheduleEditor stages={[]} onChange={noop} />);
    expect(c.textContent).toContain("No fermentation stages defined yet");
    expect(c.textContent).toContain("Add Stage");
    expect(c.textContent).toContain("Presets");
    expect(c.querySelectorAll('[data-slot="collapsible"]').length).toBe(0);
  });

  it("renders one row per stage with the stage name bound to an input", () => {
    const stages: FermentationStage[] = [
      { id: "st1", stage: "primary", name: "Primary Fermentation", temp_f: 68, duration_days: 7, position: 0 },
      { id: "st2", stage: "cold_crash", name: "Cold Crash", temp_f: 34, duration_days: 3, position: 1 },
    ];
    const c = render(<FermentationScheduleEditor stages={stages} onChange={noop} />);
    expect(c.querySelectorAll('[data-slot="collapsible"]').length).toBe(2);
    expect(nameValues(c)).toEqual(["Primary Fermentation", "Cold Crash"]);
  });

  it("binds temp and duration fields to each stage's values", () => {
    const stages: FermentationStage[] = [
      { id: "st1", stage: "primary", name: "Primary Fermentation", temp_f: 68, duration_days: 7, position: 0 },
      { id: "st2", stage: "cold_crash", name: "Cold Crash", temp_f: 34, duration_days: 3, position: 1 },
    ];
    const c = render(<FermentationScheduleEditor stages={stages} onChange={noop} />);
    const tempValues = Array.from(c.querySelectorAll('input[aria-label="temp"]')).map(
      (i) => (i as HTMLInputElement).value,
    );
    const durationValues = Array.from(c.querySelectorAll('input[type="number"]')).map(
      (i) => (i as HTMLInputElement).value,
    );
    expect(tempValues).toEqual(["68", "34"]);
    expect(durationValues).toEqual(["7", "3"]);
  });

  it("totals stage durations and pluralizes the stage count in the footer", () => {
    const oneStage: FermentationStage[] = [
      { id: "st1", stage: "lagering", name: "Lagering", temp_f: 34, duration_days: 14, position: 0 },
    ];
    const singular = render(<FermentationScheduleEditor stages={oneStage} onChange={noop} />);
    const singularFooter = singular.querySelector(".border-t.pt-3.mt-2");
    expect(singularFooter?.textContent).toContain("1 stage");
    expect(singularFooter?.textContent).not.toContain("1 stages");
    expect(singularFooter?.textContent).toContain("Total: 14 days (2 weeks)");

    act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;

    const twoStages: FermentationStage[] = [
      { id: "st1", stage: "primary", name: "Primary", temp_f: 68, duration_days: 7, position: 0 },
      { id: "st2", stage: "conditioning", name: "Conditioning", temp_f: 68, duration_days: 14, position: 1 },
    ];
    const plural = render(<FermentationScheduleEditor stages={twoStages} onChange={noop} />);
    const pluralFooter = plural.querySelector(".border-t.pt-3.mt-2");
    expect(pluralFooter?.textContent).toContain("2 stages");
    expect(pluralFooter?.textContent).toContain("Total: 21 days (3 weeks)");
  });

  it("keeps a stage's notes collapsed (not rendered) by default", () => {
    const stages: FermentationStage[] = [
      {
        id: "st1",
        stage: "secondary",
        name: "Dry Hop",
        temp_f: 68,
        duration_days: 4,
        notes: "Add dry hops at high krausen",
        position: 0,
      },
    ];
    const c = render(<FermentationScheduleEditor stages={stages} onChange={noop} />);
    expect(c.querySelector("textarea")).toBeNull();
    expect(c.textContent).not.toContain("Add dry hops at high krausen");
  });
});
