// @vitest-environment jsdom
/**
 * EntityEmptyState — the empty panel shared by the desktop table's
 * `noResultsContent` and the mobile card list (ponytail audit item 22, where
 * the two were byte-identical copies).
 *
 * The behaviour worth pinning is the filtered/unfiltered split: a filtered
 * empty list must NOT offer "Create", because the entity may be full of rows
 * that simply don't match — offering creation there reads as "this entity is
 * empty" and invites a duplicate record.
 */
import { describe, it, expect, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import { EntityEmptyState } from "../entity-empty-state";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children?: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const entity = { displayName: "Order", displayNamePlural: "Orders" };

const { render } = setupRenderHarness();

describe("EntityEmptyState", () => {
  it("offers creation and the 'yet' copy when nothing is filtered", () => {
    const container = render(
      <EntityEmptyState
        entity={entity}
        hasActiveFilters={false}
        showCreate
        basePath="/orders"
      />,
    );

    expect(container.textContent).toContain("No orders yet");
    expect(container.textContent).toContain(
      "Get started by creating your first order",
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/orders/new",
    );
  });

  it("shows the filter-relaxing copy and NO create button when filtered", () => {
    const container = render(
      <EntityEmptyState
        entity={entity}
        hasActiveFilters
        showCreate
        basePath="/orders"
      />,
    );

    expect(container.textContent).toContain("No matching orders");
    expect(container.textContent).toContain(
      "Try adjusting your search or filters",
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("prefers onCreateClick over the /new link when provided", () => {
    const onCreateClick = vi.fn();
    const container = render(
      <EntityEmptyState
        entity={entity}
        hasActiveFilters={false}
        showCreate
        basePath="/orders"
        onCreateClick={onCreateClick}
      />,
    );

    expect(container.querySelector("a")).toBeNull();
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Create Order");
    button?.click();
    expect(onCreateClick).toHaveBeenCalledTimes(1);
  });

  it("omits the create affordance entirely when showCreate is false", () => {
    const container = render(
      <EntityEmptyState
        entity={entity}
        hasActiveFilters={false}
        basePath="/orders"
      />,
    );

    expect(container.textContent).toContain("No orders yet");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});
