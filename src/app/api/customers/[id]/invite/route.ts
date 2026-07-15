/**
 * POST /api/customers/[id]/invite
 *
 * Provisions or reuses a customer-portal auth user, links that user to the
 * requested customer, and sends an actual invite/OTP email. The target email
 * may differ from the customer's primary email so one customer can have
 * multiple independently authenticated contacts.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withPermission } from "@/lib/api/auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { rateLimit, getClientIp } from "@/lib/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/server";
import { escapeIlikePattern } from "@/lib/supabase/query-helpers";
import { SITE_URL } from "@/lib/env";
import { dynamicFrom } from "@/services/types";
import {
  isPortalUser,
  shouldAssignCustomerRole,
  type UserRole,
} from "@/lib/permissions";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/customers/[id]/invite" });
const PORTAL_REDIRECT_URL = `${SITE_URL}/portal/orders`;

const inviteSchema = z.object({
  email: z.string().trim().email().optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
});

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

type PortalProfile = {
  id: string;
  email: string | null;
  roles: UserRole[] | null;
  status?: string | null;
};

type BreweryNameSetting = {
  value: unknown;
};

async function readInviteBody(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid invite details",
      422,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

async function findProfileByEmail(
  adminDb: AdminClient,
  email: string,
): Promise<PortalProfile | null> {
  const { data, error } = await dynamicFrom(adminDb, "user_profiles")
    .select("id, email, roles, status")
    .ilike("email", escapeIlikePattern(email))
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as PortalProfile | null) ?? null;
}

/**
 * Ensure portal-only authorization without ever clobbering a staff account.
 * Auth triggers normally create the profile first; the upsert is a recovery
 * path for an auth user whose profile trigger previously failed.
 */
async function ensureCustomerProfile(
  adminDb: AdminClient,
  input: {
    userId: string;
    email: string;
    displayName?: string;
    invitedBy: string;
  },
) {
  const { data, error } = await dynamicFrom(adminDb, "user_profiles")
    .select("id, email, roles, status")
    .eq("id", input.userId)
    .maybeSingle();
  if (error) throw error;

  const profile = data as PortalProfile | null;
  const roles = profile?.roles ?? null;
  if (roles && isPortalUser(roles)) {
    if (profile?.status === "inactive") {
      const { error: activateError } = await dynamicFrom(adminDb, "user_profiles")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", input.userId);
      if (activateError) throw activateError;
    }
    return;
  }

  if (!shouldAssignCustomerRole(roles)) {
    throw new ApiError(
      "CONFLICT",
      "That email belongs to a staff account and cannot be linked as a customer portal user.",
      409,
    );
  }

  const now = new Date().toISOString();
  const profileValues = {
    id: input.userId,
    email: input.email,
    display_name: input.displayName ?? input.email.split("@")[0],
    roles: ["customer"],
    status: "active",
    invited_at: now,
    invited_by: input.invitedBy,
    updated_at: now,
  };

  const { error: writeError } = profile
    ? await dynamicFrom(adminDb, "user_profiles")
        .update(profileValues)
        .eq("id", input.userId)
    : await dynamicFrom(adminDb, "user_profiles").upsert(profileValues);
  if (writeError) throw writeError;
}

async function linkPortalUser(
  adminDb: AdminClient,
  customerId: string,
  userId: string,
) {
  const { error } = await dynamicFrom(adminDb, "customer_portal_users").upsert(
    { customer_id: customerId, user_id: userId },
    { onConflict: "customer_id,user_id" },
  );
  if (error) throw error;
}

async function readBreweryName(adminDb: AdminClient): Promise<string> {
  const { data, error } = await dynamicFrom(adminDb, "system_settings")
    .select("value")
    .eq("key", "brewery_name")
    .maybeSingle();
  if (error) throw error;

  const value = (data as BreweryNameSetting | null)?.value;
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "Your brewery";
}

function portalEmailMetadata(breweryName: string) {
  return {
    brewery_name: breweryName,
    portal_access: true,
  };
}

async function updatePortalEmailMetadata(
  adminDb: AdminClient,
  userId: string,
  breweryName: string,
) {
  const { error } = await adminDb.auth.admin.updateUserById(userId, {
    user_metadata: portalEmailMetadata(breweryName),
  });
  if (error) {
    throw new ApiError(
      "INTERNAL_ERROR",
      `Failed to prepare the portal email: ${error.message}`,
      500,
    );
  }
}

async function sendOtp(adminDb: AdminClient, email: string) {
  const { error } = await adminDb.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: PORTAL_REDIRECT_URL,
    },
  });
  if (error) {
    throw new ApiError(
      "INTERNAL_ERROR",
      `Failed to send portal login email: ${error.message}`,
      500,
    );
  }
}

