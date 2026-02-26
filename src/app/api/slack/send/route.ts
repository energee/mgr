import crypto from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendSlackNotification } from "@/lib/slack";
import type { SlackSettings, SlackNotification } from "@/lib/slack";

/** Constant-time string comparison to prevent timing attacks. */
function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createAdminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminDb();

  // Validate secret against stored value
  const { data: settings, error: settingsErr } = await admin
    .from("slack_settings")
    .select("*")
    .limit(1)
    .single();

  if (settingsErr || !settings) {
    console.error("[slack/send] Failed to read slack_settings:", settingsErr?.message);
    return NextResponse.json({ error: "Config error" }, { status: 500 });
  }

  if (!secureCompare(settings.internal_secret, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!settings.is_enabled || !settings.webhook_url) {
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

  const result = await sendSlackNotification(slackSettings, notification, appUrl);

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
