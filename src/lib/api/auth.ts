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

type PermissionHandler = (
  request: NextRequest,
  context: PermissionContext & { params?: Record<string, string> }
) => Promise<NextResponse>;

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
    const { user, supabase } = context;

    // Dynamic access: generated types may not include the `roles` column yet
    const { data: profile, error } = await dynamicFrom(supabase, "user_profiles")
      .select("roles")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      throw new ApiError("FORBIDDEN", "Unable to determine user roles", 403);
    }

    const roles = (profile.roles ?? []) as UserRole[];

    if (!hasPermission(roles, permission)) {
      throw new ApiError(
        "FORBIDDEN",
        `This action requires the ${permission} permission`,
        403,
      );
    }

    return handler(request, {
      ...context,
      roles,
      permissions: getPermissions(roles),
    });
  });
}
