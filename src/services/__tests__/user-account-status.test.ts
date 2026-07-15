/**
 * Durable user deactivation/reactivation command regressions (issue #441).
 *
 * The fake records durable profile writes and Auth admin calls in one event
 * stream so ordering and compensation are tested, not merely final values.
 */

import { describe, expect, it, vi } from "vitest";
import {
  AUTH_BAN_DURATION,
  changeUserAccountStatus,
} from "../user-account-status";

type Event =
  | { type: "profile"; status: "active" | "inactive" }
  | { type: "auth"; banDuration: string };

type FakeOptions = {
  status?: "active" | "inactive" | "pending" | null;
  readError?: string;
  updateErrors?: string[];
  authErrors?: Array<string | null>;
  operationInProgress?: boolean;
  finishResponseLost?: boolean;
  observeError?: string;
};

function makeAdmin(options: FakeOptions = {}) {
  let status = options.status === undefined ? "active" : options.status;
  let operation:
    | { id: string; command: "deactivate" | "reactivate" }
    | null = options.operationInProgress
      ? { id: "existing-operation", command: "deactivate" }
      : null;
  const events: Event[] = [];
  const updateErrors = [...(options.updateErrors ?? [])];
  const authErrors = [...(options.authErrors ?? [])];
  let operationSequence = 0;

  const rpc = vi.fn(
    async (
      name: string,
      args: {
        p_command?: "deactivate" | "reactivate";
        p_operation_id?: string;
      },
    ) => {
      if (name === "begin_user_account_status_operation") {
        if (options.readError) {
          return {
            data: null,
            error: { code: "08006", message: options.readError },
          };
        }
        if (status === null) {
          return {
            data: null,
            error: { code: "P0002", message: "not found" },
          };
        }
        if (operation) {
          return {
            data: null,
            error: { code: "55P03", message: "operation in progress" },
          };
        }
        const command = args.p_command as "deactivate" | "reactivate";
        if (command === "deactivate") {
          const message = updateErrors.shift();
          if (message) return { data: null, error: { message } };
        }
        const originalStatus = status;
        operationSequence += 1;
        operation = { id: `operation-${operationSequence}`, command };
        if (command === "deactivate" && status !== "inactive") {
          status = "inactive";
          events.push({ type: "profile", status: "inactive" });
        }
        return {
          data: [
            {
              operation_id: operation.id,
              profile_status: originalStatus,
            },
          ],
          error: null,
        };
      }

      if (name === "complete_user_account_status_operation") {
        if (!operation || operation.id !== args.p_operation_id) {
          return {
            data: null,
            error: { code: "55P03", message: "stale operation" },
          };
        }
        if (operation.command === "reactivate") {
          const message = updateErrors.shift();
          if (message) return { data: null, error: { message } };
          if (status !== "active") {
            status = "active";
            events.push({ type: "profile", status: "active" });
          }
        }
        operation = null;
        if (options.finishResponseLost) {
          return {
            data: null,
            error: { message: "network response lost after commit" },
          };
        }
        return { data: status, error: null };
      }

      if (name === "abort_user_account_status_operation") {
        if (!operation || operation.id !== args.p_operation_id) {
          return {
            data: null,
            error: { code: "55P03", message: "stale operation" },
          };
        }
        operation = null;
        return { data: status, error: null };
      }

      throw new Error(`Unexpected RPC: ${name}`);
    },
  );

  const from = vi.fn(() => {
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(async () =>
        options.observeError
          ? { data: null, error: { message: options.observeError } }
          : {
              data:
                status === null
                  ? null
                  : {
                      status,
                      account_status_operation_id: operation?.id ?? null,
                      account_status_operation: operation?.command ?? null,
                    },
              error: null,
            },
      ),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    return builder;
  });

  const updateUserById = vi.fn(async (_id: string, attrs: { ban_duration: string }) => {
    events.push({ type: "auth", banDuration: attrs.ban_duration });
    const message = authErrors.shift();
    return { data: {}, error: message ? { message } : null };
  });

  return {
    admin: { rpc, from, auth: { admin: { updateUserById } } },
    events,
    status: () => status,
    operation: () => operation,
    updateUserById,
  };
}

describe("changeUserAccountStatus — deactivate", () => {
  it("disables the database profile before banning Auth", async () => {
    const fake = makeAdmin({ status: "active" });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "deactivate",
    );

    expect(result).toMatchObject({ ok: true, status: "inactive" });
    expect(fake.status()).toBe("inactive");
    expect(fake.events).toEqual([
      { type: "profile", status: "inactive" },
      { type: "auth", banDuration: AUTH_BAN_DURATION },
    ]);
  });

  it("uses the same safe ordering when declining a pending account", async () => {
    const fake = makeAdmin({ status: "pending" });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "deactivate",
    );

    expect(result).toMatchObject({ ok: true, status: "inactive" });
    expect(fake.events).toEqual([
      { type: "profile", status: "inactive" },
      { type: "auth", banDuration: AUTH_BAN_DURATION },
    ]);
  });

  it("retries the Auth ban when the profile is already inactive", async () => {
    const fake = makeAdmin({ status: "inactive" });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "deactivate",
    );

    expect(result).toMatchObject({ ok: true, status: "inactive" });
    expect(fake.events).toEqual([
      { type: "auth", banDuration: AUTH_BAN_DURATION },
    ]);
  });

  it("does not touch Auth when the database disable fails", async () => {
    const fake = makeAdmin({ status: "active", updateErrors: ["write failed"] });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "deactivate",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "PROFILE_UPDATE_FAILED",
      profileStatus: null,
      retryable: true,
    });
    expect(fake.updateUserById).not.toHaveBeenCalled();
  });

  it("leaves the profile safely inactive and reports a retryable ban failure", async () => {
    const fake = makeAdmin({ status: "active", authErrors: ["auth unavailable"] });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "deactivate",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "AUTH_BAN_FAILED",
      profileStatus: "inactive",
      retryable: true,
    });
    expect(fake.status()).toBe("inactive");
  });

  it("recognizes a committed deactivation when only the completion response is lost", async () => {
    const fake = makeAdmin({
      status: "active",
      finishResponseLost: true,
    });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "deactivate",
    );

    expect(result).toMatchObject({ ok: true, status: "inactive" });
    expect(fake.status()).toBe("inactive");
    expect(fake.updateUserById).toHaveBeenCalledTimes(1);
  });
});

