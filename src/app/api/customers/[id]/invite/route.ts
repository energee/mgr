import { withRoles } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";

export const POST = withRoles(
  ["admin", "sales"],
  async (_request, { supabase, params }) => {
    const customerId = params?.id;
    if (!customerId) {
      return errorResponse("BAD_REQUEST", "Missing customer ID", undefined, 400);
    }

    // Get customer email
    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .select("email, name")
      .eq("id", customerId)
      .single();

    if (custErr || !customer) {
      return errorResponse("NOT_FOUND", "Customer not found", undefined, 404);
    }
    if (!customer.email) {
      return errorResponse(
        "BAD_REQUEST",
        "Customer has no email address",
        undefined,
        400
      );
    }

    // Check if customer already has a user_id (already linked)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data: custWithUser } = await db
      .from("customers")
      .select("user_id")
      .eq("id", customerId)
      .single();

    const adminDb = await createAdminClient();

    if (custWithUser?.user_id) {
      // Already linked — resend magic link
      const { error } = await adminDb.auth.admin.generateLink({
        type: "magiclink",
        email: customer.email,
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/callback?redirect=/portal/orders`,
        },
      });
      if (error) {
        return errorResponse(
          "INTERNAL_ERROR",
          error.message,
          undefined,
          500
        );
      }
    } else {
      // First invite — create auth user
      const { error } = await adminDb.auth.admin.inviteUserByEmail(
        customer.email,
        {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/callback?redirect=/portal/orders`,
        }
      );
      if (error) {
        // If user already exists in auth but isn't linked to customer, just generate a magic link
        if (
          error.message?.includes("already been registered") ||
          error.message?.includes("already exists")
        ) {
          const { error: linkErr } = await adminDb.auth.admin.generateLink({
            type: "magiclink",
            email: customer.email,
            options: {
              redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/callback?redirect=/portal/orders`,
            },
          });
          if (linkErr) {
            return errorResponse(
              "INTERNAL_ERROR",
              linkErr.message,
              undefined,
              500
            );
          }
        } else {
          return errorResponse(
            "INTERNAL_ERROR",
            error.message,
            undefined,
            500
          );
        }
      }
    }

    return successResponse({ invited: true, email: customer.email });
  }
);
