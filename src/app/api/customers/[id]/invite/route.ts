import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { rateLimit, getClientIp } from "@/lib/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/env";
import { dynamicFrom } from "@/services/types";
import { shouldAssignCustomerRole } from "@/lib/permissions";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/customers/[id]/invite" });
const PORTAL_REDIRECT_URL = `${SITE_URL}/api/auth/callback?redirect=/portal/orders`;

/**
 * Ensure an invited portal user carries the `customer` role (audit C1).
 *
 * The `create_user_profile()` trigger assigns `customer` on email match, but
 * a profile can predate the customer record (or the match can miss when the
 * customer email was edited after signup) — so the invite path enforces the
 * role explicitly. Never downgrades staff: only a missing/empty profile or
 * the default `['viewer']` is replaced (see `shouldAssignCustomerRole`).
 *
 * Returns false when the role could not be verified/assigned — callers must
 * surface that as an error, since the invitee would otherwise sign in with
 * the staff `viewer` permission set (the exact C1 hole).
 */
async function ensureCustomerRole(
  adminDb: Awaited<ReturnType<typeof createAdminClient>>,
  userId: string,
): Promise<boolean> {
  const { data: profile, error: readErr } = await dynamicFrom(adminDb, "user_profiles")
    .select("roles")
    .eq("id", userId)
    .maybeSingle();
  if (readErr) {
    log.error({ userId, error: readErr.message }, "Failed to read profile for customer-role assignment");
    return false;
  }

  const roles = (profile?.roles ?? null) as string[] | null;
  if (!shouldAssignCustomerRole(roles)) {
    // Existing staff (or already-customer) profile — nothing to change.
    return true;
  }

  const { error: updateErr } = await dynamicFrom(adminDb, "user_profiles")
    .update({ roles: ["customer"] })
    .eq("id", userId);
  if (updateErr) {
    log.error({ userId, error: updateErr.message }, "Failed to assign customer role to invited portal user");
    return false;
  }
  return true;
}

/** Error returned when the invite email went out but role assignment failed. */
const ROLE_ASSIGNMENT_FAILED =
  "Invite email sent, but assigning the customer role failed. Re-run the invite before the user signs in.";

export const POST = withPermission(
  "customers:write",
  async (request, { supabase, params }) => {
    // Rate limit: 5 requests per minute per IP (stricter — sends emails)
    const ip = getClientIp(request);
    const limiter = rateLimit(`invite:${ip}`, { windowMs: 60_000, maxRequests: 5 });
    if (!limiter.success) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(limiter.resetMs / 1000)) },
        },
      );
    }

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
    const { data: existingLink } = await dynamicFrom(supabase, "customer_portal_users")
      .select("user_id")
      .eq("customer_id", customerId)
      .limit(1)
      .maybeSingle();

    const adminDb = await createAdminClient();

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
      // Repair pre-fix links whose profile was left on the 'viewer' default.
      if (!(await ensureCustomerRole(adminDb, existingLink.user_id as string))) {
        return errorResponse("INTERNAL_ERROR", ROLE_ASSIGNMENT_FAILED, undefined, 500);
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
        await dynamicFrom(adminDb, "customer_portal_users")
          .upsert({ customer_id: customerId, user_id: linkData.user.id });
        if (!(await ensureCustomerRole(adminDb, linkData.user.id))) {
          return errorResponse("INTERNAL_ERROR", ROLE_ASSIGNMENT_FAILED, undefined, 500);
        }
      }
    } else if (inviteData?.user) {
      // Successful invite -- create the junction link
      await dynamicFrom(adminDb, "customer_portal_users")
        .upsert({ customer_id: customerId, user_id: inviteData.user.id });
      if (!(await ensureCustomerRole(adminDb, inviteData.user.id))) {
        return errorResponse("INTERNAL_ERROR", ROLE_ASSIGNMENT_FAILED, undefined, 500);
      }
    }

    return successResponse({ invited: true, email: customer.email });
  }
);
