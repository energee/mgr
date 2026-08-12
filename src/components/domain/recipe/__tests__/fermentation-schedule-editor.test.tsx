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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import { click, setInputValue } from "@/test/dom-events";
import type { FermentationStage } from "../fermentation-schedule-editor";

// Captures the Sortable's reorder callback and the per-row Select
// onValueChange handlers (in render order) so interaction tests can drive
// drag-reorder and stage-type changes without dnd-kit / Radix pointer plumbing.
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

import { FermentationScheduleEditor } from "../fermentation-schedule-editor";

const { render } = setupRenderHarness();

beforeEach(() => {
  captured.reorder = undefined;
  captured.selects = [];
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

    // render() self-cleans (unmounts the prior tree) before mounting the next.
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

  describe("interactions", () => {
    // Fixtures always carry explicit ids so the one-shot id-backfill effect
    // stays quiet and onChange.mock.calls[0] is the interaction under test.
    const twoStages = (): FermentationStage[] => [
      { id: "st1", stage: "primary", name: "Primary Fermentation", temp_f: 68, duration_days: 7, position: 0 },
      { id: "st2", stage: "cold_crash", name: "Cold Crash", temp_f: 34, duration_days: 3, position: 1 },
    ];

    /** Each stage renders as a Collapsible; its buttons are [notes toggle, remove]. */
    const stageRows = (c: HTMLElement) =>
      Array.from(c.querySelectorAll('[data-slot="collapsible"]'));

    const buttonWithText = (c: HTMLElement, text: string) =>
      Array.from(c.querySelectorAll("button")).find((b) => b.textContent?.includes(text));

    it("appends a defaulted stage at the end when Add Stage is clicked", () => {
      const onChange = vi.fn();
      const c = render(<FermentationScheduleEditor stages={twoStages()} onChange={onChange} />);
      click(buttonWithText(c, "Add Stage"));
      expect(onChange).toHaveBeenCalledTimes(1);
      const updated = onChange.mock.calls[0][0] as FermentationStage[];
      expect(updated).toHaveLength(3);
      expect(updated.slice(0, 2).map((s) => s.id)).toEqual(["st1", "st2"]);
      expect(updated[2]).toMatchObject({
        stage: "primary",
        name: "New Stage",
        temp_f: 68,
        duration_days: 7,
        position: 2,
      });
      expect(updated[2].id).toBeTruthy();
    });

    it("removes a stage and renumbers remaining positions", () => {
      const onChange = vi.fn();
      const c = render(<FermentationScheduleEditor stages={twoStages()} onChange={onChange} />);
      const firstRowButtons = stageRows(c)[0].querySelectorAll("button");
      click(firstRowButtons[firstRowButtons.length - 1]);
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: "st2", name: "Cold Crash", position: 0 }),
      ]);
    });

    it("persists a reorder with renumbered positions", () => {
      const onChange = vi.fn();
      const stages = twoStages();
      render(<FermentationScheduleEditor stages={stages} onChange={onChange} />);
      act(() => captured.reorder!([stages[1], stages[0]]));
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ id: "st2", position: 0 }),
        expect.objectContaining({ id: "st1", position: 1 }),
      ]);
    });

    it("propagates a temperature edit (UnitInput) for the right stage", () => {
      const onChange = vi.fn();
      const c = render(<FermentationScheduleEditor stages={twoStages()} onChange={onChange} />);
      const tempInput = stageRows(c)[1].querySelector(
        'input[aria-label="temp"]',
      ) as HTMLInputElement;
      setInputValue(tempInput, "38");
      const updated = onChange.mock.calls[0][0] as FermentationStage[];
      expect(updated[1]).toMatchObject({ id: "st2", temp_f: 38, duration_days: 3, position: 1 });
      expect(updated[0]).toMatchObject({ id: "st1", temp_f: 68 });
    });

    it("propagates a duration edit, and a stage-type change keeps a user-set name", () => {
      const onChange = vi.fn();
      const c = render(<FermentationScheduleEditor stages={twoStages()} onChange={onChange} />);
      const durationInput = stageRows(c)[0].querySelector(
        'input[type="number"]',
      ) as HTMLInputElement;
      setInputValue(durationInput, "10");
      expect((onChange.mock.calls[0][0] as FermentationStage[])[0]).toMatchObject({
        id: "st1",
        duration_days: 10,
      });

      // handleStageTypeChange only renames a stage still called "New Stage".
      act(() => captured.selects[0]("lagering"));
      expect((onChange.mock.calls[1][0] as FermentationStage[])[0]).toMatchObject({
        id: "st1",
        stage: "lagering",
        name: "Primary Fermentation",
      });
    });
  });
});
