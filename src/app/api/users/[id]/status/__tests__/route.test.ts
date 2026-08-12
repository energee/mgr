/** User account-status command route response regressions (issue #441). */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createAdminClient = vi.hoisted(() => vi.fn());
const changeUserAccountStatus = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createAdminClient }));
vi.mock("@/services/user-account-status", () => ({ changeUserAccountStatus }));
vi.mock("@/lib/api/auth", async () => {
  const { ApiError } = await import("@/lib/api/errors");
  const { errorResponse } = await import("@/lib/api/response");
  return {
    withPermission:
      (_permission: string, handler: (...args: never[]) => unknown) =>
      async (request: NextRequest, context?: { params?: Promise<Record<string, string>> }) => {
        try {
          return await handler(request as never, {
            user: { id: "admin-1" },
            params: context?.params ? await context.params : undefined,
          } as never);
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          return errorResponse(
            error.code,
            error.message,
            error.details,
            error.status,
          );
        }
      },
  };
});

import { POST } from "../route";

function request(command: "deactivate" | "reactivate") {
  return new NextRequest("http://localhost/api/users/target-1/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClient.mockResolvedValue({ marker: "admin" });
});

describe("POST /api/users/:id/status", () => {
  it("returns the durable command result", async () => {
    changeUserAccountStatus.mockResolvedValue({ ok: true, status: "inactive" });

    const response = await POST(request("deactivate"), {
      params: Promise.resolve({ id: "target-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { ok: true, status: "inactive" },
    });
    expect(changeUserAccountStatus).toHaveBeenCalledWith(
      { marker: "admin" },
      "target-1",
      "deactivate",
    );
  });

  it("returns non-2xx structured details for a retryable partial failure", async () => {
    const failure = {
      ok: false,
      code: "AUTH_BAN_FAILED",
      message: "The profile is inactive, but the Auth ban failed",
      profileStatus: "inactive",
      retryable: true,
    };
    changeUserAccountStatus.mockResolvedValue(failure);

    const response = await POST(request("deactivate"), {
      params: Promise.resolve({ id: "target-1" }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: failure.message,
        details: failure,
      },
    });
  });

  it("returns 404 without invoking a different operation for a missing profile", async () => {
    changeUserAccountStatus.mockResolvedValue({
      ok: false,
      code: "NOT_FOUND",
      message: "User profile not found",
      profileStatus: null,
      retryable: false,
    });

    const response = await POST(request("reactivate"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
  });

  it("blocks self-deactivation before creating an admin client", async () => {
    const response = await POST(request("deactivate"), {
      params: Promise.resolve({ id: "admin-1" }),
    });

    expect(response.status).toBe(422);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(changeUserAccountStatus).not.toHaveBeenCalled();
  });

  it("returns 409 while another status operation owns the user fence", async () => {
    changeUserAccountStatus.mockResolvedValue({
      ok: false,
      code: "COMMAND_IN_PROGRESS",
      message: "Another account status operation is already in progress",
      profileStatus: null,
      retryable: true,
    });

    const response = await POST(request("reactivate"), {
      params: Promise.resolve({ id: "target-1" }),
    });

    expect(response.status).toBe(409);
  });
});
