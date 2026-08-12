/**
 * User Invite API Route
 *
 * POST /api/users/invite
 *
 * Invites a new user by email. Creates an auth.users entry via Supabase's
 * inviteUserByEmail (which sends a magic-link email), then updates the
 * auto-created user_profiles row with the requested roles and invitation
 * metadata. Fails with 500 if the role assignment doesn't apply, since the
 * invitee would otherwise sign in with default 'viewer' permissions.
 *
 * Requires the `users:manage` permission (admin only). Roles are restricted
 * to STAFF_ROLES; customer accounts are provisioned via the customer portal
 * invite flow. Rate limited to 5 invites/minute/IP (sends real emails).
 */

import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api/response";
import { withPermission } from "@/lib/api/auth";
import { validateBody } from "@/lib/api/validation";
import { ApiError } from "@/lib/api/errors";
import { rateLimit, getClientIp } from "@/lib/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/server";
import { escapeIlikePattern, unwrap } from "@/lib/supabase/query-helpers";
import { STAFF_ROLES } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { SITE_URL } from "@/lib/env";

const log = logger.child({ route: "/api/users/invite" });

// Restrict to STAFF_ROLES — invites are for internal team members.
// Customer accounts are provisioned through the customer portal flow.
const inviteSchema = z.object({
  email: z.string().email("A valid email address is required"),
  roles: z
    .array(z.enum(STAFF_ROLES))
    .min(1, "At least one role is required"),
  display_name: z.string().min(1).optional(),
});

type ProvisionedProfile = {
  id: string;
  roles: string[] | null;
  status: string | null;
};

function hasExpectedRoles(
  profile: ProvisionedProfile | null,
  userId: string,
  roles: readonly string[],
) {
  return Boolean(
    profile
      && profile.id === userId
      && profile.status === "pending"
      && Array.isArray(profile.roles)
      && profile.roles.length === roles.length
      && roles.every((role) => profile.roles?.includes(role)),
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error
    && typeof error === "object"
    && "message" in error
    && typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

export const POST = withPermission(
  "users:manage",
  async (request, { user }) => {
    // Rate limit: 5 invites per minute per IP — this endpoint sends real
    // emails via Supabase Auth, so we mirror the customer-invite limits.
    // Key is namespaced `user-invite:` so this endpoint doesn't share a
    // bucket with the customer-invite route (which uses `invite:`).
    const ip = getClientIp(request);
    const rl = rateLimit(`user-invite:${ip}`, {
      windowMs: 60_000,
      maxRequests: 5,
    });
    if (!rl.success) {
      return errorResponse(
        "RATE_LIMITED",
        "Too many invite requests. Please try again later.",
        { retryAfterMs: rl.resetMs },
        429,
      );
    }

    const { email, roles, display_name } = await validateBody(
      inviteSchema,
      request,
    );

    log.info({ invitedBy: user.id, email, roles }, "User invite attempted");

    const adminDb = await createAdminClient();

    // Check if a user_profiles row already exists for this email.
    // Case-insensitive (audit DL-6 sweep): profile emails mirror auth.users,
    // which Supabase stores lowercased, so an exact .eq() misses a mixed-case
    // duplicate and defers the failure to inviteUserByEmail's opaque
    // "already registered" branch below.
    const { data: existingProfile } = await adminDb
      .from("user_profiles")
      .select("id, email, status")
      .ilike("email", escapeIlikePattern(email))
      .limit(1)
      .maybeSingle();

    if (existingProfile) {
      throw new ApiError(
        "CONFLICT",
        `A user with email "${email}" already exists`,
      );
    }

    // Invite via Supabase Auth — sends a magic-link email and creates
    // an auth.users entry. The create_user_profile() trigger auto-creates
    // a user_profiles row with default roles.
    const { data: inviteData, error: inviteError } =
      await adminDb.auth.admin.inviteUserByEmail(email, {
        data: {
          display_name: display_name ?? undefined,
        },
        redirectTo: `${SITE_URL}/api/auth/callback`,
      });

    if (inviteError) {
      // If the user already exists in auth but we didn't find a profile,
      // the trigger should have created one — treat as a conflict.
      const isExistingUser =
        inviteError.message?.includes("already been registered") ||
        inviteError.message?.includes("already exists");

      if (isExistingUser) {
        throw new ApiError(
          "CONFLICT",
          "This email is already registered. Check the user list.",
        );
      }

      throw new ApiError(
        "INTERNAL_ERROR",
        `Failed to send invitation: ${inviteError.message}`,
        500,
      );
    }

    const userId = inviteData?.user?.id;
    if (!userId) {
      throw new ApiError(
        "INTERNAL_ERROR",
        "Invitation sent but no user ID returned",
        500,
      );
    }

    // Update the auto-created profile with the requested roles,
    // invitation metadata, and pending status.
    let provisioningError: string | null = null;
    try {
      const updatedProfile = await unwrap(
        adminDb
          .from("user_profiles")
          .update({
            roles,
            status: "pending",
            display_name: display_name ?? email.split("@")[0],
            invited_at: new Date().toISOString(),
            invited_by: user.id,
          })
          .eq("id", userId)
          .select("id, roles, status")
          .single(),
      );
      if (!hasExpectedRoles(updatedProfile, userId, roles)) {
        provisioningError = "Profile verification failed after assigning roles";
      }
    } catch (error) {
      provisioningError = errorMessage(error);
    }

    if (provisioningError) {
      // The auth user was created with default roles=['viewer'] and
      // status='active' by the create_user_profile trigger. If we don't
      // surface this failure, the invitee will sign in with the wrong
      // permissions and the caller has no signal that the requested roles
      // were not applied. Fail loudly so the operator can retry or repair
      // the profile manually before the invitee signs in.
      log.error(
        { error: provisioningError },
        "User invited but profile update failed",
      );
      const { error: deleteError } =
        await adminDb.auth.admin.deleteUser(userId);
      if (deleteError) {
        log.error(
          {
            profileError: provisioningError,
            compensationError: deleteError.message,
          },
          "User invite compensation failed",
        );
        throw new ApiError(
          "INTERNAL_ERROR",
          `Assigning roles failed (${provisioningError}), and removing the incomplete account also failed (${deleteError.message}). Repair the account before retrying.`,
          500,
        );
      }
      throw new ApiError(
        "INTERNAL_ERROR",
        `Assigning roles failed: ${provisioningError}. The incomplete account was removed; retry the invitation.`,
        500,
      );
    }

    log.info({ invitedBy: user.id, userId, email, roles }, "User invite completed");

    return successResponse(
      { id: userId, email, roles },
      undefined,
      201,
    );
  },
);
