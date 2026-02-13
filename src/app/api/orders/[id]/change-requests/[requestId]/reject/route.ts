import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db
      .from("order_change_requests")
      .update({
        status: "rejected",
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason.trim(),
      })
      .eq("id", requestId)
      .eq("status", "pending");

    if (error) {
      return errorResponse("INTERNAL_ERROR", error.message, error.details, 500);
    }

    return successResponse({ rejected: true });
  }
);
