import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { withPermission } from "@/lib/api/auth";
import { testSlackWebhook } from "@/integrations/slack";

/**
 * POST /api/slack/test
 *
 * Sends a test message to Slack. Accepts optional `webhookUrl` in body
 * (for testing before saving), otherwise reads from slack_settings.
 */
export const POST = withPermission("integrations:manage", async (req) => {
  const body = await req.json();
  let webhookUrl: string | null = body.webhookUrl ?? null;

  if (!webhookUrl) {
    const admin = await createAdminClient();
    const { data: settings } = await admin
      .from("slack_settings")
      .select("webhook_url")
      .limit(1)
      .single();

    webhookUrl = settings?.webhook_url ?? null;
  }

  if (!webhookUrl) {
    return NextResponse.json(
      { success: false, error: "No webhook URL provided or configured" },
      { status: 400 },
    );
  }

  const result = await testSlackWebhook(webhookUrl);
  return NextResponse.json({ success: result.ok, error: result.error });
});