describe("changeUserAccountStatus — reactivate", () => {
  it("idempotently confirms Auth is unbanned when the profile is already active", async () => {
    const fake = makeAdmin({ status: "active" });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "reactivate",
    );

    expect(result).toMatchObject({ ok: true, status: "active" });
    expect(fake.events).toEqual([{ type: "auth", banDuration: "none" }]);
  });

  it("does not claim an already-active account is restored when Auth cannot be confirmed", async () => {
    const fake = makeAdmin({ status: "active", authErrors: ["unban failed"] });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "reactivate",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "AUTH_UNBAN_FAILED",
      profileStatus: "active",
      retryable: true,
    });
  });

  it("unbans Auth before enabling the database profile", async () => {
    const fake = makeAdmin({ status: "inactive" });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "reactivate",
    );

    expect(result).toMatchObject({ ok: true, status: "active" });
    expect(fake.events).toEqual([
      { type: "auth", banDuration: "none" },
      { type: "profile", status: "active" },
    ]);
  });

  it("unbans Auth before approving a pending account", async () => {
    const fake = makeAdmin({ status: "pending" });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "reactivate",
    );

    expect(result).toMatchObject({ ok: true, status: "active" });
    expect(fake.events).toEqual([
      { type: "auth", banDuration: "none" },
      { type: "profile", status: "active" },
    ]);
  });

  it("does not enable the profile when Auth unban fails", async () => {
    const fake = makeAdmin({ status: "inactive", authErrors: ["unban failed"] });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "reactivate",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "AUTH_UNBAN_FAILED",
      profileStatus: "inactive",
      retryable: true,
    });
    expect(fake.status()).toBe("inactive");
    expect(fake.events).toEqual([{ type: "auth", banDuration: "none" }]);
  });

  it("re-bans Auth when enabling the profile fails", async () => {
    const fake = makeAdmin({
      status: "inactive",
      updateErrors: ["enable failed"],
      authErrors: [null, null],
    });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "reactivate",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "PROFILE_UPDATE_FAILED",
      profileStatus: "inactive",
      retryable: true,
      compensation: { attempted: true, succeeded: true },
    });
    expect(fake.events).toEqual([
      { type: "auth", banDuration: "none" },
      { type: "auth", banDuration: AUTH_BAN_DURATION },
    ]);
  });

  it("truthfully reports a failed re-ban while the DB gate remains inactive", async () => {
    const fake = makeAdmin({
      status: "inactive",
      updateErrors: ["enable failed"],
      authErrors: [null, "re-ban failed"],
    });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "reactivate",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "PROFILE_UPDATE_FAILED",
      profileStatus: "inactive",
      compensation: {
        attempted: true,
        succeeded: false,
        error: "re-ban failed",
      },
    });
    expect(fake.status()).toBe("inactive");
  });

  it("does not re-ban after reactivation committed but its response was lost", async () => {
    const fake = makeAdmin({
      status: "inactive",
      finishResponseLost: true,
    });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "reactivate",
    );

    expect(result).toMatchObject({ ok: true, status: "active" });
    expect(fake.status()).toBe("active");
    expect(fake.events).toEqual([
      { type: "auth", banDuration: "none" },
      { type: "profile", status: "active" },
    ]);
    expect(fake.updateUserById).toHaveBeenCalledTimes(1);
  });

  it("does not guess with another Auth write when completion state is unreadable", async () => {
    const fake = makeAdmin({
      status: "inactive",
      finishResponseLost: true,
      observeError: "database unavailable",
    });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "reactivate",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "PROFILE_READ_FAILED",
      retryable: false,
    });
    expect(fake.updateUserById).toHaveBeenCalledTimes(1);
    expect(fake.events).toEqual([
      { type: "auth", banDuration: "none" },
      { type: "profile", status: "active" },
    ]);
  });
});

describe("changeUserAccountStatus — lookup failures", () => {
  it("rejects a concurrent opposite command before touching Auth", async () => {
    const fake = makeAdmin({
      status: "inactive",
      operationInProgress: true,
    });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "reactivate",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "COMMAND_IN_PROGRESS",
      retryable: true,
    });
    expect(fake.updateUserById).not.toHaveBeenCalled();
    expect(fake.operation()).toEqual({
      id: "existing-operation",
      command: "deactivate",
    });
  });

  it("does not mutate either system for a missing profile", async () => {
    const fake = makeAdmin({ status: null });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "deactivate",
    );

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND", retryable: false });
    expect(fake.events).toEqual([]);
  });

  it("does not mutate either system when the profile read fails", async () => {
    const fake = makeAdmin({ readError: "database unavailable" });

    const result = await changeUserAccountStatus(
      fake.admin as never,
      "target-1",
      "deactivate",
    );

    expect(result).toMatchObject({
      ok: false,
      code: "PROFILE_READ_FAILED",
      retryable: true,
    });
    expect(fake.events).toEqual([]);
  });
});
