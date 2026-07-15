import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { dynamicRpc } from "@/services/types";

export const POST = withPermission(
  "orders:write",
  async (request, { supabase, params }) => {
    const orderId = params?.id;
    const requestId = params?.requestId;
    if (!orderId || !requestId) {
      return errorResponse(
        "BAD_REQUEST",
        "Missing order or request ID",
        undefined,
        400
      );
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

    const { error } = await dynamicRpc(
      supabase,
      "reject_order_change_request",
      {
        p_order_id: orderId,
        p_change_request_id: requestId,
        p_reason: reason.trim(),
      }
    );

    if (error) {
      if (error.code === "P0002") {
        return errorResponse("NOT_FOUND", error.message, error.details, 404);
      }
      if (error.code === "PT409") {
        return errorResponse("CONFLICT", error.message, error.details, 409);
      }
      return errorResponse("INTERNAL_ERROR", error.message, error.details, 500);
    }

    return successResponse({ rejected: true });
  }
);
