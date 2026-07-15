import { streamText, stepCountIs, type UIMessage, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withPermission } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";
import { createChatTools } from "./tools";
import { entityService } from "@/services/entity-service";
import { coreRegistry } from "@/entities/cores";
import { dynamicRpc } from "@/services/types";
import { logger } from "@/lib/logger";

import { BASE_SYSTEM_PROMPT, PROMPT_VERSION } from "@/domain/ai/prompts";

const log = logger.child({ route: "/api/chat", promptVersion: PROMPT_VERSION });

type PageContext = {
  section?: string;
  entityType?: string;
  entityId?: string;
}

type AiRateLimitResult = {
  allowed: boolean;
  remaining: number;
  reset_at: string;
}

const CHAT_RATE_LIMIT = {
  windowSeconds: 60,
  maxRequests: 10,
} as const;

/**
 * Maps display-friendly entity type names (from the chat-context URL parser
 * in `src/contexts/chat-context.tsx`) to `coreRegistry` keys. The chat context
 * uses display-friendly names like "brew log"; the registry uses snake_case
 * like "brew_log". Must stay in sync with `ENTITY_MAP` in `chat-context.tsx`
 * — entries here whose target is missing from `coreRegistry` are harmless
 * (`fetchEntityContext` returns `null` and the route falls back to a generic
 * "user is viewing a {entityType} page" summary).
 */
const ENTITY_TYPE_TO_REGISTRY: Record<string, string> = {
  // Production
  batch: "batch",
  recipe: "recipe",
  "brew log": "brew_log",
  vessel: "vessel",
  "vessel transfer": "vessel_transfer",
  "yeast pitch": "yeast_pitch",
  "packaging session": "packaging_session",
  // Inventory
  "finished good": "finished_good",
  "inventory item": "inventory_item",
  "inventory lot": "inventory_lot",
  allocation: "allocation",
  delivery: "delivery",
  "location transfer": "location_transfer",
  "keg inventory": "keg_inventory",
  bin: "bin",
  // Sales
  order: "order",
  customer: "customer",
  "pick list": "pick_list",
  // Purchasing
  "purchase order": "purchase_order",
  supplier: "supplier",
  // Settings
  "user profile": "user_profile",
  location: "location",
  brand: "brand",
  "beer style": "beer_style",
  "sales channel": "sales_channel",
  "pricing tier": "pricing_tier",
  "yeast strain": "yeast_strain",
  "water profile": "water_profile",
};

/**
 * Fetch a lightweight summary for the entity the user is currently viewing.
 * Uses the entity registry to look up any entity, then fetches via entityService.
 */
async function fetchEntityContext(
  supabase: SupabaseClient<Database>,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  try {
    const registryName = ENTITY_TYPE_TO_REGISTRY[entityType];
    if (!registryName) return null;

    const entity = coreRegistry.get(registryName);
    if (!entity) return null;

    const result = await entityService.getById(supabase, entity, entityId);
    if (!result.success) return null;

    const record = result.data as Record<string, unknown>;

    // Build a summary from the entity's key fields (title, subtitle, badge)
    const parts: string[] = [`Current ${entity.displayName}:`];

    if (entity.detailHeader) {
      const titleVal = record[entity.detailHeader.title];
      if (titleVal) parts.push(`"${titleVal}"`);

      if (entity.detailHeader.subtitle) {
        const subtitleVal = record[entity.detailHeader.subtitle];
        if (subtitleVal) parts.push(`(${subtitleVal})`);
      }

      if (entity.detailHeader.badge) {
        const badgeVal = record[entity.detailHeader.badge];
        if (badgeVal) parts.push(`status=${badgeVal}`);
      }
    }

    // Add key fields if defined in keyFields (AI context fields)
    if (entity.keyFields?.length) {
      for (const field of entity.keyFields) {
        if (record[field] !== undefined && record[field] !== null) {
          parts.push(`${field}=${record[field]}`);
        }
      }
    }

    return parts.join(", ");
  } catch {
    return null;
  }
}

