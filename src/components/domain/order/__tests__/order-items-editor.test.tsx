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
 * @testing-library/react). react-query, the Supabase client, and the catalog
 * hooks are mocked so render is deterministic and offline:
 *   - useQuery switches on queryKey and reads a hoisted, per-test-mutable
 *     fixture for the order-items query; every other query (order detail,
 *     inventory availability) returns empty.
 *   - Rows are asserted through the readOnly branch, which renders plain
 *     text/spans and avoids the Combobox/Input editing chrome (orthogonal to
 *     the loading/empty/rows layout logic under test).
 *
 * The "Apply tier price" block additionally pins the customer-tier pricing
 * lookup that reaches the get_price_for_customer RPC — written against the
 * pre-extraction inline implementation so the move to
 * @/services/pricing-service is provably behavior-preserving.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";

// Mutable fixture the react-query mock reads. Hoisted so the (hoisted)
// vi.mock factory can close over it without a TDZ error.
const h = vi.hoisted(() => ({
  itemsState: {
    data: undefined as unknown[] | undefined,
    isLoading: false,
  },
  brands: [] as Array<{ id: string; name: string }>,
  formats: [] as Array<{
    id: string;
    name: string;
    container_type: string;
    container_name: string;
    unit_count: number;
    volume_oz: number | null;
    volume_bbl: number | null;
  }>,
  owners: [] as Array<{ id: string; name: string }>,
  // Pricing-lookup recorder + programmable RPC response.
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: [] as unknown[] | null, error: null as unknown },
  // Every useMutation().mutate(vars) in the component lands here; the vars
  // shape identifies which mutation fired.
  mutateCalls: [] as unknown[],
  toasts: [] as Array<{ kind: "success" | "error"; message: string }>,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ fn, args });
      return Promise.resolve(h.rpcResult);
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => h.toasts.push({ kind: "success", message }),
    error: (message: string) => h.toasts.push({ kind: "error", message }),
  },
}));

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
  useMutation: () => ({
    mutate: (vars: unknown) => h.mutateCalls.push(vars),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-catalog", () => ({
  useBrands: () => ({ data: h.brands }),
  usePackagingFormats: () => ({ data: h.formats }),
  useKegOwners: () => ({ data: h.owners }),
  formatVolumeLabel: (v: unknown) => String(v),
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

const { render, rerender } = setupRenderHarness();

beforeEach(() => {
  h.itemsState = { data: undefined, isLoading: false };
  h.brands = [];
  h.formats = [];
  h.owners = [];
  h.rpcCalls = [];
  h.rpcResult = { data: [], error: null };
  h.mutateCalls = [];
  h.toasts = [];
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

  it("shows selected brand, format, and keg owner after catalogs load asynchronously", () => {
    h.itemsState = {
      data: [
        makeRow({
          id: "i1",
          brand_id: "brand-1",
          selling_format_id: "format-1",
          keg_owner_id: "owner-1",
          quantity: 1,
          unit_price: 98,
        }),
      ],
      isLoading: false,
    };
    const c = render(<OrderItemsEditor orderId="o1" />);

    h.brands = [{ id: "brand-1", name: "Rubico II" }];
    h.formats = [{
      id: "format-1",
      name: "Per Keg",
      container_type: "keg",
      container_name: "1/6 Barrel",
      unit_count: 1,
      volume_oz: null,
      volume_bbl: 1 / 6,
    }];
    h.owners = [{ id: "owner-1", name: "Microstar" }];
    rerender(<OrderItemsEditor orderId="o1" />);

    const displayedValues = Array.from(
      c.querySelectorAll<HTMLInputElement>("[data-slot='combobox-input']"),
      (input) => input.value,
    );
    expect(displayedValues).toEqual(
      expect.arrayContaining(["Rubico II", "Per Keg", "Microstar"]),
    );
  });
});

// ===========================================================================
// Customer-tier pricing lookup
// ===========================================================================

describe("OrderItemsEditor — apply tier price", () => {
  // A priced row: brand + format set so the "Apply tier price" button renders
  // (it is gated on customer + brand + format all being present).
  const pricedRow = () =>
    makeRow({
      id: "i1",
      brand_id: "brand-1",
      selling_format_id: "format-1",
      quantity: 4,
      unit_price: 8,
    });

  const clickApply = async (c: HTMLElement) => {
    const button = c.querySelector<HTMLButtonElement>('[aria-label="Apply tier price"]');
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
    });
  };

  const renderPriced = () => {
    h.itemsState = { data: [pricedRow()], isLoading: false };
    h.brands = [{ id: "brand-1", name: "Rubico II" }];
    h.formats = [{
      id: "format-1",
      name: "Per Case",
      container_type: "case",
      container_name: "12oz Can",
      unit_count: 24,
      volume_oz: 12,
      volume_bbl: null,
    }];
    return render(<OrderItemsEditor orderId="o1" customerId="cust-1" />);
  };

  it("looks up the tier price for the row's customer/brand/format and applies it", async () => {
    h.rpcResult = {
      data: [{ price: 12.5, tier_name: "Wholesale", is_brand_specific: false, is_style_specific: false }],
      error: null,
    };
    const c = renderPriced();
    await clickApply(c);

    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0].fn).toBe("get_price_for_customer");
    const args = h.rpcCalls[0].args;
    expect(args.p_customer_id).toBe("cust-1");
    expect(args.p_format_id).toBe("format-1");
    expect(args.p_brand_id).toBe("brand-1");
    // No style on an order line. The RPC declares p_style_id DEFAULT NULL, so
    // an explicit null and an omitted key are the same call — assert the
    // meaning, not which of the two encodings the caller happens to use.
    expect(args.p_style_id ?? null).toBeNull();

    // The resolved price is written back to the row's unit_price…
    expect(h.mutateCalls).toContainEqual({ id: "i1", field: "unit_price", value: 12.5 });
    // …and the tier name is surfaced in the confirmation toast.
    expect(h.toasts).toContainEqual({
      kind: "success",
      message: "Applied Wholesale price: $12.50",
    });
  });

  it("reports no tier price when the lookup returns no rows (and writes nothing)", async () => {
    h.rpcResult = { data: [], error: null };
    const c = renderPriced();
    await clickApply(c);

    expect(h.rpcCalls).toHaveLength(1);
    expect(h.mutateCalls).toHaveLength(0);
    expect(h.toasts).toContainEqual({
      kind: "error",
      message: "No tier price found for this combination",
    });
  });

  it("treats an RPC error as 'no tier price' rather than surfacing it (and writes nothing)", async () => {
    h.rpcResult = { data: null, error: { message: "boom" } };
    const c = renderPriced();
    await clickApply(c);

    expect(h.mutateCalls).toHaveLength(0);
    expect(h.toasts).toContainEqual({
      kind: "error",
      message: "No tier price found for this combination",
    });
  });

  it("does not offer the lookup when the order has no customer", () => {
    h.itemsState = { data: [pricedRow()], isLoading: false };
    h.brands = [{ id: "brand-1", name: "Rubico II" }];
    const c = render(<OrderItemsEditor orderId="o1" />);
    expect(c.querySelector('[aria-label="Apply tier price"]')).toBeNull();
    expect(h.rpcCalls).toHaveLength(0);
  });
});
