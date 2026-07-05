// @vitest-environment jsdom
/**
 * Characterization tests for TransferLinesEditor.
 *
 * The editor's render surface is fully data-driven off two react-query reads
 * (transferKeys.linesEdit for existing lines, transferKeys.sourceItems for the
 * from-bin picker) plus the `status === "planned"` editability gate. Its
 * loading spinner, editable/locked empty states, the row-per-line layout, and
 * the not-editable "Shipped" column were uncovered — pinned here so the
 * inventory line-item editors can be refactored against a known baseline.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). Supabase's client is stubbed to an empty object and
 * react-query is replaced with a mutable module-level fixture switched on
 * queryKey, so render is deterministic without a real query cache. The picker
 * Combobox is never mounted (showAddRow starts false), so it needs no stub.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";

// Mutable fixtures driving each useQuery branch. Hoisted so the vi.mock factory
// (itself hoisted above imports) can close over them.
const fixtures = vi.hoisted(() => ({
  lines: {
    data: undefined as unknown,
    isLoading: true,
    isPending: true,
  },
  source: {
    data: [] as unknown,
    isLoading: false,
    isPending: false,
  },
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    Array.isArray(queryKey) && queryKey.includes("source-items")
      ? fixtures.source
      : fixtures.lines,
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { TransferLinesEditor } from "../transfer-lines-editor";

const { render } = setupRenderHarness();

beforeEach(() => {
  // Reset to the loading default; each test opts into its own state.
  fixtures.lines = { data: undefined, isLoading: true, isPending: true };
  fixtures.source = { data: [], isLoading: false, isPending: false };
});

const setLines = (data: unknown) => {
  fixtures.lines = { data, isLoading: false, isPending: false };
};

const inputValues = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("input")).map(
    (i) => (i as HTMLInputElement).value,
  );

describe("TransferLinesEditor", () => {
  it("shows a spinner and no table while lines are loading", () => {
    fixtures.lines = { data: undefined, isLoading: true, isPending: true };
    const c = render(
      <TransferLinesEditor transferId="t1" fromBinId="b1" status="planned" />,
    );
    expect(c.querySelector(".animate-spin")).not.toBeNull();
    expect(c.querySelector("table")).toBeNull();
    expect(c.textContent).not.toContain("Line Items");
  });

  it("renders the editable empty state when planned with no lines", () => {
    setLines([]);
    const c = render(
      <TransferLinesEditor transferId="t1" fromBinId="b1" status="planned" />,
    );
    expect(c.textContent).toContain("Line Items");
    expect(c.textContent).toContain("Add Line");
    expect(c.textContent).toContain("No line items yet");
    // Not locked, no Shipped column.
    expect(c.textContent).not.toContain("Lines are locked");
    expect(c.textContent).not.toContain("Shipped");
    expect(c.querySelector("table")).not.toBeNull();
  });

  it("renders the locked empty state (with Shipped column) when not planned", () => {
    setLines([]);
    const c = render(
      <TransferLinesEditor transferId="t1" fromBinId="b1" status="shipped" />,
    );
    expect(c.textContent).toContain("No line items on this transfer.");
    expect(c.textContent).toContain("Lines are locked once the transfer leaves Planned.");
    expect(c.textContent).toContain("Shipped");
    // The Add Line action is gated to the planned status.
    expect(c.textContent).not.toContain("Add Line");
  });

  it("renders one editable row per line with the quantity bound to an input", () => {
    setLines([
      {
        id: "l1",
        finished_good_id: "fg1",
        inventory_lot_id: null,
        quantity: 5,
        quantity_shipped: null,
        item_name: "Hazy IPA - 4-pack",
      },
      {
        id: "l2",
        finished_good_id: null,
        inventory_lot_id: "lot1",
        quantity: 12,
        quantity_shipped: null,
        item_name: "Cascade Hops (LOT-9)",
      },
    ]);
    const c = render(
      <TransferLinesEditor transferId="t1" fromBinId="b1" status="planned" />,
    );
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    expect(c.textContent).toContain("Hazy IPA - 4-pack");
    expect(c.textContent).toContain("Cascade Hops (LOT-9)");
    const values = inputValues(c);
    expect(values).toContain("5");
    expect(values).toContain("12");
    // Editable rows expose a remove control per line.
    expect(c.querySelectorAll('[aria-label="Remove line"]').length).toBe(2);
  });

  it("renders locked rows with static quantities and shipped values (raw '—' fallback)", () => {
    setLines([
      {
        id: "l1",
        finished_good_id: "fg1",
        inventory_lot_id: null,
        quantity: 8,
        quantity_shipped: 3,
        item_name: "Pilsner - Keg",
      },
      {
        id: "l2",
        finished_good_id: null,
        inventory_lot_id: "lot1",
        quantity: 4,
        quantity_shipped: null,
        item_name: "Base Malt (LOT-2)",
      },
    ]);
    const c = render(
      <TransferLinesEditor transferId="t1" fromBinId="b1" status="in_transit" />,
    );
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    // Quantities are plain text, not inputs, when locked.
    expect(c.querySelectorAll("input").length).toBe(0);
    expect(c.textContent).toContain("Pilsner - Keg");
    expect(c.textContent).toContain("Base Malt (LOT-2)");
    // Shipped column: value when present, em-dash fallback when null.
    expect(c.textContent).toContain("3");
    expect(c.textContent).toContain("—");
    // No remove controls once locked.
    expect(c.querySelectorAll('[aria-label="Remove line"]').length).toBe(0);
  });
});
