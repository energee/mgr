import { streamText, stepCountIs, type UIMessage, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createChatTools } from "./tools";

const BASE_SYSTEM_PROMPT = `You are the MGR Brewery Assistant — concise, practical, brewery-focused.

Knowledge: brewing science, BJCP styles, production planning, inventory, recipe optimization.

You have tools to query live brewery data (recipes, batches, inventory, vessels, orders). Use them when the user asks about specific data.

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

/** Fetch a lightweight summary for the entity the user is currently viewing. */
async function fetchEntityContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  try {
    switch (entityType) {
      case "batch": {
        const { data } = await supabase
          .from("batches_with_brew_info")
          .select("batch_number, name, status, volume_bbl, planned_start_date, brew_date, current_vessel_name, recipe:recipes(name)")
          .eq("id", entityId)
          .single();
        if (!data) return null;
        const recipe = data.recipe as { name: string } | null;
        return `Current batch: #${data.batch_number}${data.name ? ` "${data.name}"` : ""}, status=${data.status}, recipe="${recipe?.name}", volume=${data.volume_bbl} bbl, vessel=${data.current_vessel_name || "unassigned"}, planned=${data.planned_start_date || "n/a"}, brewed=${data.brew_date || "n/a"}`;
      }
      case "recipe": {
        const { data } = await supabase
          .from("recipes_with_estimates")
          .select("name, status, volume_bbl, est_og, est_fg, est_abv, est_ibu, est_srm, style:beer_styles(name)")
          .eq("id", entityId)
          .single();
        if (!data) return null;
        const style = data.style as { name: string } | null;
        return `Current recipe: "${data.name}", status=${data.status}, style="${style?.name || "none"}", volume=${data.volume_bbl} bbl, OG=${data.est_og}, FG=${data.est_fg}, ABV=${data.est_abv}%, IBU=${data.est_ibu}, SRM=${data.est_srm}`;
      }
      case "order": {
        const { data } = await supabase
          .from("orders")
          .select("order_number, status, order_date, requested_date, customer:customers(name)")
          .eq("id", entityId)
          .single();
        if (!data) return null;
        const customer = data.customer as { name: string } | null;
        return `Current order: #${data.order_number}, status=${data.status}, customer="${customer?.name}", ordered=${data.order_date}, requested=${data.requested_date || "n/a"}`;
      }
      case "vessel": {
        const { data } = await supabase
          .from("vessels_with_batch")
          .select("name, vessel_type, capacity_bbl, status, batch_number")
          .eq("id", entityId)
          .single();
        if (!data) return null;
        return `Current vessel: "${data.name}", type=${data.vessel_type}, capacity=${data.capacity_bbl} bbl, status=${data.status}, batch=${data.batch_number || "empty"}`;
      }
      default:
        return null;
    }
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
