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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import { click, setInputValue } from "@/test/dom-events";
import type { MashStep } from "../mash-schedule-editor";

// Captures the Sortable's reorder callback and the per-row Select
// onValueChange handlers (in render order) so interaction tests can drive
// drag-reorder and step-type changes without dnd-kit / Radix pointer plumbing.
const captured = vi.hoisted(() => ({
  reorder: undefined as ((items: unknown[]) => void) | undefined,
  selects: [] as ((value: string) => void)[],
}));

vi.mock("@/hooks/use-unit-preferences", () => ({
  useResolvedUnitPreferences: () => ({ temperature_unit: "F" }),
}));
// Note: deliberately NOT `type="number"` — sibling tests count
// `input[type="number"]` to find the duration fields only.
vi.mock("@/components/ui/unit-input", () => ({
  UnitInput: ({
    value,
    onChange,
  }: {
    value: number | null;
    onChange?: (value: number | null) => void;
  }) => (
    <input
      aria-label="temp"
      defaultValue={value == null ? "" : String(value)}
      onChange={(e) => onChange?.(e.target.value === "" ? null : Number(e.target.value))}
    />
  ),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (value: string) => void;
  }) => {
    if (onValueChange) captured.selects.push(onValueChange);
    return <div>{children}</div>;
  },
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));
vi.mock("@/components/ui/sortable", () => ({
  Sortable: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange?: (items: unknown[]) => void;
  }) => {
    captured.reorder = onValueChange;
    return <>{children}</>;
  },
  SortableContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItemHandle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableOverlay: () => null,
}));

import { MashScheduleEditor } from "../mash-schedule-editor";

const { render } = setupRenderHarness();

beforeEach(() => {
  captured.reorder = undefined;
  captured.selects = [];
});

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

  describe("interactions", () => {
    // Fixtures always carry explicit ids so the one-shot id-backfill effect
    // stays quiet and onChange.mock.calls[0] is the interaction under test.
    const twoSteps = (): MashStep[] => [
      { id: "s1", step_type: "infusion", name: "Protein Rest", temp_f: 122, duration_min: 20, position: 0 },
      { id: "s2", step_type: "rest", name: "Saccharification Rest", temp_f: 152, duration_min: 60, position: 1 },
    ];

    const buttonWithText = (c: HTMLElement, text: string) =>
      Array.from(c.querySelectorAll("button")).find((b) => b.textContent?.includes(text));

    it("appends a defaulted step at the end when Add Step is clicked", () => {
      const onChange = vi.fn();
      const c = render(<MashScheduleEditor steps={twoSteps()} onChange={onChange} />);
      click(buttonWithText(c, "Add Step"));
      expect(onChange).toHaveBeenCalledTimes(1);
      const updated = onChange.mock.calls[0][0] as MashStep[];
      expect(updated).toHaveLength(3);
      expect(updated.slice(0, 2).map((s) => s.id)).toEqual(["s1", "s2"]);
      expect(updated[2]).toMatchObject({
        step_type: "infusion",
        name: "New Step",
        temp_f: 152,
        duration_min: 60,
        position: 2,
      });
      expect(updated[2].id).toBeTruthy();
    });

    it("removes a row and renumbers remaining positions", () => {
      const onChange = vi.fn();
      const c = render(<MashScheduleEditor steps={twoSteps()} onChange={onChange} />);
      const firstRowButtons = c.querySelectorAll("tbody tr")[0].querySelectorAll("button");
      click(firstRowButtons[firstRowButtons.length - 1]);
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: "s2", name: "Saccharification Rest", position: 0 }),
      ]);
    });

    it("persists a reorder with renumbered positions", () => {
      const onChange = vi.fn();
      const steps = twoSteps();
      render(<MashScheduleEditor steps={steps} onChange={onChange} />);
      act(() => captured.reorder!([steps[1], steps[0]]));
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: "s2", position: 0 }),
        expect.objectContaining({ id: "s1", position: 1 }),
      ]);
    });

    it("propagates a name edit for the right row, leaving siblings untouched", () => {
      const onChange = vi.fn();
      const c = render(<MashScheduleEditor steps={twoSteps()} onChange={onChange} />);
      const nameInput = c
        .querySelectorAll("tbody tr")[1]
        .querySelector('input[placeholder="Step name"]') as HTMLInputElement;
      setInputValue(nameInput, "Mash Out");
      const updated = onChange.mock.calls[0][0] as MashStep[];
      expect(updated[1]).toMatchObject({ id: "s2", name: "Mash Out", temp_f: 152, position: 1 });
      expect(updated[0]).toMatchObject({ id: "s1", name: "Protein Rest" });
    });

    it("propagates a temperature edit (UnitInput) and a step-type change (Select)", () => {
      const onChange = vi.fn();
      const c = render(<MashScheduleEditor steps={twoSteps()} onChange={onChange} />);
      const tempInput = c
        .querySelectorAll("tbody tr")[0]
        .querySelector('input[aria-label="temp"]') as HTMLInputElement;
      setInputValue(tempInput, "148");
      expect((onChange.mock.calls[0][0] as MashStep[])[0]).toMatchObject({
        id: "s1",
        temp_f: 148,
      });

      act(() => captured.selects[1]("decoction"));
      expect((onChange.mock.calls[1][0] as MashStep[])[1]).toMatchObject({
        id: "s2",
        step_type: "decoction",
      });
    });
  });
});
