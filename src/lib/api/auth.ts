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
import { errorResponse } from "./response";
import { ApiError, handleApiError } from "./errors";

export interface AuthContext {
  user: User;
  supabase: SupabaseClient<Database>;
}

export interface RoleContext extends AuthContext {
  role: string;
}

type AuthHandler = (
  request: NextRequest,
  context: AuthContext & { params?: Record<string, string> }
) => Promise<NextResponse>;

type RoleHandler = (
  request: NextRequest,
  context: RoleContext & { params?: Record<string, string> }
) => Promise<NextResponse>;

export interface PermissionContext extends AuthContext {
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

export function withRoles(roles: string[], handler: RoleHandler) {
  return withAuth(async (request, context) => {
    const { user, supabase } = context;

    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      throw new ApiError("FORBIDDEN", "Unable to determine user role", 403);
    }

    if (!roles.includes(profile.role)) {
      throw new ApiError(
        "FORBIDDEN",
        `This action requires one of the following roles: ${roles.join(", ")}`,
        403
      );
    }

    return handler(request, {
      ...context,
      role: profile.role,
    });
  });
}

export function withPermission(
  permission: Permission,
  handler: PermissionHandler,
) {
  return withAuth(async (request, context) => {
    const { user, supabase } = context;

    const { data: profile, error } = await supabase
      .from("user_profiles")
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

    const params = context.params;
    return handler(request, {
      user,
      supabase,
      roles,
      permissions: getPermissions(roles),
      params,
    });
  });
}
