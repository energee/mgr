import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { dynamicRpc } from "@/services/types";

export const POST = withPermission(
  "orders:write",
  async (_request, { user, supabase, params }) => {
    const requestId = params?.requestId;
    if (!requestId) {
      return errorResponse("BAD_REQUEST", "Missing request ID", undefined, 400);
    }

    const { error } = await dynamicRpc(supabase, "apply_change_request", {
      p_change_request_id: requestId,
      p_approved_by: user.id,
    });

    if (error) {
      // Let withPermission/handleApiError translate the Postgres error code
      // and sanitize the response — error.message/details may contain raw
      // table/column names that should not leak to the client.
      throw error;
    }

    return successResponse({ approved: true });
  }
);
