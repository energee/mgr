/**
 * DELETE /api/customers/[id]/portal-users/[userId]
 *
 * Revokes one customer link without deleting the auth user or any links that
 * user may hold to other customers.
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
    const { error } = await dynamicFrom(adminDb, "customer_portal_users")
      .delete()
      .eq("customer_id", customerId)
      .eq("user_id", userId);
    if (error) throw error;

    return successResponse({ revoked: true, customerId, userId });
  },
);
