import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { dynamicRpc } from "@/services/types";

export const POST = withPermission(
  "orders:write",
  async (_request, { user, supabase, params }) => {
    const orderId = params?.id;
    const requestId = params?.requestId;
    if (!orderId || !requestId) {
      return errorResponse("BAD_REQUEST", "Missing order or request ID", undefined, 400);
    }

    const { error } = await dynamicRpc(supabase, "apply_change_request", {
      p_order_id: orderId,
      p_change_request_id: requestId,
      p_approved_by: user.id,
    });

    if (error) {
      if (error.code === "40001") {
        return errorResponse("CONFLICT", error.message, error.details ?? undefined, 409);
      }
      if (error.code === "P0002") {
        return errorResponse("NOT_FOUND", error.message, error.details ?? undefined, 404);
      }
      if (error.code === "42501") {
        return errorResponse("FORBIDDEN", error.message, error.details ?? undefined, 403);
      }
      if (error.code === "23514") {
        return errorResponse("VALIDATION_ERROR", error.message, error.details ?? undefined, 422);
      }
      return errorResponse("INTERNAL_ERROR", error.message, error.details ?? undefined, 500);
    }

    return successResponse({ approved: true });
  }
);
