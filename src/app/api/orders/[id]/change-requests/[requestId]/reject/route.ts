import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { dynamicFrom } from "@/services/types";

export const POST = withPermission(
  "orders:write",
  async (request, { user, supabase, params }) => {
    const requestId = params?.requestId;
    if (!requestId) {
      return errorResponse("BAD_REQUEST", "Missing request ID", undefined, 400);
    }

    const body = await request.json();
    const reason = body.reason;
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return errorResponse(
        "BAD_REQUEST",
        "Rejection reason is required",
        undefined,
        400
      );
    }

    const { error } = await dynamicFrom(supabase, "order_change_requests")
      .update({
        status: "rejected",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason.trim(),
      })
      .eq("id", requestId)
      .eq("status", "pending");

    if (error) {
      // Let withPermission/handleApiError translate the Postgres error code
      // and sanitize the response — error.message/details may contain raw
      // table/column names that should not leak to the client.
      throw error;
    }

    return successResponse({ rejected: true });
  }
);
