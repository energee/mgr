/**
 * Fenced user account deactivation/reactivation orchestration.
 *
 * PostgreSQL owns a durable per-user operation claim while this service crosses
 * the non-transactional Supabase Auth boundary. Deactivation closes RLS while
 * claiming; reactivation opens RLS only when the matching claim completes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { dynamicFrom, dynamicRpc } from "./types";

export const AUTH_BAN_DURATION = "876000h";

export type UserAccountStatusCommand = "deactivate" | "reactivate";
export type UserAccountStatus = "active" | "inactive" | "pending";

export type UserAccountStatusSuccess = {
  ok: true;
  status: "active" | "inactive";
};

export type UserAccountStatusFailureCode =
  | "NOT_FOUND"
  | "PROFILE_READ_FAILED"
  | "PROFILE_UPDATE_FAILED"
  | "COMMAND_IN_PROGRESS"
  | "AUTH_BAN_FAILED"
  | "AUTH_UNBAN_FAILED";

export type UserAccountStatusFailure = {
  ok: false;
  code: UserAccountStatusFailureCode;
  message: string;
  profileStatus: UserAccountStatus | null;
  retryable: boolean;
  compensation?: {
    attempted: true;
    succeeded: boolean;
    error?: string;
  };
};

export type UserAccountStatusResult =
  | UserAccountStatusSuccess
  | UserAccountStatusFailure;

type OperationClaim = {
  operation_id: string;
  profile_status: UserAccountStatus;
};

type RpcFailure = { code?: string; message: string };

type OperationState = {
  status: UserAccountStatus;
  account_status_operation_id: string | null;
  account_status_operation: UserAccountStatusCommand | null;
};

function firstRow<T>(data: T | T[] | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

async function beginOperation(
  adminDb: SupabaseClient<Database>,
  userId: string,
  command: UserAccountStatusCommand,
): Promise<
  | { ok: true; claim: OperationClaim }
  | { ok: false; failure: UserAccountStatusFailure }
> {
  const { data, error } = (await dynamicRpc(
    adminDb,
    "begin_user_account_status_operation",
    { p_user_id: userId, p_command: command },
  )) as { data: OperationClaim[] | null; error: RpcFailure | null };

  if (error?.code === "P0002") {
    return {
      ok: false,
      failure: {
        ok: false,
        code: "NOT_FOUND",
        message: "User profile not found",
        profileStatus: null,
        retryable: false,
      },
    };
  }
  if (error?.code === "55P03") {
    return {
      ok: false,
      failure: {
        ok: false,
        code: "COMMAND_IN_PROGRESS",
        message: "Another account status operation is already in progress",
        profileStatus: null,
        retryable: true,
      },
    };
  }
  const claim = firstRow(data);
  if (error || !claim) {
    const isConnectionFailure = error?.code?.startsWith("08") ?? false;
    return {
      ok: false,
      failure: {
        ok: false,
        code: isConnectionFailure
          ? "PROFILE_READ_FAILED"
          : "PROFILE_UPDATE_FAILED",
        message: `Unable to claim the user profile: ${error?.message ?? "No claim returned"}`,
        profileStatus: null,
        retryable: true,
      },
    };
  }
  return { ok: true, claim };
}

async function finishOperation(
  adminDb: SupabaseClient<Database>,
  userId: string,
  operationId: string,
): Promise<string | null> {
  const { error } = (await dynamicRpc(
    adminDb,
    "complete_user_account_status_operation",
    { p_user_id: userId, p_operation_id: operationId },
  )) as { error: RpcFailure | null };
  return error?.message ?? null;
}

async function abortOperation(
  adminDb: SupabaseClient<Database>,
  userId: string,
  operationId: string,
): Promise<string | null> {
  const { error } = (await dynamicRpc(
    adminDb,
    "abort_user_account_status_operation",
    { p_user_id: userId, p_operation_id: operationId },
  )) as { error: RpcFailure | null };
  return error?.message ?? null;
}

async function observeOperation(
  adminDb: SupabaseClient<Database>,
  userId: string,
): Promise<
  | { ok: true; state: OperationState }
  | { ok: false; error: string }
> {
  const { data, error } = (await dynamicFrom(adminDb, "user_profiles")
    .select(
      "status, account_status_operation_id, account_status_operation",
    )
    .eq("id", userId)
    .single()) as { data: OperationState | null; error: RpcFailure | null };
  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "Profile operation state was not returned",
    };
  }
  return { ok: true, state: data };
}

async function setAuthBan(
  adminDb: SupabaseClient<Database>,
  userId: string,
  banDuration: string,
): Promise<string | null> {
  const { error } = await adminDb.auth.admin.updateUserById(userId, {
    ban_duration: banDuration,
  });
  return error?.message ?? null;
}

function releaseSuffix(releaseError: string | null): string {
  return releaseError
    ? ` The database operation remains fenced: ${releaseError}`
    : "";
}

/** Execute one serialized account-status command. */
export async function changeUserAccountStatus(
  adminDb: SupabaseClient<Database>,
  userId: string,
  command: UserAccountStatusCommand,
): Promise<UserAccountStatusResult> {
  const started = await beginOperation(adminDb, userId, command);
  if (!started.ok) return started.failure;

  const { operation_id: operationId, profile_status: originalStatus } =
    started.claim;

  if (command === "deactivate") {
    // beginOperation has already persisted inactive, closing RLS for old JWTs.
    const banError = await setAuthBan(adminDb, userId, AUTH_BAN_DURATION);
    if (banError) {
      const releaseError = await abortOperation(adminDb, userId, operationId);
      return {
        ok: false,
        code: "AUTH_BAN_FAILED",
        message: `The profile is inactive, but the Auth ban failed: ${banError}.${releaseSuffix(releaseError)}`,
        profileStatus: "inactive",
        retryable: releaseError === null,
      };
    }

    const finishError = await finishOperation(adminDb, userId, operationId);
    if (finishError) {
      const observed = await observeOperation(adminDb, userId);
      if (
        observed.ok &&
        observed.state.status === "inactive" &&
        observed.state.account_status_operation_id !== operationId
      ) {
        // The completion committed but its HTTP response was lost. Both the DB
        // gate and Auth ban already agree; never turn that into a false error.
        return { ok: true, status: "inactive" };
      }
      const releaseError = await abortOperation(adminDb, userId, operationId);
      return {
        ok: false,
        code: "PROFILE_UPDATE_FAILED",
        message: `The profile is inactive and Auth is banned, but finalizing the operation failed: ${finishError}.${releaseSuffix(releaseError)}`,
        profileStatus: "inactive",
        retryable: releaseError === null,
      };
    }
    return { ok: true, status: "inactive" };
  }

  // The database profile stays non-active until this succeeds. For an already
  // active profile, this repairs a banned-Auth inconsistency idempotently.
  const unbanError = await setAuthBan(adminDb, userId, "none");
  if (unbanError) {
    const releaseError = await abortOperation(adminDb, userId, operationId);
    return {
      ok: false,
      code: "AUTH_UNBAN_FAILED",
      message: `Unable to unban the Auth user: ${unbanError}.${releaseSuffix(releaseError)}`,
      profileStatus: originalStatus,
      retryable: releaseError === null,
    };
  }

  const finishError = await finishOperation(adminDb, userId, operationId);
  if (!finishError) return { ok: true, status: "active" };

  const observed = await observeOperation(adminDb, userId);
  if (
    observed.ok &&
    observed.state.status === "active" &&
    observed.state.account_status_operation_id !== operationId
  ) {
    // Completion committed and only the response was lost. Re-banning here
    // would create active-profile/banned-Auth divergence and re-open old-JWT
    // RLS while reporting failure.
    return { ok: true, status: "active" };
  }

  if (!observed.ok) {
    // The database outcome is unknown. Do not guess by mutating Auth again:
    // either completion committed (active + unbanned), or it did not (the
    // non-active DB gate still blocks old JWTs and retains the fence).
    return {
      ok: false,
      code: "PROFILE_READ_FAILED",
      message: `Unable to determine whether reactivation committed after an ambiguous response: ${observed.error}`,
      profileStatus: null,
      retryable: false,
    };
  }

  if (originalStatus === "active") {
    // No database enable was needed; Auth and the profile already agree. Clear
    // the failed claim rather than introducing a new ban inconsistency.
    const releaseError = await abortOperation(adminDb, userId, operationId);
    if (!releaseError) return { ok: true, status: "active" };
    return {
      ok: false,
      code: "PROFILE_UPDATE_FAILED",
      message: `Auth is unbanned and the profile is active, but the operation fence could not be released: ${finishError}. ${releaseError}`,
      profileStatus: "active",
      retryable: false,
    };
  }

  // Enabling failed after Auth was unbanned. Re-ban before releasing the claim;
  // if re-ban itself fails, retain the fence so no opposite command can race.
  if (observed.state.account_status_operation_id !== operationId) {
    return {
      ok: false,
      code: "PROFILE_UPDATE_FAILED",
      message:
        "Reactivation did not produce an active profile, and the operation fence changed; Auth was left untouched to avoid overwriting a newer command",
      profileStatus: observed.state.status,
      retryable: false,
    };
  }

  const compensationError = await setAuthBan(
    adminDb,
    userId,
    AUTH_BAN_DURATION,
  );
  const releaseError = compensationError
    ? null
    : await abortOperation(adminDb, userId, operationId);
  return {
    ok: false,
    code: "PROFILE_UPDATE_FAILED",
    message: `Auth was unbanned, but enabling the profile failed: ${finishError}.${releaseSuffix(releaseError)}`,
    profileStatus: originalStatus,
    retryable: compensationError === null && releaseError === null,
    compensation: {
      attempted: true,
      succeeded: compensationError === null,
      ...(compensationError ? { error: compensationError } : {}),
    },
  };
}
