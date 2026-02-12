import { withRoles } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";

export const POST = withRoles(
  ["admin", "sales"],
  async (_request, { user, supabase, params }) => {
    const requestId = params?.requestId;
    if (!requestId) {
      return errorResponse("BAD_REQUEST", "Missing request ID", undefined, 400);
    }

    const { error } = await supabase.rpc("apply_change_request", {
      p_change_request_id: requestId,
      p_approved_by: user.id,
    });

    if (error) {
      return errorResponse("INTERNAL_ERROR", error.message, error.details, 500);
    }

    return successResponse({ approved: true });
  }
);
