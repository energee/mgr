// @vitest-environment jsdom
/**
 * Regression coverage for #447's client command boundary.
 *
 * Balance enforcement, serialization, status maintenance, and idempotency live
 * in Postgres. These tests prove the dialog sends one complete command, keeps
 * the same request id across a failed/ambiguous retry, and only invalidates
 * caches after the database reports a committed result.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import { makeSupabase, type QueuedResponse } from "@/test/supabase-mock";
import { batchKeys, entityKeys, yeastKeys } from "@/lib/query-keys";

type PitchValues = {
  pitch_id: string;
  viability: number;
  quantity_lbs: number;
  notes?: string | null;
};

type MutationOptions = {
  mutationFn: (values: PitchValues) => Promise<unknown>;
  onSuccess: (result: unknown) => void | Promise<void>;
  onError: (error: unknown, values: PitchValues) => void | Promise<void>;
};

const PITCH_ID = "11111111-1111-4111-8111-111111111111";
const BATCH_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RPC = "pitch_yeast_atomic";

const pitch = {
  id: PITCH_ID,
  strain_id: "33333333-3333-4333-8333-333333333333",
  strain_name: "House Ale",
  generation: 2,
  quantity_remaining_lbs: 5,
  estimated_viability: 95,
  cell_density_thousand: 1000,
  status: "in_stock",
};

const fixture = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: null as any,
  mutation: null as MutationOptions | null,
  invalidateQueries: vi.fn(),
  requestIds: [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ],
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fixture.supabase,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === "yeast-strains"
      ? { data: new Map(), isLoading: false }
      : { data: [pitch], isLoading: false },
  useMutation: (options: MutationOptions) => {
    fixture.mutation = options;
    return { mutate: vi.fn(), isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: fixture.invalidateQueries }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { PitchYeastDialog } from "../pitch-yeast-dialog";

const { render } = setupRenderHarness();

function setup(rpcResponses: QueuedResponse[]) {
  const sb = makeSupabase({}, { [RPC]: rpcResponses });
  fixture.supabase = sb.supabase;
  fixture.mutation = null;

  render(
    <PitchYeastDialog
      open
      onOpenChange={() => {}}
      batchId={BATCH_ID}
      batchName="Batch 447"
    />,
  );

  if (!fixture.mutation) throw new Error("mutation was not registered");
  return { ...sb, mutation: fixture.mutation };
}

async function execute(mutation: MutationOptions, values: PitchValues) {
  try {
    const result = await mutation.mutationFn(values);
    await mutation.onSuccess(result);
    return result;
  } catch (error) {
    await mutation.onError(error, values);
    throw error;
  }
}

beforeEach(() => {
  fixture.mutation = null;
  fixture.invalidateQueries.mockReset();
  fixture.requestIds = [REQUEST_A, REQUEST_B, REQUEST_C];
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
    const next = fixture.requestIds.shift();
    if (!next) throw new Error("unexpected request id allocation");
    return next as `${string}-${string}-${string}-${string}-${string}`;
  });
});

describe("PitchYeastDialog atomic command", () => {
  it("sends the whole pitch through one RPC and never writes tables directly", async () => {
    const sb = setup([
      {
        data: {
          kind: "created",
          event_id: REQUEST_A,
          remaining_quantity_lbs: 3,
          status: "in_stock",
        },
        error: null,
      },
    ]);

    await execute(sb.mutation, {
      pitch_id: PITCH_ID,
      viability: 92.5,
      quantity_lbs: 2,
      notes: "Healthy crop",
    });

    expect(sb.rpcSpy).toHaveBeenCalledTimes(1);
    expect(sb.fromSpy).not.toHaveBeenCalled();
    expect(sb.rpcSpy).toHaveBeenCalledWith(RPC, {
      p_request_id: REQUEST_A,
      p_pitch_id: PITCH_ID,
      p_batch_id: BATCH_ID,
      p_quantity_lbs: 2,
      p_viability_at_pitch: 92.5,
      p_notes: "Healthy crop",
    });
  });

  it("reuses the request id after failure and invalidates only after commit", async () => {
    const databaseError = { message: "connection closed after commit was unknown" };
    const sb = setup([
      { data: null, error: databaseError },
      {
        data: {
          kind: "duplicate",
          event_id: REQUEST_A,
          remaining_quantity_lbs: 3,
          status: "in_stock",
        },
        error: null,
      },
      {
        data: {
          kind: "created",
          event_id: REQUEST_B,
          remaining_quantity_lbs: 2,
          status: "in_stock",
        },
        error: null,
      },
    ]);
    const values = {
      pitch_id: PITCH_ID,
      viability: 95,
      quantity_lbs: 2,
      notes: null,
    };

    await expect(execute(sb.mutation, values)).rejects.toEqual(databaseError);
    expect(fixture.invalidateQueries).not.toHaveBeenCalled();

    await execute(sb.mutation, values);
    expect(sb.rpcSpy.mock.calls[0]?.[1]).toMatchObject({ p_request_id: REQUEST_A });
    expect(sb.rpcSpy.mock.calls[1]?.[1]).toMatchObject({ p_request_id: REQUEST_A });
    expect(fixture.invalidateQueries).toHaveBeenCalledWith({
      queryKey: yeastKeys.all(),
    });
    expect(fixture.invalidateQueries).toHaveBeenCalledWith({
      queryKey: yeastKeys.events(PITCH_ID),
    });
    expect(fixture.invalidateQueries).toHaveBeenCalledWith({
      queryKey: batchKeys.yeastSummary(BATCH_ID),
    });
    expect(fixture.invalidateQueries).toHaveBeenCalledWith({
      queryKey: batchKeys.yeastStrains(BATCH_ID),
    });
    expect(fixture.invalidateQueries).toHaveBeenCalledWith({
      queryKey: entityKeys.all("yeast_pitches_with_remaining"),
    });
    expect(fixture.invalidateQueries).toHaveBeenCalledWith({
      queryKey: entityKeys.all("yeast_pitch_events"),
    });
    expect(fixture.invalidateQueries).toHaveBeenCalledWith({
      queryKey: yeastKeys.lineageAll(),
    });
    expect(fixture.invalidateQueries).toHaveBeenCalledWith({
      queryKey: yeastKeys.lineageSummaryAll(),
    });
    expect(fixture.invalidateQueries).toHaveBeenCalledTimes(8);

    await execute(sb.mutation, { ...values, quantity_lbs: 1 });
    expect(sb.rpcSpy.mock.calls[2]?.[1]).toMatchObject({ p_request_id: REQUEST_B });
  });

  it("refreshes stale availability and starts a new command after a database conflict", async () => {
    const conflict = {
      code: "PT409",
      message: "Cannot pitch 2 lbs: only 1 lb remains",
    };
    const sb = setup([
      { data: null, error: conflict },
      {
        data: {
          kind: "created",
          event_id: REQUEST_B,
          remaining_quantity_lbs: 0,
          status: "depleted",
        },
        error: null,
      },
    ]);
    const values = {
      pitch_id: PITCH_ID,
      viability: 95,
      quantity_lbs: 2,
      notes: null,
    };

    await expect(execute(sb.mutation, values)).rejects.toEqual(conflict);
    expect(fixture.invalidateQueries).toHaveBeenCalledWith({
      queryKey: yeastKeys.all(),
    });
    expect(fixture.invalidateQueries).toHaveBeenCalledTimes(8);

    await execute(sb.mutation, { ...values, quantity_lbs: 1 });
    expect(sb.rpcSpy.mock.calls[1]?.[1]).toMatchObject({
      p_request_id: REQUEST_B,
      p_quantity_lbs: 1,
    });
  });

  it("does not reuse an unresolved request id with changed input", async () => {
    const ambiguousError = { message: "connection closed before response" };
    const sb = setup([
      { data: null, error: ambiguousError },
      {
        data: {
          kind: "duplicate",
          event_id: REQUEST_A,
          remaining_quantity_lbs: 3,
          status: "in_stock",
        },
        error: null,
      },
    ]);
    const values = {
      pitch_id: PITCH_ID,
      viability: 95,
      quantity_lbs: 2,
      notes: null,
    };

    await expect(execute(sb.mutation, values)).rejects.toEqual(ambiguousError);
    await expect(
      execute(sb.mutation, { ...values, quantity_lbs: 1 }),
    ).rejects.toThrow("This retry changed an unresolved yeast pitch");
    expect(sb.rpcSpy).toHaveBeenCalledTimes(1);

    await execute(sb.mutation, values);
    expect(sb.rpcSpy.mock.calls[1]?.[1]).toMatchObject({
      p_request_id: REQUEST_A,
      p_quantity_lbs: 2,
    });
  });
});
