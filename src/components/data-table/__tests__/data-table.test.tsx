/**
 * DataTable row keyboard-navigation tests (audit A11Y-1).
 *
 * The desktop entity tables were mouse-only: rows navigated via a per-cell
 * onClick with no tabIndex/role, so keyboard and screen-reader users had no
 * path to the detail page. `getRowHref` now wraps the first navigable cell's
 * content in a real <Link> (the desktop counterpart of
 * entity-mobile-card-list's Link pattern). These tests pin:
 * - the primary cell renders an anchor with the row's href (focusable by
 *   default, announced as a link);
 * - select/actions cells never get the anchor;
 * - rows without an href (getRowHref → null) and tables without getRowHref
 *   render no anchors at all.
 *
 * Uses the shared createRoot+act harness — no @testing-library/react.
 */

import { describe, it, expect, vi } from "vitest";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { setupRenderHarness } from "@/test/react-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// data-table.tsx imports adapter.tsx (NON_NAVIGABLE_COLUMN_IDS), which pulls
// in UnitDisplay → use-unit-preferences → the supabase client, whose
// module-level env validation throws in tests — mock it out.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

// next/link renders a plain anchor for the test DOM.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { DataTable } from "@/components/data-table/data-table";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Row = { id: string; name: string; status: string };

const rows: Row[] = [
  { id: "1", name: "Alpha", status: "active" },
  { id: "2", name: "Beta", status: "inactive" },
];

const columns: ColumnDef<Row>[] = [
  {
    id: "select",
    header: () => null,
    cell: () => <input type="checkbox" aria-label="Select row" />,
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => row.original.name,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => row.original.status,
  },
];

function Harness({
  getRowHref,
}: {
  getRowHref?: (row: Row) => string | null;
}) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <DataTable table={table} onRowClick={() => {}} getRowHref={getRowHref} />
  );
}

const { render } = setupRenderHarness();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DataTable row keyboard path (audit A11Y-1)", () => {
  it("renders the first navigable cell's content inside a real link", () => {
    const container = render(
      <Harness getRowHref={(row) => `/things/${row.id}`} />
    );

    const anchors = container.querySelectorAll("tbody a");
    expect(anchors).toHaveLength(2);
    expect(anchors[0].getAttribute("href")).toBe("/things/1");
    expect(anchors[0].textContent).toBe("Alpha");
    expect(anchors[1].getAttribute("href")).toBe("/things/2");
    expect(anchors[1].textContent).toBe("Beta");

    // The link lives in the name cell (first non-select column), not the
    // select cell.
    const firstRowCells = container.querySelectorAll(
      "tbody tr:first-child td"
    );
    expect(firstRowCells[0].querySelector("a")).toBeNull();
    expect(firstRowCells[1].querySelector("a")).not.toBeNull();
    // Only the primary cell is wrapped — the status cell stays plain.
    expect(firstRowCells[2].querySelector("a")).toBeNull();
  });

  it("skips rows where getRowHref returns null", () => {
    const container = render(
      <Harness
        getRowHref={(row) => (row.id === "1" ? `/things/${row.id}` : null)}
      />
    );
    const anchors = container.querySelectorAll("tbody a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe("/things/1");
  });

  it("renders no links when getRowHref is not provided", () => {
    const container = render(<Harness />);
    expect(container.querySelectorAll("tbody a")).toHaveLength(0);
  });
});
