/**
 * API Auth Wrappers
 *
 * Authentication and authorization middleware for Next.js route handlers.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";
import {
  type UserRole,
  type Permission,
  hasPermission,
  getPermissions,
} from "@/lib/permissions";
import { dynamicFrom } from "@/services/types";
import { errorResponse } from "./response";
import { ApiError, handleApiError } from "./errors";

export type AuthContext = {
  user: User;
  supabase: SupabaseClient<Database>;
}

type AuthHandler = (
  request: NextRequest,
  context: AuthContext & { params?: Record<string, string> }
) => Promise<NextResponse>;

export type PermissionContext = AuthContext & {
  roles: UserRole[];
  permissions: Permission[];
}

/**
 * Enforce the database-backed account-status contract for a valid session.
 * A JWT may remain valid until expiry after deactivation, so missing,
 * pending, inactive, and unreadable profiles all fail closed here.
 */
export async function requireEnabledUser(context: AuthContext): Promise<void> {
  const { data: profile, error } = await dynamicFrom(
    context.supabase,
    "user_profiles",
  )
    .select("status")
    .eq("id", context.user.id)
    .single();

  if (error || profile?.status !== "active") {
    throw new ApiError("FORBIDDEN", "This account is not active", 403);
  }
}

type PermissionHandler = (
  request: NextRequest,
  context: PermissionContext & { params?: Record<string, string> }
) => Promise<NextResponse>;

/**
 * Resolve and enforce a permission for an already-authenticated request.
 *
 * Most routes should use `withPermission`. Manual redirect handlers such as
 * OAuth callbacks can call this helper to preserve their response semantics
 * while sharing the same fail-closed role lookup and permission map.
 */
export async function requirePermission(
  permission: Permission,
  context: AuthContext,
): Promise<PermissionContext> {
  const { user, supabase } = context;

  // Dynamic access: generated types may not include the `roles` column yet.
  // Include status because OAuth callbacks call this helper directly rather
  // than entering through withAuth first.
  const { data: profile, error } = await dynamicFrom(supabase, "user_profiles")
    .select("roles, status")
    .eq("id", user.id)
    .single();

  if (error || !profile || profile.status !== "active") {
    throw new ApiError("FORBIDDEN", "This account is not active", 403);
  }

  const roles = (profile.roles ?? []) as UserRole[];

  if (!hasPermission(roles, permission)) {
    throw new ApiError(
      "FORBIDDEN",
      `This action requires the ${permission} permission`,
      403,
    );
  }

  return {
    ...context,
    roles,
    permissions: getPermissions(roles),
  };
}

export function withAuth(handler: AuthHandler) {
  return async (
    request: NextRequest,
    routeContext?: { params?: Promise<Record<string, string>> }
  ): Promise<NextResponse> => {
    try {
      const supabase = await createClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        return errorResponse(
          "UNAUTHORIZED",
          "Authentication required",
          undefined,
          401
        );
      }

      // Auth bans prevent refresh and future sign-in, but already-issued JWTs
      // remain valid until expiry. Recheck the profile on every shared API
      // boundary so those old tokens cannot reach the handler.
      await requireEnabledUser({ user, supabase });

      const params = routeContext?.params
        ? await routeContext.params
        : undefined;

      return await handler(request, { user, supabase, params });
    } catch (err) {
      const apiError = handleApiError(err);
      return errorResponse(
        apiError.code,
        apiError.message,
        apiError.details,
        apiError.status
      );
    }
  };
}

export function withPermission(
  permission: Permission,
  handler: PermissionHandler,
) {
  return withAuth(async (request, context) => {
    return handler(request, await requirePermission(permission, context));
  });
}
