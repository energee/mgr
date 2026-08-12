/**
 * Direct tests for `useSortableRows` — the mutation kernel and ID backfill that
 * all five row editors (grain bill, hop, mash, fermentation, batch additions)
 * now share.
 *
 * The backfill is the highest-risk piece of the extraction: its whole purpose
 * is to run at most ONCE per mount, and a regression is silent — IDs would be
 * regenerated on a later render, changing every row's React key and drag value
 * mid-interaction (dropping the drag, remounting every input). The per-editor
 * characterization suites only cover it indirectly, so it is pinned here
 * against the shared implementation.
 */

import { describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import { useSortableRows, type SortableRowsApi } from "../sortable-rows";

const harness = setupRenderHarness();

type Row = { id?: string; position: number; name?: string };

type ProbeProps = {
  items: Row[];
  onChange: (items: Row[]) => void;
  generateId?: () => string;
};

/**
 * Mounts the hook and exposes its API. `onChange` is NOT wired back into
 * `items` — each test drives `items` explicitly so it controls exactly what the
 * hook sees on each render. The API is published through an effect because
 * `react-hooks/immutability` forbids writing to outer scope during render.
 */
function mountHook(props: ProbeProps) {
  const captured = { api: undefined as SortableRowsApi<Row> | undefined };

  function Probe(p: ProbeProps) {
    const api = useSortableRows<Row>(p);
    useEffect(() => {
      captured.api = api;
    });
    return null;
  }

  harness.render(<Probe {...props} />);
  return {
    captured,
    rerender: (next: ProbeProps) => harness.rerender(<Probe {...next} />),
  };
}

/** Deterministic, collision-free id factory so assertions can name exact ids. */
function seqIds() {
  let n = 0;
  return vi.fn(() => `gen-${++n}`);
}

describe("useSortableRows — ID backfill", () => {
  it("stamps an id onto rows missing one, exactly once, on mount", () => {
    const onChange = vi.fn();
    const generateId = seqIds();

    mountHook({
      items: [{ id: "a", position: 0 }, { position: 1 }, { position: 2 }],
      onChange,
      generateId,
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual([
      { id: "a", position: 0 },
      { id: "gen-1", position: 1 },
      { id: "gen-2", position: 2 },
    ]);
    // Rows that already had an id keep it — the backfill must not re-key them.
    expect(generateId).toHaveBeenCalledTimes(2);
  });

  it("does not fire again while the parent has not yet applied the backfill", () => {
    const onChange = vi.fn();
    const generateId = seqIds();

    const { rerender } = mountHook({
      items: [{ position: 0 }],
      onChange,
      generateId,
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // The dangerous case, and the reason for the ref guard: the recipe/batch
    // forms re-create `onChange` on every render, so the effect's deps change
    // while `items` STILL lacks ids (the parent has not committed the backfill
    // yet). Without the guard this re-fires and mints a fresh id per render,
    // re-keying every row mid-interaction.
    rerender({ items: [{ position: 0 }], onChange: vi.fn(), generateId });
    rerender({ items: [{ position: 0 }], onChange: vi.fn(), generateId });

    expect(generateId).toHaveBeenCalledTimes(1);
  });

  it("does not re-stamp a row that loses its id after mount", () => {
    const onChange = vi.fn();
    const generateId = seqIds();

    const { rerender } = mountHook({
      items: [{ id: "a", position: 0 }],
      onChange,
      generateId,
    });
    expect(onChange).not.toHaveBeenCalled();

    rerender({ items: [{ position: 0 }], onChange, generateId });

    // One-shot by design: the guard trips on the first effect run regardless of
    // outcome, so a later id-less row is left alone rather than re-keyed.
    expect(onChange).not.toHaveBeenCalled();
    expect(generateId).not.toHaveBeenCalled();
  });

  it("stays silent when every row already has an id", () => {
    const onChange = vi.fn();
    const generateId = seqIds();

    mountHook({
      items: [{ id: "a", position: 0 }, { id: "b", position: 1 }],
      onChange,
      generateId,
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(generateId).not.toHaveBeenCalled();
  });

  it("skips the backfill entirely when no generateId is supplied", () => {
    // Grain bill, hop and additions key their rows off a foreign key or mint
    // ids on append, so they pass no factory and must never be rewritten.
    const onChange = vi.fn();

    mountHook({ items: [{ position: 0 }, { position: 1 }], onChange });

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("useSortableRows — mutation kernel", () => {
  const items: Row[] = [
    { id: "a", position: 0, name: "first" },
    { id: "b", position: 1, name: "second" },
    { id: "c", position: 2, name: "third" },
  ];

  it("appends with position set to the current length", () => {
    const onChange = vi.fn();
    const { captured } = mountHook({ items, onChange });

    captured.api!.append({ id: "d", name: "fourth" });

    expect(onChange).toHaveBeenCalledWith([...items, { id: "d", name: "fourth", position: 3 }]);
  });

  it("renumbers survivors after a remove", () => {
    const onChange = vi.fn();
    const { captured } = mountHook({ items, onChange });

    captured.api!.remove(1);

    expect(onChange).toHaveBeenCalledWith([
      { id: "a", position: 0, name: "first" },
      { id: "c", position: 1, name: "third" },
    ]);
  });

  it("renumbers a dragged order to match the new array order", () => {
    const onChange = vi.fn();
    const { captured } = mountHook({ items, onChange });

    captured.api!.reorder([items[2], items[0], items[1]]);

    expect(onChange).toHaveBeenCalledWith([
      { id: "c", position: 0, name: "third" },
      { id: "a", position: 1, name: "first" },
      { id: "b", position: 2, name: "second" },
    ]);
  });

  it("does not mutate the caller's rows when renumbering", () => {
    // The pre-extraction editors renumbered in place, silently rewriting the
    // parent's own objects. The kernel is immutable; this pins that.
    const onChange = vi.fn();
    const { captured } = mountHook({ items, onChange });

    captured.api!.remove(0);

    expect(items[1].position).toBe(1);
    expect(items[2].position).toBe(2);
  });

  it("patches one row and leaves its siblings untouched by identity", () => {
    const onChange = vi.fn();
    const { captured } = mountHook({ items, onChange });

    captured.api!.update(1, { name: "renamed" });

    const next = onChange.mock.calls[0][0] as Row[];
    expect(next[1]).toEqual({ id: "b", position: 1, name: "renamed" });
    expect(next[0]).toBe(items[0]);
    expect(next[2]).toBe(items[2]);
  });

  it("sets a single field through updateField", () => {
    const onChange = vi.fn();
    const { captured } = mountHook({ items, onChange });

    captured.api!.updateField(0, "name", "renamed");

    const next = onChange.mock.calls[0][0] as Row[];
    expect(next[0]).toEqual({ id: "a", position: 0, name: "renamed" });
  });
});
