// @vitest-environment jsdom
/**
 * Characterization tests for OrderItemsEditor.
 *
 * A Supabase/react-query-backed inline line-item table (~946 lines) whose top
 * three render branches — the loading spinner, the empty "no line items" state,
 * and the rows-present table (with per-row line totals and the footer order
 * total) — were uncovered. This pins that render behavior so downstream
 * refactors of the shared order line-item editor stay verifiable.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react). react-query, the Supabase client, and the catalog /
 * material-planning hooks are mocked so render is deterministic and offline:
 *   - useQuery switches on queryKey and reads a hoisted, per-test-mutable
 *     fixture for the order-items query; every other query (order detail,
 *     inventory availability) returns empty.
 *   - Rows are asserted through the readOnly branch, which renders plain
 *     text/spans and avoids the Combobox/Input editing chrome (orthogonal to
 *     the loading/empty/rows layout logic under test).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Mutable fixture the react-query mock reads. Hoisted so the (hoisted)
// vi.mock factory can close over it without a TDZ error.
const h = vi.hoisted(() => ({
  itemsState: {
    data: undefined as unknown[] | undefined,
    isLoading: false,
  },
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = opts.queryKey;
    // Order items query: ["orders", <id>, "items"]
    if (Array.isArray(key) && key[0] === "orders" && key[2] === "items") {
      const s = h.itemsState;
      return { data: s.data, isLoading: s.isLoading, isPending: s.isLoading };
    }
    // Order detail, brand availability, per-item availability: irrelevant here.
    return { data: undefined, isLoading: false, isPending: false };
  },
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-catalog", () => ({
  useBrands: () => ({ data: [] }),
  usePackagingFormats: () => ({ data: [] }),
  useKegOwners: () => ({ data: [] }),
  formatVolumeLabel: (v: unknown) => String(v),
}));

vi.mock("@/hooks/use-material-planning", () => ({
  useCalculateOrderMaterials: () => ({ data: undefined, mutate: vi.fn(), isPending: false }),
}));

import { OrderItemsEditor } from "../order-items-editor";

type Row = {
  id: string;
  brand_id: string | null;
  selling_format_id: string | null;
  keg_owner_id: string | null;
  quantity: number;
  unit_price: number | null;
  notes: string | null;
};

const makeRow = (over: Partial<Row> & Pick<Row, "id" | "quantity" | "unit_price">): Row => ({
  brand_id: null,
  selling_format_id: null,
  keg_owner_id: null,
  notes: null,
  ...over,
});

// True when an actionable "Add Item" <button> is present (the empty-state
// message also contains that phrase as plain text, so match on buttons only).
const hasAddItemButton = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("button")).some((b) =>
    b.textContent?.includes("Add Item"),
  );

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(el: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}

beforeEach(() => {
  h.itemsState = { data: undefined, isLoading: false };
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("OrderItemsEditor", () => {
  it("shows a spinner (and no table) while items are loading", () => {
    h.itemsState = { data: undefined, isLoading: true };
    const c = render(<OrderItemsEditor orderId="o1" />);
    expect(c.querySelector(".animate-spin")).not.toBeNull();
    expect(c.querySelector("table")).toBeNull();
    expect(c.textContent).not.toContain("Line Items");
  });

  it("shows the empty state and an Add Item action when there are no items", () => {
    h.itemsState = { data: [], isLoading: false };
    const c = render(<OrderItemsEditor orderId="o1" />);
    expect(c.textContent).toContain("Line Items");
    expect(c.textContent).toContain("No line items yet");
    expect(hasAddItemButton(c)).toBe(true);
    expect(c.querySelector("table")).not.toBeNull();
    // Only the empty-state row lives in the body.
    expect(c.querySelectorAll("tbody tr").length).toBe(1);
  });

  it("hides the Add Item action in readOnly mode", () => {
    h.itemsState = { data: [], isLoading: false };
    const c = render(<OrderItemsEditor orderId="o1" readOnly />);
    // The empty-state message still names "Add Item", but the actionable
    // button is gated behind !readOnly.
    expect(c.textContent).toContain("No line items yet");
    expect(hasAddItemButton(c)).toBe(false);
  });

  it("renders one row per item with line totals and a footer order total (readOnly)", () => {
    h.itemsState = {
      data: [
        makeRow({ id: "i1", quantity: 5, unit_price: 10 }),
        makeRow({ id: "i2", quantity: 12, unit_price: 2.5 }),
      ],
      isLoading: false,
    };
    const c = render(<OrderItemsEditor orderId="o1" readOnly />);
    expect(c.querySelectorAll("tbody tr").length).toBe(2);
    // Per-row line totals: 5*10 and 12*2.5
    expect(c.textContent).toContain("$50.00");
    expect(c.textContent).toContain("$30.00");
    // Footer order total: 50 + 30
    const footer = c.querySelector("tfoot");
    expect(footer?.textContent).toContain("Order Total");
    expect(footer?.textContent).toContain("$80.00");
  });
});
