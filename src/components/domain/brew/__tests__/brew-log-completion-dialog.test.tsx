// @vitest-environment jsdom
/**
 * Regression coverage for #600: the "Complete Brew" wizard must branch on the
 * linked batch's status, not just on vessel presence, and must be re-runnable
 * after a partial failure.
 *
 * The old loop sent every vessel-bearing batch through a `fermenting`
 * transition, so an already-fermenting batch produced INVALID_TRANSITION and
 * the throw aborted the loop before the brew log itself was completed — making
 * the wizard fail identically on every retry.
 *
 * Idiom notes: the repo has no @testing-library/react, so this uses the shared
 * createRoot + act harness. Radix Select is stubbed with a registry of
 * `onValueChange` callbacks (its listbox needs pointer events jsdom lacks), and
 * React Query is mocked so the dialog's three queries resolve from a fixture
 * that the retry test mutates between attempts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";
import { makeSupabase, type QueuedResponse } from "@/test/supabase-mock";

type LinkedBatchFixture = {
  id: string;
  batch_code: string;
  name: string;
  status: string;
  volume_bbl: number | null;
  current_vessel_id: string | null;
  current_vessel_name: string | null;
  link_volume_bbl: number | null;
};

type VesselFixture = {
  id: string;
  name: string;
  vessel_type: string | null;
  capacity_bbl: number | null;
};

const BREW_LOG_ID = "11111111-1111-4111-8111-111111111111";

const fixture = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: null as any,
  batches: [] as unknown[],
  vessels: [] as unknown[],
  invalidateQueries: vi.fn(),
  transition: vi.fn(),
}));

const selectHandlers = vi.hoisted(() => [] as Array<(value: string) => void>);

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fixture.supabase,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    switch (queryKey[0]) {
      case "brew_logs":
        return {
          data: {
            id: BREW_LOG_ID,
            brew_number: "BL-7",
            status: "in_progress",
            events: [],
          },
          isLoading: false,
        };
      case "brew_log_batches":
        return { data: fixture.batches, isLoading: false };
      case "vessels":
        return { data: fixture.vessels, isLoading: false };
      default:
        return { data: undefined, isLoading: false };
    }
  },
  useQueryClient: () => ({ invalidateQueries: fixture.invalidateQueries }),
}));

vi.mock("@/services/entity-service", () => ({
  entityService: { transition: fixture.transition },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

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
        { "data-testid": "vessel-select", "data-value": props.value },
        props.children as never,
      );
    },
    SelectTrigger: passthrough,
    SelectContent: passthrough,
    SelectValue: () => null,
    SelectItem: (props: Props & { value: string }) =>
      createElement("div", { role: "option", "data-value": props.value }),
  };
});

import { toast } from "sonner";
import { BrewLogCompletionDialog } from "../brew-log-completion-dialog";

const { render, rerender } = setupRenderHarness();

const RPC = "start_batch_fermentation";

function ok() {
  return { success: true, data: {}, invalidate: [] };
}

function invalidTransition(from: string, to: string) {
  return {
    success: false,
    error: {
      code: "INVALID_TRANSITION",
      from,
      to,
      message: `Cannot transition Batch from "${from}" to "${to}"`,
    },
  };
}

/**
 * Mocks transitions so batch transitions obey the real state machine
 * (`fermenting` is not reachable from `fermenting`) and the brew log succeeds.
 */
function transitionsFromFixture() {
  fixture.transition.mockImplementation(
    async (
      _supabase: unknown,
      entity: { name: string },
      id: string,
      target: string,
    ) => {
      if (entity.name === "brew_log") return ok();
      const batch = (fixture.batches as LinkedBatchFixture[]).find(
        (b) => b.id === id,
      );
      const from = batch?.status ?? "planned";
      const allowed: Record<string, string[]> = {
        planned: ["brewing", "fermenting", "archived"],
        brewing: ["fermenting", "archived"],
        fermenting: ["conditioning", "archived"],
        conditioning: ["packaging", "archived"],
      };
      return (allowed[from] ?? []).includes(target)
        ? ok()
        : invalidTransition(from, target);
    },
  );
}

