import { NextResponse } from "next/server";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { withPermission } from "@/lib/api/auth";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * POST /api/settings/api-key/test
 *
 * Body: { scope: "global" | "user" }
 * Tests the stored API key by making a minimal Anthropic API call.
 */
export const POST = withPermission("settings:manage", async (req, { supabase, user }) => {
  const { scope } = (await req.json()) as { scope: string };

  let apiKey: string | null = null;

  if (scope === "global") {
    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "anthropic_api_key")
      .single();

    const value = data?.value;
    if (typeof value === "string" && value !== "null" && value.length > 0) {
      apiKey = value;
    }
  } else if (scope === "user") {
    const { data } = await supabase
      .from("user_preferences")
      .select("anthropic_api_key" as string)
      .eq("user_id", user.id)
      .single<{ anthropic_api_key: string | null }>();

    apiKey = data?.anthropic_api_key ?? null;
  } else {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "No API key configured" },
      { status: 400 },
    );
  }

  try {
    const anthropic = createAnthropic({ apiKey });
    await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      prompt: "Reply with the single word: ok",
      maxOutputTokens: 4,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 },
    );
  }
});
