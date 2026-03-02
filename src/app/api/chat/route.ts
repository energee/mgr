import { streamText, stepCountIs, type UIMessage, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withAuth } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";
import { createChatTools } from "./tools";
import { entityService } from "@/services/entity-service";
import { CHAT_ENTITY_MAP } from "./entity-map";
import { rateLimit, getClientIp } from "@/lib/api/rate-limit";
import { logger } from "@/lib/logger";

const log = logger.child({ route: "/api/chat" });

const BASE_SYSTEM_PROMPT = `You are the MGR Brewery Assistant — concise, practical, brewery-focused.

Knowledge: brewing science, BJCP styles, production planning, inventory, recipe optimization.

You have tools to query live brewery data. Use searchEntity and getEntityDetail for any entity type. Use specialized tools (analyzeRecipe, analyzeBatch, etc.) for domain-specific analysis.

Navigation tools open pre-filled forms for the user to review and submit:
- createBatch, transitionBatch, addBatchReading, createPackagingSession

Use lookupEntity to resolve names/numbers to UUIDs (e.g., "batch 42" → UUID).

When users ask "how do I..." in MGR, use the getAppGuide tool to look up navigation instructions.

Summarize tool results clearly. Use tables for multi-row data.`;

interface PageContext {
  section?: string;
  entityType?: string;
  entityId?: string;
}

/**
 * Map from chat context entityType strings (from URL parsing) to entity
 * registry names. The chat context uses display-friendly names like
 * "brew log" while the registry uses snake_case like "brew_log".
 */
/**
 * Maps display-friendly entity type names (from chat-context.tsx URL parser)
 * to CHAT_ENTITY_MAP registry keys. Must stay in sync with ENTITY_MAP in
 * src/contexts/chat-context.tsx.
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
  "keg type": "keg_type",
  "sales channel": "sales_channel",
  "pricing tier": "pricing_tier",
  "yeast strain": "yeast_strain",
  "water profile": "water_profile",
  "package type": "package_type",
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

    const entity = CHAT_ENTITY_MAP.get(registryName);
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
): Promise<string | null> {
  const { data: prefs, error: prefsError } = await supabase
    .from("user_preferences")
    .select("anthropic_api_key")
    .eq("user_id", userId)
    .single();

  if (prefsError) {
    log.error("Failed to read user API key", { error: prefsError.message, userId });
  }

  if (prefs?.anthropic_api_key) {
    return prefs.anthropic_api_key;
  }

  // Fall back to global key from system_settings.
  // Uses service role client (no cookie auth) to bypass RLS.
  const adminDb = createAdminClient();
  const { data: setting, error: settingError } = await adminDb
    .from("system_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();

  if (settingError) {
    log.error("Failed to read global API key", { error: settingError.message });
  }

  const globalKey = setting?.value;
  if (typeof globalKey === "string" && globalKey !== "null") {
    return globalKey;
  }

  return null;
}

export const POST = withAuth(async (request, { user, supabase }) => {
  const startTime = Date.now();

  // Rate limit: 10 requests per minute per IP
  const ip = getClientIp(request);
  const limiter = rateLimit(`chat:${ip}`, { windowMs: 60_000, maxRequests: 10 });
  if (!limiter.success) {
    log.warn("Rate limit exceeded", { ip, userId: user.id });
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limiter.resetMs / 1000)) },
      },
    );
  }

  const apiKey = await resolveApiKey(supabase, user.id);

  if (!apiKey) {
    log.warn("No API key configured for chat request", { userId: user.id });
    return NextResponse.json(
      { error: "No API key configured. Add your Anthropic API key in Settings." },
      { status: 400 },
    );
  }

  const { messages, pageContext }: { messages: UIMessage[]; pageContext?: PageContext } =
    await request.json();

  log.info("Chat request started", {
    userId: user.id,
    messageCount: messages.length,
    section: pageContext?.section,
    entityType: pageContext?.entityType,
  });

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

  log.info("Chat stream initiated", {
    userId: user.id,
    durationMs: Date.now() - startTime,
  });

  // Wrap the streaming Response as NextResponse to satisfy withAuth's return type
  const streamingResponse = result.toUIMessageStreamResponse();
  return new NextResponse(streamingResponse.body, {
    status: streamingResponse.status,
    headers: streamingResponse.headers,
  });
});
