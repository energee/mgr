import {
  withRoles,
  successResponse,
  ApiError,
} from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * DELETE /api/users/:id
 *
 * Deletes a user profile and their auth.users entry.
 * Requires admin role. Only allows deleting inactive users.
 */
export const DELETE = withRoles(["admin"], async (_request, { user, params }) => {
  const id = params?.id;
  if (!id) throw new ApiError("VALIDATION_ERROR", "User ID required");

  // Prevent self-deletion
  if (user.id === id) {
    throw new ApiError("VALIDATION_ERROR", "Cannot delete your own account");
  }

  const adminDb = await createAdminClient();

  // Verify target user is inactive
  const { data: target, error: lookupError } = await adminDb
    .from("user_profiles")
    .select("status")
    .eq("id", id)
    .single();

  if (lookupError || !target) {
    throw new ApiError("NOT_FOUND", "User not found");
  }

  if (target.status !== "inactive") {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Only inactive users can be deleted. Deactivate the user first."
    );
  }

  // Delete user_profiles row
  const { error: profileError } = await adminDb
    .from("user_profiles")
    .delete()
    .eq("id", id);

  if (profileError) throw profileError;

  // Delete auth.users entry
  const { error: authError } = await adminDb.auth.admin.deleteUser(id);

  if (authError) {
    // Profile already removed — log but don't fail
    console.error("Failed to delete auth user (profile already removed):", authError);
  }

  return successResponse({ deleted: true });
});
