/**
 * recordBatchReading tool — the confirmation gate's proposal side (Phase 4C).
 *
 * The tool must never write: it returns a ConfirmWriteIntent for the client
 * card, and it refuses ineligible batches and invalid values *before* the
 * user is even offered a Confirm button.
 */

import { describe, expect, it, vi } from "vitest";
import { makeSupabase } from "@/test/supabase-mock";

// tools.ts pulls in the entity core registry, which imports the browser
// Supabase client (and its env validation) at module load. Stub it so the
// suite runs without NEXT_PUBLIC_* env (same as core-registry.test.ts).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ data: [], error: null }) }),
  }),
}));

import { createChatTools } from "../tools";

const BATCH_ID = "22222222-2222-4222-8222-222222222222";

function toolsWithBatch(status: string) {
  const sb = makeSupabase({
    batches: [
      {
        data: { id: BATCH_ID, batch_code: "B-007", status },
        error: null,
      },
    ],
  });
  return { tools: createChatTools(sb.supabase), sb };
}

// The `ai` package types execute loosely; cast to call it directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (tools: any, input: Record<string, unknown>) =>
  tools.recordBatchReading.execute(input, {
    toolCallId: "t1",
    messages: [],
  });

describe("recordBatchReading", () => {
  it("returns a pending confirm_write intent and performs no insert", async () => {
    const { tools, sb } = toolsWithBatch("fermenting");

    const intent = await run(tools, {
      batchId: BATCH_ID,
      readingType: "gravity",
      value: 12.5,
    });

    expect(intent).toMatchObject({
      action: "confirm_write",
      writeAction: "add_batch_reading",
      params: {
        batchId: BATCH_ID,
        reading: {
          reading_type: "gravity",
          value: 12.5,
          unit: "plato", // defaultUnit fills in when unit is omitted
        },
      },
    });
    expect(intent.description).toContain("B-007");
    expect(typeof intent.params.reading.timestamp).toBe("string");
    // Only the batch lookup hit the database — no batch_logs write.
    expect(sb.fromSpy).toHaveBeenCalledTimes(1);
    expect(sb.fromSpy).toHaveBeenCalledWith("batches");
  });

  it("refuses batches that are not fermenting/conditioning/packaging", async () => {
    const { tools } = toolsWithBatch("planned");

    await expect(
      run(tools, { batchId: BATCH_ID, readingType: "ph", value: 4.2 }),
    ).rejects.toThrow(/planned/);
  });

  it("refuses out-of-range values instead of proposing them", async () => {
    const { tools } = toolsWithBatch("fermenting");

    await expect(
      run(tools, { batchId: BATCH_ID, readingType: "ph", value: 22 }),
    ).rejects.toThrow(/at most 14/);
  });

  it("refuses a unit the reading type does not support", async () => {
    const { tools } = toolsWithBatch("fermenting");

    await expect(
      run(tools, {
        batchId: BATCH_ID,
        readingType: "gravity",
        value: 12,
        unit: "psi",
      }),
    ).rejects.toThrow(/Invalid unit/);
  });

  it("range-checks a Celsius temperature against the canonical °F bounds, not the raw number", async () => {
    const { tools } = toolsWithBatch("fermenting");

    // 60°C = 140°F, outside the 32-100°F range. A unit-blind check against
    // the raw value "60" would incorrectly accept it.
    await expect(
      run(tools, {
        batchId: BATCH_ID,
        readingType: "temperature",
        value: 60,
        unit: "c",
      }),
    ).rejects.toThrow(/at most 100/);
  });

  it("accepts a Celsius temperature that converts within the canonical °F range", async () => {
    const { tools } = toolsWithBatch("fermenting");

    // 18°C = 64.4°F, well within range — must not be rejected by a
    // unit-blind check against "18" as if it were already °F.
    const intent = await run(tools, {
      batchId: BATCH_ID,
      readingType: "temperature",
      value: 18,
      unit: "c",
    });

    expect(intent.params.reading).toMatchObject({
      reading_type: "temperature",
      value: 18,
      unit: "c",
    });
  });
});
