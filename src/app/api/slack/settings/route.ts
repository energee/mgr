import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { withPermission } from "@/lib/api/auth";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/slack/settings" });

/**
 * GET /api/slack/settings
 *
 * Returns Slack configuration with the webhook URL masked for security.
 */
export const GET = withPermission("integrations:manage", async () => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("slack_settings")
    .select("webhook_url, default_channel, is_enabled, channel_overrides, updated_at")
    .limit(1)
    .single();

  if (error) {
    log.error("GET error", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mask webhook URL for client display
  const masked = data.webhook_url
    ? data.webhook_url.substring(0, 30) + "..." + data.webhook_url.slice(-8)
    : null;

  return NextResponse.json({
    ...data,
    webhook_url_masked: masked,
    has_webhook: !!data.webhook_url,
  });
});

/**
 * Derive the canonical app URL from Vercel env vars or request headers.
 * Vercel sets VERCEL_PROJECT_PRODUCTION_URL (e.g. "myapp.vercel.app") on all deployments.
 */
function deriveAppUrl(req: Request): string | null {
  // Prefer the production URL env var (no protocol prefix)
  const vercelProdUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProdUrl) return `https://${vercelProdUrl}`;

  // Fallback: current request host
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;

  return null;
}

/**
 * PUT /api/slack/settings
 *
 * Updates Slack configuration fields. Auto-populates app_url from
 * Vercel environment variables so pg_net knows where to POST.
 */
export const PUT = withPermission("integrations:manage", async (req) => {
  const body = await req.json();
  const { webhook_url, default_channel, is_enabled, channel_overrides } = body as {
    webhook_url?: string | null;
    default_channel?: string | null;
    is_enabled?: boolean;
    channel_overrides?: Record<string, string>;
  };

  const admin = createAdminClient();

  // Build update payload with only provided fields
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (webhook_url !== undefined) update.webhook_url = webhook_url || null;
  if (default_channel !== undefined) update.default_channel = default_channel || null;
  if (is_enabled !== undefined) update.is_enabled = is_enabled;
  if (channel_overrides !== undefined) update.channel_overrides = channel_overrides;

  // Auto-populate app_url from Vercel env vars / request headers
  const appUrl = deriveAppUrl(req);
  if (appUrl) update.app_url = appUrl;

  const { error } = await admin
    .from("slack_settings")
    .update(update)
    .not("id", "is", null); // Update the singleton row

  if (error) {
    log.error("PUT error", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
