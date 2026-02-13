import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withPermission } from "@/lib/api/auth";
import { testSlackWebhook } from "@/lib/slack";

function createAdminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

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
    const admin = createAdminDb();
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
