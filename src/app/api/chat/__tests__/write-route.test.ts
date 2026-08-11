/**
 * Confirm-gated chat write route (Phase 4C).
 *
 * Proves the /api/chat/write endpoint re-validates the pending payload,
 * refuses ineligible batches, executes under the caller-scoped client, and
 * maps an RLS denial (42501) to a friendly FORBIDDEN instead of a raw
 * Postgres error.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeSupabase } from "@/test/supabase-mock";

const fixture = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: null as any,
}));

vi.mock("@/lib/api/auth", () => ({
  withPermission:
    (_permission: string, handler: (...args: never[]) => unknown) =>
    async (request: NextRequest) =>
      handler(request as never, {
        user: { id: "brewer-1" },
        supabase: fixture.supabase,
      } as never),
}));

import { POST } from "../write/route";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";

function readingBody(overrides: Record<string, unknown> = {}) {
  return {
    writeAction: "add_batch_reading",
    params: {
      batchId: BATCH_ID,
      reading: {
        reading_type: "gravity",
        value: 12.5,
        unit: "plato",
        timestamp: "2026-08-11T12:00:00.000Z",
        ...overrides,
      },
    },
  };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/chat/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  fixture.supabase = null;
});

describe("POST /api/chat/write", () => {
  it("inserts a confirmed reading as a batch_logs measurement", async () => {
    const sb = makeSupabase({
      batches: [
        {
          data: { id: BATCH_ID, batch_code: "B-042", status: "fermenting" },
          error: null,
        },
      ],
      batch_logs: [{ data: null, error: null }],
    });
    fixture.supabase = sb.supabase;

    const response = await POST(request(readingBody()));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      saved: true,
      batchCode: "B-042",
    });
    const insertArgs = sb.callsByTable.batch_logs[0].insert.mock.calls[0][0];
    expect(insertArgs).toEqual({
      batch_id: BATCH_ID,
      log_type: "measurement",
      data: {
        reading_type: "gravity",
        value: 12.5,
        unit: "plato",
        timestamp: "2026-08-11T12:00:00.000Z",
      },
    });
  });

  it("rejects a malformed payload without touching the database", async () => {
    const sb = makeSupabase({});
    fixture.supabase = sb.supabase;

    const response = await POST(
      request({ writeAction: "drop_all_tables", params: {} }),
    );

    expect(response.status).toBe(422);
    expect(sb.fromSpy).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range reading value before querying", async () => {
    const sb = makeSupabase({});
    fixture.supabase = sb.supabase;

    const response = await POST(request(readingBody({ value: 99 })));

    expect(response.status).toBe(422);
    expect(sb.fromSpy).not.toHaveBeenCalled();
  });

  it("refuses batches that are not in a reading-eligible state", async () => {
    const sb = makeSupabase({
      batches: [
        {
          data: { id: BATCH_ID, batch_code: "B-042", status: "completed" },
          error: null,
        },
      ],
    });
    fixture.supabase = sb.supabase;

    const response = await POST(request(readingBody()));

    expect(response.status).toBe(409);
    expect(sb.fromSpy).toHaveBeenCalledTimes(1);
  });

  it("maps an RLS denial on insert to a friendly FORBIDDEN", async () => {
    const sb = makeSupabase({
      batches: [
        {
          data: { id: BATCH_ID, batch_code: "B-042", status: "fermenting" },
          error: null,
        },
      ],
      batch_logs: [
        {
          data: null,
          error: { code: "42501", message: "row-level security violation" },
        },
      ],
    });
    fixture.supabase = sb.supabase;

    const response = await POST(request(readingBody()));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).not.toMatch(/row-level security/);
  });
});