async function buildSystemPrompt(
  supabase: SupabaseClient<Database>,
  pageContext?: PageContext,
): Promise<string> {
  if (!pageContext?.section) return BASE_SYSTEM_PROMPT;

  let contextLine = "";
  if (pageContext.entityId && pageContext.entityType) {
    const entitySummary = await fetchEntityContext(supabase, pageContext.entityType, pageContext.entityId);
    if (entitySummary) {
      contextLine = `\n\n${entitySummary}\nEntity ID: ${pageContext.entityId}`;
    } else {
      contextLine = `\n\nThe user is viewing a ${pageContext.entityType} detail page (ID: ${pageContext.entityId}).`;
    }
  } else if (pageContext.entityType) {
    contextLine = `\n\nThe user is browsing the ${pageContext.section} > ${pageContext.entityType} list.`;
  } else {
    contextLine = `\n\nThe user is browsing the ${pageContext.section} section.`;
  }

  return BASE_SYSTEM_PROMPT + contextLine;
}

/**
 * Resolve the Anthropic API key for the current user.
 * Checks user preferences first, then falls back to the global system setting.
 */
async function resolveApiKey(
  supabase: SupabaseClient<Database>,
  userId: string,
  adminDb: SupabaseClient<Database>,
): Promise<string | null> {
  const { data: prefs, error: prefsError } = await supabase
    .from("user_preferences")
    .select("anthropic_api_key")
    .eq("user_id", userId)
    .single();

  if (prefsError) {
    log.error({ error: prefsError.message, userId }, "Failed to read user API key");
  }

  if (prefs?.anthropic_api_key) {
    return prefs.anthropic_api_key;
  }

  // Fall back to the brewery-funded key through the already-authorized
  // service-role client. Forbidden callers never instantiate this client.
  const { data: setting, error: settingError } = await adminDb
    .from("system_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();

  if (settingError) {
    log.error({ error: settingError.message }, "Failed to read global API key");
  }

  const globalKey = setting?.value;
  if (typeof globalKey === "string" && globalKey !== "null") {
    return globalKey;
  }

  return null;
}

async function consumeChatRateLimit(
  adminDb: SupabaseClient<Database>,
  userId: string,
): Promise<AiRateLimitResult> {
  const { data, error } = await dynamicRpc(adminDb, "consume_ai_rate_limit", {
    p_user_id: userId,
    p_window_seconds: CHAT_RATE_LIMIT.windowSeconds,
    p_max_requests: CHAT_RATE_LIMIT.maxRequests,
  });

  const result = Array.isArray(data) ? data[0] : data;
  if (
    error
    || !result
    || typeof result.allowed !== "boolean"
    || typeof result.remaining !== "number"
    || typeof result.reset_at !== "string"
  ) {
    log.error(
      { error: error?.message ?? "Invalid durable rate-limit response", userId },
      "Failed to enforce chat rate limit",
    );
    throw new ApiError(
      "INTERNAL_ERROR",
      "Unable to enforce the chat rate limit",
    );
  }

  return result as AiRateLimitResult;
}

export const POST = withPermission("ai:use", async (request, { user, supabase }) => {
  const startTime = Date.now();
  const adminDb = await createAdminClient();

  // One durable bucket per authenticated staff user, shared by every app
  // instance. Consume it before reading either a personal or brewery key.
  const limiter = await consumeChatRateLimit(adminDb, user.id);
  if (!limiter.allowed) {
    const resetMs = new Date(limiter.reset_at).getTime() - Date.now();
    log.warn({ userId: user.id }, "Rate limit exceeded");
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil(resetMs / 1000))) },
      },
    );
  }

  const apiKey = await resolveApiKey(supabase, user.id, adminDb);

  if (!apiKey) {
    log.warn({ userId: user.id }, "No API key configured for chat request");
    return NextResponse.json(
      { error: "No API key configured. Add your Anthropic API key in Settings." },
      { status: 400 },
    );
  }

  const { messages, pageContext }: { messages: UIMessage[]; pageContext?: PageContext } =
    await request.json();

  log.info({
    userId: user.id,
    messageCount: messages.length,
    section: pageContext?.section,
    entityType: pageContext?.entityType,
  }, "Chat request started");

  const anthropic = createAnthropic({ apiKey });
  const tools = createChatTools(supabase);
  const systemPrompt = await buildSystemPrompt(supabase, pageContext);

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    tools,
    maxOutputTokens: 2048,
    stopWhen: stepCountIs(5),
  });

  log.info({
    userId: user.id,
    durationMs: Date.now() - startTime,
  }, "Chat stream initiated");

  // Wrap the streaming Response as NextResponse to satisfy withAuth's return type
  const streamingResponse = result.toUIMessageStreamResponse();
  return new NextResponse(streamingResponse.body, {
    status: streamingResponse.status,
    headers: streamingResponse.headers,
  });
});
