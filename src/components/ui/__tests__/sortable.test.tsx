/**
 * `SortableItemHandle`'s ref callback must register the handle's DOM node as
 * the dnd-kit drag activator (`setActivatorNodeRef`) whenever the handle is
 * actually usable — mirroring `SortableItem`'s own `asHandle` ref callback a
 * few lines above it, which does the ref work only when NOT disabled. An
 * inverted guard here silently breaks dnd-kit's keyboard-drag and
 * focus-restoration behavior (which key off the activator node) for every
 * handle-based sortable list in the app (grain bill, hop schedule, mash
 * schedule, fermentation schedule, batch additions, filter/sort reorder).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import { Sortable, SortableContent, SortableItem, SortableItemHandle } from "../sortable";

const setActivatorNodeRef = vi.fn();

vi.mock("@dnd-kit/sortable", async () => {
  const actual =
    await vi.importActual<typeof import("@dnd-kit/sortable")>("@dnd-kit/sortable");
  return {
    ...actual,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      setActivatorNodeRef,
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

const harness = setupRenderHarness();

beforeEach(() => {
  setActivatorNodeRef.mockClear();
});

function renderHandle(disabled?: boolean) {
  return harness.render(
    <Sortable value={["a"]} getItemValue={(v: string) => v}>
      <SortableContent>
        <SortableItem value="a">
          <SortableItemHandle disabled={disabled} />
        </SortableItem>
      </SortableContent>
    </Sortable>,
  );
}

describe("SortableItemHandle", () => {
  it("registers its DOM node as the drag activator when enabled", () => {
    const container = renderHandle();
    const handleNode = container.querySelector('[data-slot="sortable-item-handle"]');

    expect(handleNode).not.toBeNull();
    expect(setActivatorNodeRef).toHaveBeenCalledWith(handleNode);
  });

  it("does not register an activator when disabled", () => {
    renderHandle(true);

    expect(setActivatorNodeRef).not.toHaveBeenCalled();
  });
});
