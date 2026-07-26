// @vitest-environment jsdom
/**
 * Regression coverage for #602: BulkStatusActionBar.handleApply must not
 * announce success when the callback reports that zero records transitioned.
 *
 * `onStatusChange` returns `number | undefined`, so `0` ("nothing moved") is an
 * in-band value that the old `count || selectedRows.length` fallback silently
 * turned into the selection size. These tests pin the three distinct returns
 * (`0`, `undefined`, `n > 0`) and the target-status reset that must happen on
 * every path.
 *
 * Radix Select is stubbed with a plain registry of `onValueChange` callbacks —
 * the repo has no @testing-library/react and Radix's listbox needs pointer
 * events jsdom does not implement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import type { EntityConfig } from "@/types/entity";

// Prevents env-var validation in @/lib/env from throwing at import time
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const selectHandlers = vi.hoisted(() => [] as Array<(value: string) => void>);

vi.mock("@/components/ui/select", async () => {
  const { createElement, Fragment } = await import("react");
  type Props = { children?: unknown };
  const passthrough = (props: Props) =>
    createElement(Fragment, null, props.children as never);
  return {
    Select: (
      props: Props & { value?: string; onValueChange?: (v: string) => void },
    ) => {
      if (props.onValueChange) selectHandlers.push(props.onValueChange);
      return createElement(
        "div",
        { "data-testid": "status-select", "data-value": props.value },
        props.children as never,
      );
    },
    SelectTrigger: passthrough,
    SelectContent: passthrough,
    SelectValue: () => null,
    SelectItem: (props: Props & { value: string; disabled?: boolean }) =>
      createElement(
        "div",
        {
          role: "option",
          "data-value": props.value,
          "data-disabled": props.disabled ? "true" : undefined,
        },
        props.children as never,
      ),
  };
});

import { toast } from "sonner";
import { BulkStatusActionBar } from "../bulk-status-action-bar";

type Row = { id: string; status: string };

const entity = {
  name: "batches",
  displayName: "Batch",
  displayNamePlural: "Batches",
  actions: [],
  stateMachine: {
    stateField: "status",
    transitions: { packaging: ["completed"] },
    stateDisplay: { completed: { label: "Completed" } },
  },
} as unknown as EntityConfig<Row>;

const selectedRows: Row[] = [
  { id: "a", status: "packaging" },
  { id: "b", status: "packaging" },
  { id: "c", status: "packaging" },
];

const { render } = setupRenderHarness();

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button"));
  const match = buttons.find((b) => (b.textContent ?? "").includes(text));
  if (!match) {
    throw new Error(
      `no button matching "${text}"; found: ${buttons
        .map((b) => b.textContent)
        .join(" | ")}`,
    );
  }
  return match;
}

/** Renders the bar, picks "completed" in the (stubbed) Select, clicks Apply. */
async function applyStatus(
  onStatusChange: (target: string) => Promise<number | undefined>,
) {
  selectHandlers.length = 0;
  const container = render(
    <BulkStatusActionBar
      entity={entity}
      selectedRows={selectedRows}
      onStatusChange={onStatusChange}
      onClearSelection={() => {}}
    />,
  );

  const setTarget = selectHandlers.at(-1);
  if (!setTarget) throw new Error("status Select was not rendered");
  await act(async () => setTarget("completed"));

  await act(async () => {
    findButton(container, "Apply").click();
  });
  return container;
}

beforeEach(() => {
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("BulkStatusActionBar apply", () => {
  it("does not claim success when zero records transitioned", async () => {
    await applyStatus(async () => 0);

    expect(toast.success).not.toHaveBeenCalled();
  });

  it("resets the target status after a zero-count apply", async () => {
    const container = await applyStatus(async () => 0);

    expect(
      container
        .querySelector('[data-testid="status-select"]')
        ?.getAttribute("data-value"),
    ).toBe("_placeholder");
  });

  it("reports the returned count, not the selection size", async () => {
    await applyStatus(async () => 1);

    expect(toast.success).toHaveBeenCalledWith("Updated 1 batch to Completed");
  });

  it("falls back to the selection size when the callback returns undefined", async () => {
    await applyStatus(async () => undefined);

    expect(toast.success).toHaveBeenCalledWith(
      "Updated 3 batches to Completed",
    );
  });

  it("still reports a full-selection success", async () => {
    await applyStatus(async () => 3);

    expect(toast.success).toHaveBeenCalledWith(
      "Updated 3 batches to Completed",
    );
  });
});
