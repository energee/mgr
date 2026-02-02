import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

/**
 * GET /api/settings/api-key?scope=global|user
 *
 * Returns { hasKey: boolean } — never exposes the actual key value.
 */
export async function GET(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope");

  if (scope === "global") {
    const admin = await createAdminClient();
    const { data } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "anthropic_api_key")
      .single();

    const value = data?.value;
    const hasKey = typeof value === "string" && value !== "null" && value.length > 0;
    return NextResponse.json({ hasKey });
  }

  if (scope === "user") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data } = await db
      .from("user_preferences")
      .select("anthropic_api_key")
      .eq("user_id", user.id)
      .single();

    return NextResponse.json({ hasKey: !!data?.anthropic_api_key });
  }

  return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
}

/**
 * POST /api/settings/api-key
 *
 * Body: { scope: "global" | "user", key: string }
 * Saves or removes an API key. Empty string removes the key.
 */
export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { scope, key } = (await req.json()) as { scope: string; key: string };

  if (scope === "global") {
    const admin = await createAdminClient();
    const { error } = await admin
      .from("system_settings")
      .update({ value: key || null })
      .eq("key", "anthropic_api_key");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  if (scope === "user") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db
      .from("user_preferences")
      .update({
        anthropic_api_key: key || null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
}
