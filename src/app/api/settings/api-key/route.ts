import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// Pending type generation — anthropic_api_key is added by migration 00064
// but not yet in generated Supabase types. Remove after next `supabase gen types`.
interface UserPrefsApiKeyRow {
  anthropic_api_key: string | null;
}

function createAdminDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

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
    const admin = createAdminDb();
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "anthropic_api_key")
      .single();

    if (error) {
      console.error("[api-key] Failed to check global key:", error.message);
    }

    const value = data?.value;
    const hasKey = typeof value === "string" && value !== "null" && value.length > 0;
    return NextResponse.json({ hasKey });
  }

  if (scope === "user") {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("anthropic_api_key" as string)
      .eq("user_id", user.id)
      .single<UserPrefsApiKeyRow>();

    if (error) {
      console.error("[api-key] Failed to check user key:", error.message);
    }

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
    const admin = createAdminDb();
    const { error } = await admin
      .from("system_settings")
      .update({ value: key || null })
      .eq("key", "anthropic_api_key");

    if (error) {
      console.error("[api-key] Failed to save global key:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  if (scope === "user") {
    const { error } = await supabase
      .from("user_preferences")
      .update({
        anthropic_api_key: key || null,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq("user_id", user.id);

    if (error) {
      console.error("[api-key] Failed to save user key:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
}