function dialog() {
  return (
    <BrewLogCompletionDialog
      brewLogId={BREW_LOG_ID}
      brewNumber="BL-7"
      open
      onOpenChange={() => {}}
      onSuccess={() => {}}
    />
  );
}

function findButton(text: string): HTMLButtonElement {
  const buttons = Array.from(document.body.querySelectorAll("button"));
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

async function click(text: string) {
  await act(async () => {
    findButton(text).click();
  });
}

/** Re-renders and returns the Select handlers in tree order (one per batch). */
function vesselSelects(): Array<(value: string) => void> {
  selectHandlers.length = 0;
  rerender(dialog());
  return [...selectHandlers];
}

function dialogText(): string {
  return document.body.textContent ?? "";
}

/** Mounts the wizard and advances to step 2 (vessel assignment). */
function openToStep2() {
  render(dialog());
  return click("Next");
}

/** The (entityName, targetState) pairs the run attempted. */
function transitionCalls(): Array<[string, string]> {
  return fixture.transition.mock.calls.map((c) => [
    (c[1] as { name: string }).name,
    c[3] as string,
  ]);
}

function setup(rpcResponses: QueuedResponse[] = []) {
  const sb = makeSupabase({}, rpcResponses.length ? { [RPC]: rpcResponses } : {});
  fixture.supabase = sb.supabase;
  return sb;
}

beforeEach(() => {
  fixture.transition.mockReset();
  fixture.invalidateQueries.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  fixture.batches = [];
  fixture.vessels = [];
  selectHandlers.length = 0;
  transitionsFromFixture();
});

describe("BrewLogCompletionDialog with an already-fermenting batch", () => {
  beforeEach(() => {
    fixture.batches = [
      {
        id: "batch-a",
        batch_code: "B-101",
        name: "West Coast IPA",
        status: "fermenting",
        volume_bbl: 10,
        current_vessel_id: "v-3",
        current_vessel_name: "FV-3",
        link_volume_bbl: 10,
      } satisfies LinkedBatchFixture,
    ];
  });

  it("completes the brew log without re-transitioning the batch", async () => {
    setup();
    await openToStep2();
    await click("Next");
    await click("Complete Brew Day");

    expect(transitionCalls()).toEqual([["brew_log", "completed"]]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it("describes the batch as already fermenting on step 2", async () => {
    setup();
    await openToStep2();

    expect(dialogText()).toContain("Already fermenting");
    expect(dialogText()).toContain("FV-3");
  });

  it("does not promise a fermenting transition on step 3", async () => {
    setup();
    await openToStep2();
    await click("Next");

    expect(dialogText()).toContain("Already fermenting in FV-3");
    expect(dialogText()).not.toContain("→ Fermenting in FV-3");
  });
});

describe("BrewLogCompletionDialog with a mixed selection", () => {
  beforeEach(() => {
    fixture.batches = [
      {
        id: "batch-a",
        batch_code: "B-101",
        name: "West Coast IPA",
        status: "planned",
        volume_bbl: 10,
        current_vessel_id: null,
        current_vessel_name: null,
        link_volume_bbl: 10,
      },
      {
        id: "batch-b",
        batch_code: "B-102",
        name: "Pils",
        status: "fermenting",
        volume_bbl: 10,
        current_vessel_id: "v-9",
        current_vessel_name: "FV-9",
        link_volume_bbl: 10,
      },
    ] satisfies LinkedBatchFixture[];
    fixture.vessels = [
      {
        id: "v-1",
        name: "FV-1",
        vessel_type: "fermenter",
        capacity_bbl: 20,
      } satisfies VesselFixture,
    ];
  });

  it("knocks out only the planned batch and completes the brew log", async () => {
    const sb = setup([{ data: null, error: null }]);
    await openToStep2();

    const [assignA] = vesselSelects();
    await act(async () => assignA("v-1"));

    await click("Next");
    await click("Complete Brew Day");

    expect(sb.rpcSpy).toHaveBeenCalledTimes(1);
    expect(sb.rpcSpy.mock.calls[0]?.[1]).toMatchObject({
      p_batch_id: "batch-a",
      p_vessel_id: "v-1",
    });
    expect(transitionCalls()).toEqual([["brew_log", "completed"]]);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("BrewLogCompletionDialog retry safety", () => {
  beforeEach(() => {
    fixture.batches = [
      {
        id: "batch-a",
        batch_code: "B-101",
        name: "West Coast IPA",
        status: "planned",
        volume_bbl: 10,
        current_vessel_id: null,
        current_vessel_name: null,
        link_volume_bbl: 10,
      },
      {
        id: "batch-b",
        batch_code: "B-102",
        name: "Pils",
        status: "planned",
        volume_bbl: 10,
        current_vessel_id: null,
        current_vessel_name: null,
        link_volume_bbl: 10,
      },
    ] satisfies LinkedBatchFixture[];
    fixture.vessels = [
      { id: "v-1", name: "FV-1", vessel_type: "fermenter", capacity_bbl: 20 },
      { id: "v-2", name: "FV-2", vessel_type: "fermenter", capacity_bbl: 20 },
    ] satisfies VesselFixture[];
  });

  it("keeps going past a failed batch so no later batch is skipped", async () => {
    const sb = setup([
      { data: null, error: { message: "vessel occupied" } },
      { data: null, error: null },
    ]);
    await openToStep2();

    const [assignA, assignB] = vesselSelects();
    await act(async () => assignA("v-1"));
    await act(async () => assignB("v-2"));

    await click("Next");
    await click("Complete Brew Day");

    // Batch B is attempted even though batch A errored first.
    expect(sb.rpcSpy).toHaveBeenCalledTimes(2);
    expect(sb.rpcSpy.mock.calls[1]?.[1]).toMatchObject({
      p_batch_id: "batch-b",
    });
    // The brew log stays in_progress while any batch is outstanding.
    expect(transitionCalls()).toEqual([]);
    expect(toast.error).toHaveBeenCalled();
  });

  it("converges on completion when re-run after a partial failure", async () => {
    const sb = setup([
      { data: null, error: null }, // batch A knocked out
      { data: null, error: { message: "vessel occupied" } }, // batch B fails
      { data: null, error: null }, // batch B retried
    ]);
    await openToStep2();

    const [assignA, assignB] = vesselSelects();
    await act(async () => assignA("v-1"));
    await act(async () => assignB("v-2"));

    await click("Next");
    await click("Complete Brew Day");
    expect(toast.error).toHaveBeenCalled();

    // Attempt 1 committed batch A: it now has a vessel and is fermenting.
    (fixture.batches as LinkedBatchFixture[])[0] = {
      ...(fixture.batches as LinkedBatchFixture[])[0]!,
      status: "fermenting",
      current_vessel_id: "v-1",
      current_vessel_name: "FV-1",
    };
    rerender(dialog());

    await click("Complete Brew Day");

    // Only batch B is re-sent — no duplicate knockout for the committed batch.
    expect(sb.rpcSpy).toHaveBeenCalledTimes(3);
    expect(sb.rpcSpy.mock.calls[2]?.[1]).toMatchObject({
      p_batch_id: "batch-b",
    });
    expect(transitionCalls()).toEqual([["brew_log", "completed"]]);
    expect(toast.success).toHaveBeenCalled();
  });
});

describe("BrewLogCompletionDialog with a genuinely illegal transition", () => {
  it("still fails loudly for a conditioning batch", async () => {
    fixture.batches = [
      {
        id: "batch-c",
        batch_code: "B-103",
        name: "Stout",
        status: "conditioning",
        volume_bbl: 10,
        current_vessel_id: "v-4",
        current_vessel_name: "FV-4",
        link_volume_bbl: 10,
      } satisfies LinkedBatchFixture,
    ];
    setup();
    await openToStep2();
    await click("Next");
    await click("Complete Brew Day");

    expect(transitionCalls()).toEqual([["batch", "fermenting"]]);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
