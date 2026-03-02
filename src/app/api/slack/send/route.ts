import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendSlackNotification } from "@/lib/slack";
import type { SlackSettings, SlackNotification } from "@/lib/slack";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/slack/send" });

/**
 * Constant-time string comparison to prevent timing attacks.
 * HMAC-hashes both inputs to fixed-length digests before comparing,
 * eliminating the length side-channel that a direct buffer comparison would leak.
 * The key value is arbitrary — it only ensures both sides produce equal-length digests.
 */
function secureCompare(a: string, b: string): boolean {
  const hmacA = crypto.createHmac("sha256", "mgr-secure-compare").update(a).digest();
  const hmacB = crypto.createHmac("sha256", "mgr-secure-compare").update(b).digest();
  return crypto.timingSafeEqual(hmacA, hmacB);
}

/**
 * POST /api/slack/send
 *
 * Called by pg_net from notify_all_users(). Authenticates via
 * X-Slack-Secret header matched against slack_settings.internal_secret.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = req.headers.get("X-Slack-Secret");
  if (!secret) {
    log.warn("Missing X-Slack-Secret header");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Validate secret against stored value
  const { data: settings, error: settingsErr } = await admin
    .from("slack_settings")
    .select("*")
    .limit(1)
    .single();

  if (settingsErr || !settings) {
    log.error("Failed to read slack_settings", { error: settingsErr?.message });
    return NextResponse.json({ error: "Config error" }, { status: 500 });
  }

  if (!secureCompare(settings.internal_secret, secret)) {
    log.warn("Invalid Slack secret provided");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!settings.is_enabled || !settings.webhook_url) {
    log.debug("Slack notifications disabled, skipping");
    return NextResponse.json({ skipped: true });
  }

  const body = await req.json();
  const { log_id, type, title, message, priority, action_url, metadata } = body as {
    log_id: string;
    type: string;
    title: string;
    message: string | null;
    priority: string;
    action_url: string | null;
    metadata: Record<string, unknown>;
  };

  // Derive app URL from the incoming request
  const host = req.headers.get("host") ?? req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const appUrl = host ? `${proto}://${host}` : null;

  const notification: SlackNotification = {
    type,
    title,
    message,
    priority,
    action_url,
    metadata: metadata ?? {},
  };

  const slackSettings: SlackSettings = {
    webhook_url: settings.webhook_url,
    default_channel: settings.default_channel,
    is_enabled: settings.is_enabled,
    channel_overrides: (settings.channel_overrides as Record<string, string>) ?? {},
  };

  log.info("Sending Slack notification", { type, priority, logId: log_id });

  const result = await sendSlackNotification(slackSettings, notification, appUrl);

  if (result.ok) {
    log.info("Slack notification sent successfully", { type, logId: log_id });
  } else {
    log.error("Slack notification failed", {
      type,
      logId: log_id,
      error: result.error,
    });
  }

  // Update log entry
  if (log_id) {
    await admin
      .from("slack_notification_log")
      .update({
        status: result.ok ? "sent" : "failed",
        error_message: result.error ?? null,
        sent_at: result.ok ? new Date().toISOString() : null,
        channel: slackSettings.channel_overrides[type] ?? slackSettings.default_channel ?? null,
      })
      .eq("id", log_id);
  }

  return NextResponse.json({ ok: result.ok, error: result.error });
}