function isExistingAuthUserError(
  error: { code?: string; message?: string } | null,
) {
  return (
    error?.code === "email_exists" ||
    error?.code === "user_already_exists" ||
    error?.message?.includes("already been registered") ||
    error?.message?.includes("already exists")
  );
}

export const POST = withPermission(
  "customers:write",
  async (request, { user, params }) => {
    const ip = getClientIp(request);
    const limiter = rateLimit(`customer-invite:${ip}`, {
      windowMs: 60_000,
      maxRequests: 5,
    });
    if (!limiter.success) {
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many invites. Please try again later.",
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(limiter.resetMs / 1000)),
          },
        },
      );
    }

    const customerId = params?.id;
    if (!customerId) {
      return errorResponse("BAD_REQUEST", "Missing customer ID", undefined, 400);
    }

    const invite = await readInviteBody(request);
    const adminDb = await createAdminClient();

    const { data: customer, error: customerError } = await dynamicFrom(
      adminDb,
      "customers",
    )
      .select("id, email, name, is_active")
      .eq("id", customerId)
      .single();
    if (customerError || !customer) {
      throw new ApiError("NOT_FOUND", "Customer not found", 404);
    }
    if (customer.is_active === false) {
      throw new ApiError(
        "CONFLICT",
        "Reactivate this customer before granting portal access.",
        409,
      );
    }

    const email = invite.email || (customer.email as string | null);
    if (!email) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Enter an email address for the portal user.",
        422,
      );
    }

    const breweryName = await readBreweryName(adminDb);

    const existingProfile = await findProfileByEmail(adminDb, email);
    if (existingProfile) {
      await ensureCustomerProfile(adminDb, {
        userId: existingProfile.id,
        email,
        displayName: invite.displayName,
        invitedBy: user.id,
      });
      await linkPortalUser(adminDb, customerId, existingProfile.id);
      await updatePortalEmailMetadata(adminDb, existingProfile.id, breweryName);
      await sendOtp(adminDb, email);
      log.info(
        { customerId, userId: existingProfile.id, email, invitedBy: user.id },
        "Customer portal access linked and OTP sent",
      );
      return successResponse({
        invited: true,
        email,
        userId: existingProfile.id,
        delivery: "otp" as const,
      });
    }

    // Provision without sending first. A secondary contact's email does not
    // match customers.email, so create_user_profile initially assigns the
    // staff default ['viewer']; the customer role and junction link must be in
    // place before any usable login email leaves the system.
    const { data: createData, error: createError } =
      await adminDb.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          ...(invite.displayName ? { display_name: invite.displayName } : {}),
          ...portalEmailMetadata(breweryName),
        },
      });

    if (!createError && createData.user) {
      await ensureCustomerProfile(adminDb, {
        userId: createData.user.id,
        email,
        displayName: invite.displayName,
        invitedBy: user.id,
      });
      await linkPortalUser(adminDb, customerId, createData.user.id);
      await sendOtp(adminDb, email);
      log.info(
        { customerId, userId: createData.user.id, email, invitedBy: user.id },
        "Customer portal user invited and linked",
      );
      return successResponse(
        {
          invited: true,
          email,
          userId: createData.user.id,
          delivery: "otp" as const,
        },
        undefined,
        201,
      );
    }

    const isExistingUser = isExistingAuthUserError(createError);
    if (!isExistingUser) {
      throw new ApiError(
        "INTERNAL_ERROR",
        `Failed to create portal user: ${createError?.message ?? "No user was returned"}`,
        500,
      );
    }

    // Recovery for an auth user whose user_profiles trigger row is missing.
    // generateLink identifies the auth user but does not send mail; the OTP
    // call below performs delivery after the profile and link are repaired.
    const { data: linkData, error: linkError } =
      await adminDb.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: PORTAL_REDIRECT_URL },
      });
    if (linkError || !linkData.user) {
      throw new ApiError(
        "INTERNAL_ERROR",
        `Failed to recover the existing portal user: ${linkError?.message ?? "No user was returned"}`,
        500,
      );
    }

    await ensureCustomerProfile(adminDb, {
      userId: linkData.user.id,
      email,
      displayName: invite.displayName,
      invitedBy: user.id,
    });
    await linkPortalUser(adminDb, customerId, linkData.user.id);
    await updatePortalEmailMetadata(adminDb, linkData.user.id, breweryName);
    await sendOtp(adminDb, email);
    return successResponse({
      invited: true,
      email,
      userId: linkData.user.id,
      delivery: "otp" as const,
    });
  },
);
