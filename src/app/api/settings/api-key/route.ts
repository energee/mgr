import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

// Pending type generation -- anthropic_api_key is added by migration 00064
// but not yet in generated Supabase types. Remove after next `supabase gen types`.
type UserPrefsApiKeyRow = {
  anthropic_api_key: string | null;
}

/** Return last 4 characters of key as a hint, e.g. "...a1b2" */
function maskKey(key: string | null | undefined): string | null {
  if (!key || key.length < 8) return null;
  return `...${key.slice(-4)}`;
}

const VALID_INTEGRATION_IDS = ["square", "square-webhook", "slack", "quickbooks", "mongodb"];

/**
 * GET /api/settings/api-key?scope=global|user|integration&id=<integration_id>
 *
 * Returns { hasKey: boolean, keyHint: string | null }.
 * keyHint shows the last 4 characters so users can identify which key is saved.
 */
export const GET = withPermission("settings:manage", async (req, { supabase, user }) => {
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope");

  if (scope === "global") {
    const admin = await createAdminClient();
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "anthropic_api_key")
      .single();

    if (error) {
      logger.error("[api-key] Failed to check global key: %s", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const value = data?.value;
    const hasKey = typeof value === "string" && value !== "null" && value.length > 0;
    return NextResponse.json({
      hasKey,
      keyHint: hasKey ? maskKey(value as string) : null,
    });
  }

  if (scope === "user") {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("anthropic_api_key" as string)
      .eq("user_id", user.id)
      .single<UserPrefsApiKeyRow>();

    if (error) {
      logger.error("[api-key] Failed to check user key: %s", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const key = data?.anthropic_api_key;
    const hasKey = !!key;
    return NextResponse.json({
      hasKey,
      keyHint: hasKey ? maskKey(key) : null,
    });
  }

  if (scope === "integration") {
    const id = searchParams.get("id");
    if (!id || !VALID_INTEGRATION_IDS.includes(id)) {
      return NextResponse.json({ error: "Invalid integration id" }, { status: 400 });
    }

    const settingsKey = `${id}_api_key`;
    const admin = await createAdminClient();
    const { data, error } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", settingsKey)
      .maybeSingle();

    if (error) {
      logger.error(`[api-key] Failed to check ${id} key: %s`, error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const value = data?.value;
    const hasKey = typeof value === "string" && value !== "null" && value.length > 0;
    return NextResponse.json({
      hasKey,
      keyHint: hasKey ? maskKey(value as string) : null,
    });
  }

  return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
});

/**
 * POST /api/settings/api-key
 *
 * Body: { scope: "global" | "user" | "integration", key: string, id?: string }
 * Saves or removes an API key. Empty string removes the key.
 */
export const POST = withPermission("settings:manage", async (req, { supabase, user }) => {
  const { scope, key, id } = (await req.json()) as { scope: string; key: string; id?: string };

  if (scope === "global") {
    const admin = await createAdminClient();
    if (!key) {
      const { error } = await admin
        .from("system_settings")
        .delete()
        .eq("key", "anthropic_api_key");

      if (error) {
        logger.error("[api-key] Failed to remove global key: %s", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await admin
        .from("system_settings")
        .upsert({ key: "anthropic_api_key", value: key }, { onConflict: "key" });

      if (error) {
        logger.error("[api-key] Failed to save global key: %s", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
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
      logger.error("[api-key] Failed to save user key: %s", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  if (scope === "integration") {
    if (!id || !VALID_INTEGRATION_IDS.includes(id)) {
      return NextResponse.json({ error: "Invalid integration id" }, { status: 400 });
    }

    const settingsKey = `${id}_api_key`;
    const admin = await createAdminClient();

    // Check if row already exists
    const { data: existing } = await admin
      .from("system_settings")
      .select("key")
      .eq("key", settingsKey)
      .maybeSingle();

    if (!key) {
      // Remove: delete the row (value is NOT NULL so we can't set null)
      if (existing) {
        const { error } = await admin
          .from("system_settings")
          .delete()
          .eq("key", settingsKey);

        if (error) {
          logger.error(`[api-key] Failed to remove ${id} key: %s`, error.message);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    } else if (existing) {
      const { error } = await admin
        .from("system_settings")
        .update({ value: key })
        .eq("key", settingsKey);

      if (error) {
        logger.error(`[api-key] Failed to save ${id} key: %s`, error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await admin
        .from("system_settings")
        .insert({ key: settingsKey, value: key });

      if (error) {
        logger.error(`[api-key] Failed to insert ${id} key: %s`, error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
});
