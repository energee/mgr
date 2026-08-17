/**
 * Confirm-gated chat writes added in Phase 4B: batch transition, packaging
 * session creation, batch creation.
 *
 * The 4C reading write is covered in `write-route.test.ts`; this file covers
 * the three writes 4B added and the properties that make them safe:
 *
 *   - the payload union is the trust boundary, so a shape that is not an
 *     explicit member is rejected before any query runs;
 *   - each write resolves its own permission rather than inheriting one;
 *   - a transition runs through `entityService.transition` (the atomic RPC
 *     that owns side effects), never a bare status UPDATE;
 *   - the pre-checks in the chat *tool* are advisory, so the route re-checks
 *     eligibility itself — the batch can move between propose and confirm.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeSupabase } from "@/test/supabase-mock";
import {
  CHAT_WRITE_PERMISSIONS,
  chatWriteRequestSchema,
} from "@/lib/schemas/chat-write";

const fixture = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: null as any,
  permissionChecks: [] as string[],
  transition: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  withAuth:
    (handler: (...args: never[]) => unknown) => async (request: NextRequest) =>
      handler(request as never, {
        user: { id: "brewer-1" },
        supabase: fixture.supabase,
      } as never),
  requirePermission: async (permission: string) => {
    fixture.permissionChecks.push(permission);
  },
}));

vi.mock("@/services/entity-service", () => ({
  entityService: {
    transition: (...args: unknown[]) => fixture.transition(...args),
  },
}));

import { POST } from "../write/route";

const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const RECIPE_ID = "22222222-2222-4222-8222-222222222222";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/chat/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  fixture.supabase = null;
  fixture.permissionChecks = [];
  fixture.transition = vi.fn();
});

describe("chat write payload union", () => {
  it("rejects a generic table/payload passthrough", () => {
    // The whole point of the union: a model cannot invent a write target.
    const parsed = chatWriteRequestSchema.safeParse({
      writeAction: "insert",
      params: { table: "orders", payload: { total: 0 } },
    });
    expect(parsed.success).toBe(false);
  });

  it("maps every write action to a permission", () => {
    const actions = chatWriteRequestSchema.options.map(
      (member) => member.shape.writeAction.value,
    );
    expect(actions.length).toBeGreaterThan(1);
    for (const action of actions) {
      expect(CHAT_WRITE_PERMISSIONS[action]).toBeTruthy();
    }
  });
});

describe("POST /api/chat/write — transition_batch", () => {
  it("transitions through entityService, not a bare status update", async () => {
    fixture.supabase = makeSupabase({
      batches: [
        {
          data: { id: BATCH_ID, batch_code: "B-042", status: "fermenting" },
          error: null,
        },
      ],
    }).supabase;
    fixture.transition.mockResolvedValue({ success: true, data: {} });

    const res = await POST(
      request({
        writeAction: "transition_batch",
        params: { batchId: BATCH_ID, toState: "conditioning" },
      }),
    );

    expect(res.status).toBe(200);
    expect(fixture.transition).toHaveBeenCalledTimes(1);
    expect(fixture.transition.mock.calls[0]?.[3]).toBe("conditioning");
    expect(fixture.permissionChecks).toEqual(["batches:write"]);
  });

  it("re-checks the state machine itself rather than trusting the proposal", async () => {
    // The batch was 'fermenting' when the tool proposed the move; by confirm
    // time it is 'completed', from which nothing is allowed.
    fixture.supabase = makeSupabase({
      batches: [
        {
          data: { id: BATCH_ID, batch_code: "B-042", status: "completed" },
          error: null,
        },
      ],
    }).supabase;

    const res = await POST(
      request({
        writeAction: "transition_batch",
        params: { batchId: BATCH_ID, toState: "conditioning" },
      }),
    );

    expect(res.status).toBe(409);
    expect(fixture.transition).not.toHaveBeenCalled();
  });

  it("refuses a state outside the chat-allowed set", async () => {
    // cancelled/archived require their own RPCs (vessel release, TTB loss),
    // so they are not members of CHAT_TRANSITION_STATES.
    const res = await POST(
      request({
        writeAction: "transition_batch",
        params: { batchId: BATCH_ID, toState: "cancelled" },
      }),
    );

    expect(res.status).toBe(422);
    expect(fixture.transition).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat/write — create_packaging_session", () => {
  it("inserts a planned session", async () => {
    fixture.supabase = makeSupabase({
      packaging_sessions: [
        { data: { id: "sess-1", session_date: "2026-08-13" }, error: null },
      ],
    }).supabase;

    const res = await POST(
      request({
        writeAction: "create_packaging_session",
        params: { sessionDate: "2026-08-13" },
      }),
    );

    expect(res.status).toBe(200);
    expect(fixture.permissionChecks).toEqual(["batches:write"]);
  });

  it("rejects a non-ISO session date before touching the database", async () => {
    fixture.supabase = null; // any query would throw

    const res = await POST(
      request({
        writeAction: "create_packaging_session",
        params: { sessionDate: "next Tuesday" },
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe("POST /api/chat/write — create_batch", () => {
  it("404s when the recipe does not exist", async () => {
    fixture.supabase = makeSupabase({
      recipes: [{ data: null, error: { message: "no rows" } }],
    }).supabase;

    const res = await POST(
      request({
        writeAction: "create_batch",
        params: { recipeId: RECIPE_ID, name: "Test IPA" },
      }),
    );

    expect(res.status).toBe(404);
  });

  it("rejects an empty batch name without querying", async () => {
    fixture.supabase = null;

    const res = await POST(
      request({
        writeAction: "create_batch",
        params: { recipeId: RECIPE_ID, name: "" },
      }),
    );

    expect(res.status).toBe(422);
  });

  it("pins status, omits batch_code, and drops model-supplied extras", async () => {
    const sb = makeSupabase({
      recipes: [{ data: { id: RECIPE_ID }, error: null }],
      batches: [{ data: { id: "batch-1", batch_code: "B-100" }, error: null }],
    });
    fixture.supabase = sb.supabase;

    const res = await POST(
      request({
        writeAction: "create_batch",
        params: {
          recipeId: RECIPE_ID,
          name: "Hazy IPA",
          // A model trying to grant itself fields it must not control. The zod
          // union strips unknown keys, so none of these can reach the insert.
          status: "completed",
          batch_code: "HAND-PICKED",
          id: "00000000-0000-4000-8000-00000000dead",
        },
      }),
    );

    expect(res.status).toBe(200);
    const insertArgs = sb.callsByTable.batches[0].insert.mock.calls[0][0];
    // batch_code is generated by trg_generate_batch_code (00155).
    expect(insertArgs).not.toHaveProperty("batch_code");
    expect(insertArgs).not.toHaveProperty("id");
    expect(insertArgs.status).toBe("planned");
    expect(insertArgs.recipe_id).toBe(RECIPE_ID);
  });

  it("pins the packaging session to planned and keeps notes from overriding it", async () => {
    const sb = makeSupabase({
      packaging_sessions: [
        { data: { id: "sess-1", session_date: "2026-08-13" }, error: null },
      ],
    });
    fixture.supabase = sb.supabase;

    await POST(
      request({
        writeAction: "create_packaging_session",
        params: { sessionDate: "2026-08-13", notes: "second shift" },
      }),
    );

    const insertArgs =
      sb.callsByTable.packaging_sessions[0].insert.mock.calls[0][0];
    expect(insertArgs.status).toBe("planned");
    expect(insertArgs.session_date).toBe("2026-08-13");
    expect(insertArgs.notes).toBe("second shift");
  });
});
