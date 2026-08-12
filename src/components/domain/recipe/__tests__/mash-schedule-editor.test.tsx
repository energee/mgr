// @vitest-environment jsdom
/**
 * Characterization tests for MashScheduleEditor.
 *
 * A controlled editor ({ steps, onChange }) — no Supabase/react-query — whose
 * render logic (empty state, one row per step, name binding, the footer total,
 * and the temperature-reference block that only shows with steps present) was
 * uncovered, blocking the B2 "shared sortable-editor shell" refactor as
 * unverifiable. This pins that render behavior.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). The dnd-kit `Sortable` wrapper is stubbed to
 * pass-throughs (orthogonal drag chrome; avoids jsdom ResizeObserver gaps),
 * `UnitInput` is stubbed to a plain input, and the temperature-unit hook is
 * mocked — so the test targets the editor's own layout logic.
 */

import { describe, it, expect, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import type { MashStep } from "../mash-schedule-editor";

vi.mock("@/hooks/use-unit-preferences", () => ({
  useResolvedUnitPreferences: () => ({ temperature_unit: "F" }),
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

import { MashScheduleEditor } from "../mash-schedule-editor";

const { render } = setupRenderHarness();

const noop = () => {};
const inputValues = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("input")).map((i) => (i as HTMLInputElement).value);

describe("MashScheduleEditor", () => {
  it("shows an empty state (and no table) when there are no steps", () => {
    const c = render(<MashScheduleEditor steps={[]} onChange={noop} />);
    expect(c.textContent).toContain("No mash steps defined yet");
    expect(c.textContent).toContain("Add Step");
    expect(c.textContent).toContain("Presets");
    expect(c.querySelector("tbody")).toBeNull();
  });

  it("renders one row per step with the step name bound to an input", () => {
    const steps: MashStep[] = [
      { id: "s1", step_type: "infusion", name: "Protein Rest", temp_f: 122, duration_min: 20, position: 0 },
      { id: "s2", step_type: "rest", name: "Saccharification Rest", temp_f: 152, duration_min: 60, position: 1 },
    ];
    const c = render(<MashScheduleEditor steps={steps} onChange={noop} />);
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    const values = inputValues(c);
    expect(values).toContain("Protein Rest");
    expect(values).toContain("Saccharification Rest");
  });

  it("totals step durations in the footer", () => {
    const steps: MashStep[] = [
      { id: "s1", step_type: "infusion", name: "A", temp_f: 122, duration_min: 20, position: 0 },
      { id: "s2", step_type: "rest", name: "B", temp_f: 152, duration_min: 60, position: 1 },
    ];
    const c = render(<MashScheduleEditor steps={steps} onChange={noop} />);
    const footer = c.querySelector("tfoot");
    expect(footer?.textContent).toContain("Total Mash Time");
    expect(footer?.textContent).toContain("80 min");
  });

  it("shows the temperature-reference block only when steps are present", () => {
    const withSteps = render(
      <MashScheduleEditor
        steps={[{ id: "s1", step_type: "infusion", name: "A", temp_f: 122, duration_min: 20, position: 0 }]}
        onChange={noop}
      />,
    );
    expect(withSteps.textContent).toContain("Acid Rest");
    expect(withSteps.textContent).toContain("Alpha Amylase");
    // render() self-cleans (unmounts the prior tree) before mounting the next.
    const empty = render(<MashScheduleEditor steps={[]} onChange={noop} />);
    expect(empty.textContent).not.toContain("Temperature Reference");
  });
});
