/**
 * DELETE /api/customers/[id]/portal-users/[userId]
 *
 * Revokes one customer link without deleting the auth user or any links that
 * user may hold to other customers.
 *
 * Revocation stamps `revoked_at` instead of deleting the row (migration
 * 00276). A hard delete was silently undone: the portal layout's service-role
 * auto-link reads "no row" as "first login" and re-created the link on the
 * revoked user's next page load whenever their auth email matched
 * customers.email (issue #605). The tombstone is what tells the two apart, and
 * the RLS predicates skip stamped rows, so access ends at the database too.
 */
import { withPermission } from "@/lib/api/auth";
import { successResponse } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/server";
import { dynamicFrom } from "@/services/types";

export const DELETE = withPermission(
  "customers:write",
  async (_request, { params }) => {
    const customerId = params?.id;
    const userId = params?.userId;
    if (!customerId || !userId) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Missing customer or portal user ID",
        400,
      );
    }

    const adminDb = await createAdminClient();
    // Idempotent: `revoked_at IS NULL` means a repeat revoke matches no row
    // and leaves the original revocation timestamp intact.
    const { error } = await dynamicFrom(adminDb, "customer_portal_users")
      .update({ revoked_at: new Date().toISOString() })
      .eq("customer_id", customerId)
      .eq("user_id", userId)
      .is("revoked_at", null);
    if (error) throw error;

    return successResponse({ revoked: true, customerId, userId });
  },
);
