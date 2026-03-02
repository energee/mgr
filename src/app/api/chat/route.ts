import { streamText, stepCountIs, type UIMessage, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createChatTools } from "./tools";
import { entityRegistry } from "@/entities";
import { entityService } from "@/services/entity-service";

const BASE_SYSTEM_PROMPT = `You are the MGR Brewery Assistant — concise, practical, brewery-focused.

Knowledge: brewing science, BJCP styles, production planning, inventory, recipe optimization.

You have tools to query live brewery data. Use searchEntity and getEntityDetail for any entity type. Use specialized tools (analyzeRecipe, analyzeBatch, etc.) for domain-specific analysis.

Navigation tools open pre-filled forms for the user to review and submit:
- createBatch, transitionBatch, addBatchReading, createPackagingSession

Use lookupEntity to resolve names/numbers to UUIDs (e.g., "batch 42" → UUID).

When users ask "how do I..." in MGR, use the getAppGuide tool to look up navigation instructions.

Summarize tool results clearly. Use tables for multi-row data.`;

// Pending type generation — anthropic_api_key is added by migration 00064
// but not yet in generated Supabase types. Remove after next `supabase gen types`.
interface UserPrefsApiKeyRow {
  anthropic_api_key: string | null;
}

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
const ENTITY_TYPE_TO_REGISTRY: Record<string, string> = {
  batch: "batch",
  recipe: "recipe",
  "brew log": "brew_log",
  vessel: "vessel",
  "yeast pitch": "yeast_pitch",
  "packaging session": "packaging_session",
  "finished good": "finished_good",
  order: "order",
  customer: "customer",
  "inventory item": "inventory_item",
  "purchase order": "purchase_order",
  supplier: "supplier",
  "pick list": "pick_list",
  "keg inventory": "keg_inventory",
  delivery: "delivery",
  "location transfer": "location_transfer",
  brand: "brand",
  location: "location",
  "beer style": "beer_style",
};

/**
 * Fetch a lightweight summary for the entity the user is currently viewing.
 * Uses the entity registry to look up any entity, then fetches via entityService.
 */
async function fetchEntityContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  try {
    const registryName = ENTITY_TYPE_TO_REGISTRY[entityType];
    if (!registryName) return null;

    const entity = entityRegistry.get(registryName);
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
  supabase: Awaited<ReturnType<typeof createClient>>,
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  // User's personal key (anthropic_api_key not yet in generated types)
  const { data: prefs, error: prefsError } = await supabase
    .from("user_preferences")
    .select("anthropic_api_key" as string)
    .eq("user_id", userId)
    .single<UserPrefsApiKeyRow>();

  if (prefsError) {
    console.error("[chat] Failed to read user API key:", prefsError.message);
  }

  if (prefs?.anthropic_api_key) {
    return prefs.anthropic_api_key;
  }

  // Fall back to global key from system_settings.
  // Uses service role client (no cookie auth) to bypass RLS.
  const adminDb = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: setting, error: settingError } = await adminDb
    .from("system_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();

  if (settingError) {
    console.error("[chat] Failed to read global API key:", settingError.message);
  }

  const globalKey = setting?.value;
  if (typeof globalKey === "string" && globalKey !== "null") {
    return globalKey;
  }

  return null;
}

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = await resolveApiKey(supabase, user.id);

  if (!apiKey) {
    return Response.json(
      { error: "No API key configured. Add your Anthropic API key in Settings." },
      { status: 400 },
    );
  }

  const { messages, pageContext }: { messages: UIMessage[]; pageContext?: PageContext } =
    await req.json();

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

  return result.toUIMessageStreamResponse();
}
