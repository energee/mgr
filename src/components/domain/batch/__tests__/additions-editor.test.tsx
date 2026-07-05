// @vitest-environment jsdom
/**
 * Characterization tests for AdditionsEditor.
 *
 * A controlled editor ({ items, onChange }) whose render logic (empty state,
 * one row per addition with the amount bound to an input, the additive-type
 * badge label map with a raw fallback, the conditional Target column, and the
 * footer's pluralized addition count) was uncovered. This pins that render
 * behavior.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). `useCatalog` is mocked to an empty-safe value
 * (all rows here carry an inline `additive`, so no catalog lookup is
 * required), and the dnd-kit `Sortable` wrapper is stubbed to pass-throughs
 * (orthogonal drag chrome; avoids jsdom ResizeObserver gaps) so the test
 * targets the editor's own layout logic.
 */

import { describe, it, expect, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import type { AdditionItem } from "../additions-editor";

vi.mock("@/hooks/use-catalog", () => ({
  useCatalog: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/components/ui/sortable", () => ({
  Sortable: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableItemHandle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SortableOverlay: () => null,
}));

import { AdditionsEditor } from "../additions-editor";

const { render } = setupRenderHarness();

const noop = () => {};

/** Build a complete addition item; override only what a test cares about. */
const item = (o: Partial<AdditionItem>): AdditionItem => ({
  additive_id: "x",
  amount: 1,
  unit: "g",
  timing: "boil",
  position: 0,
  additive: { id: "x", name: "X", type: "other", description: null, typical_amount: null, typical_unit: null },
  ...o,
});

const inputValues = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("input")).map((i) => (i as HTMLInputElement).value);

describe("AdditionsEditor", () => {
  it("shows an empty state (and no table) when there are no items", () => {
    const c = render(<AdditionsEditor items={[]} onChange={noop} />);
    expect(c.textContent).toContain("No additions added yet.");
    expect(c.textContent).toContain("Add Addition");
    expect(c.querySelector("table")).toBeNull();
  });

  it("renders one row per addition with the amount bound to an input", () => {
    const items: AdditionItem[] = [
      item({ additive_id: "a1", amount: 5, additive: { id: "a1", name: "Whirlfloc", type: "clarifier", description: null, typical_amount: null, typical_unit: null } }),
      item({ additive_id: "a2", amount: 2.5, additive: { id: "a2", name: "Yeast Nutrient", type: "nutrient", description: null, typical_amount: null, typical_unit: null } }),
    ];
    const c = render(<AdditionsEditor items={items} onChange={noop} />);
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    expect(c.textContent).toContain("Whirlfloc");
    expect(c.textContent).toContain("Yeast Nutrient");
    const values = inputValues(c);
    expect(values).toContain("5");
    expect(values).toContain("2.5");
  });

  it("maps additive type to a badge label, with a raw fallback for unmapped types", () => {
    const items: AdditionItem[] = [
      item({
        additive_id: "a1",
        additive: { id: "a1", name: "Whirlfloc", type: "clarifier", description: null, typical_amount: null, typical_unit: null },
      }),
      item({
        additive_id: "a2",
        additive: { id: "a2", name: "Something Weird", type: "mystery", description: null, typical_amount: null, typical_unit: null },
      }),
    ];
    const c = render(<AdditionsEditor items={items} onChange={noop} />);
    expect(c.textContent).toContain("Clarifiers"); // TYPE_LABELS.clarifier
    expect(c.textContent).toContain("mystery"); // raw fallback for unmapped type
  });

  it("falls back to 'Unknown' when the additive is missing", () => {
    const c = render(
      <AdditionsEditor items={[item({ additive_id: "missing", additive: undefined })]} onChange={noop} />,
    );
    expect(c.textContent).toContain("Unknown");
  });

  it("shows an em-dash Target cell for non-water-chemistry additives", () => {
    const c = render(
      <AdditionsEditor
        items={[
          item({
            additive_id: "a1",
            additive: { id: "a1", name: "Whirlfloc", type: "clarifier", description: null, typical_amount: null, typical_unit: null },
          }),
        ]}
        onChange={noop}
      />,
    );
    const lastCell = c.querySelector("tbody tr")?.querySelectorAll("td")[5];
    expect(lastCell?.textContent).toBe("—");
  });

  it("shows a pluralized addition count in the footer", () => {
    const one = render(<AdditionsEditor items={[item({})]} onChange={noop} />);
    expect(one.querySelector("tfoot")?.textContent).toContain("1 addition");
    expect(one.querySelector("tfoot")?.textContent).not.toContain("1 additions");

    // render() self-cleans (unmounts the prior tree) before mounting the next.
    const two = render(
      <AdditionsEditor items={[item({ additive_id: "a1" }), item({ additive_id: "a2" })]} onChange={noop} />,
    );
    expect(two.querySelector("tfoot")?.textContent).toContain("2 additions");
  });
});
