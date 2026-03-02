/**
 * User Invite API Route
 *
 * POST /api/users/invite
 *
 * Invites a new user by email. Creates an auth.users entry via Supabase's
 * inviteUserByEmail (which sends a magic-link email), then updates the
 * auto-created user_profiles row with the requested roles and invitation
 * metadata.
 *
 * Requires the `users:manage` permission (admin only).
 */

import { z } from "zod";
import {
  withPermission,
  validateBody,
  successResponse,
  ApiError,
} from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/server";
import { ALL_ROLES } from "@/lib/permissions";

const inviteSchema = z.object({
  email: z.string().email("A valid email address is required"),
  roles: z
    .array(z.enum(ALL_ROLES))
    .min(1, "At least one role is required"),
  display_name: z.string().min(1).optional(),
});

export const POST = withPermission(
  "users:manage",
  async (request, { user }) => {
    const { email, roles, display_name } = await validateBody(
      inviteSchema,
      request,
    );

    const adminDb = createAdminClient();

    // Check if a user_profiles row already exists for this email
    const { data: existingProfile } = await adminDb
      .from("user_profiles")
      .select("id, email, status")
      .eq("email", email)
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
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/callback`,
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
    const { error: updateError } = await adminDb
      .from("user_profiles")
      .update({
        roles,
        status: "pending",
        display_name: display_name ?? email.split("@")[0],
        invited_at: new Date().toISOString(),
        invited_by: user.id,
      })
      .eq("id", userId);

    if (updateError) {
      console.error(
        "User invited but profile update failed:",
        updateError,
      );
      // Don't throw — the invite was sent successfully.
      // The profile can be updated manually from the user detail page.
    }

    return successResponse(
      { id: userId, email, roles },
      undefined,
      201,
    );
  },
);
