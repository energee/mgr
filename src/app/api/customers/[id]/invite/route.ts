import { withRoles } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/server";

const PORTAL_REDIRECT_URL = `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/callback?redirect=/portal/orders`;

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

    // Check if customer already has a linked portal user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data: existingLink } = await db
      .from("customer_portal_users")
      .select("user_id")
      .eq("customer_id", customerId)
      .limit(1)
      .maybeSingle();

    const adminDb = await createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminAny = adminDb as any;

    // Already linked -- resend magic link
    if (existingLink?.user_id) {
      const { error } = await adminDb.auth.admin.generateLink({
        type: "magiclink",
        email: customer.email,
        options: { redirectTo: PORTAL_REDIRECT_URL },
      });
      if (error) {
        return errorResponse("INTERNAL_ERROR", error.message, undefined, 500);
      }
      return successResponse({ invited: true, email: customer.email });
    }

    // First invite -- create auth user
    const { data: inviteData, error } =
      await adminDb.auth.admin.inviteUserByEmail(customer.email, {
        redirectTo: PORTAL_REDIRECT_URL,
      });

    if (error) {
      const isExistingUser =
        error.message?.includes("already been registered") ||
        error.message?.includes("already exists");

      if (!isExistingUser) {
        return errorResponse("INTERNAL_ERROR", error.message, undefined, 500);
      }

      // User exists in auth but isn't linked to this customer --
      // generate a magic link (which also returns the user) and create the link
      const { data: linkData, error: linkErr } = await adminDb.auth.admin.generateLink({
        type: "magiclink",
        email: customer.email,
        options: { redirectTo: PORTAL_REDIRECT_URL },
      });
      if (linkErr) {
        return errorResponse("INTERNAL_ERROR", linkErr.message, undefined, 500);
      }

      if (linkData?.user) {
        await adminAny
          .from("customer_portal_users")
          .upsert({ customer_id: customerId, user_id: linkData.user.id });
      }
    } else if (inviteData?.user) {
      // Successful invite -- create the junction link
      await adminAny
        .from("customer_portal_users")
        .upsert({ customer_id: customerId, user_id: inviteData.user.id });
    }

    return successResponse({ invited: true, email: customer.email });
  }
);
