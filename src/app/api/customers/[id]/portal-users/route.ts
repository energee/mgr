/**
 * GET /api/customers/[id]/portal-users
 *
 * Lists the independently authenticated users who currently have access to one
 * customer. Email and display data come from user_profiles, never auth.users.
 * Revoked links keep their row as a tombstone (`revoked_at`, migration 00276)
 * and are excluded here — the Portal Access panel must show granted access
 * only.
 */
import { withPermission } from "@/lib/api/auth";
import { successResponse } from "@/lib/api/response";
import { ApiError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/server";
import { dynamicFrom } from "@/services/types";

type PortalLink = {
  user_id: string;
  created_at: string;
};

type PortalProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  status: string | null;
  last_active_at: string | null;
};

export const GET = withPermission("customers:read", async (_request, { params }) => {
  const customerId = params?.id;
  if (!customerId) {
    throw new ApiError("VALIDATION_ERROR", "Missing customer ID", 400);
  }

  const adminDb = await createAdminClient();
  const { data: linksData, error: linksError } = await dynamicFrom(
    adminDb,
    "customer_portal_users",
  )
    .select("user_id, created_at")
    .eq("customer_id", customerId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  if (linksError) throw linksError;

  const links = (linksData ?? []) as PortalLink[];
  if (links.length === 0) return successResponse([]);

  const { data: profilesData, error: profilesError } = await dynamicFrom(
    adminDb,
    "user_profiles",
  )
    .select("id, email, display_name, status, last_active_at")
    .in(
      "id",
      links.map((link) => link.user_id),
    );
  if (profilesError) throw profilesError;

  const profiles = new Map(
    ((profilesData ?? []) as PortalProfile[]).map((profile) => [
      profile.id,
      profile,
    ]),
  );

  return successResponse(
    links.map((link) => {
      const profile = profiles.get(link.user_id);
      return {
        userId: link.user_id,
        email: profile?.email ?? null,
        displayName: profile?.display_name ?? null,
        status: profile?.status ?? null,
        lastActiveAt: profile?.last_active_at ?? null,
        accessGrantedAt: link.created_at,
      };
    }),
  );
});
