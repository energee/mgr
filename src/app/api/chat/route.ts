import { streamText, stepCountIs, type UIMessage, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getHelpContentForSystemPrompt } from "@/lib/help-content";
import { createChatTools } from "./tools";
import { getHelpContentForSystemPrompt } from "@/lib/help-content";

const BASE_SYSTEM_PROMPT = `You are the MGR Brewery Assistant. You help brewers manage their brewery operations.

You have deep knowledge of:
- Brewing science (mashing, fermentation, water chemistry, hop utilization)
- BJCP style guidelines
- Production planning and scheduling
- Inventory management
- Recipe formulation and optimization

You are integrated into the MGR brewery management system. You have access to tools that let you query live brewery data — use them when the user asks about specific recipes, batches, inventory, vessels, or production schedules.

Be concise and practical. When you use a tool, summarize the results clearly. Format data in tables when appropriate.
When users ask how to do something in MGR, give specific navigation instructions using the guide below.

${getHelpContentForSystemPrompt()}`;

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

function buildSystemPrompt(pageContext?: PageContext): string {
  if (!pageContext?.section) return BASE_SYSTEM_PROMPT;

  let contextLine = "";
  if (pageContext.entityId && pageContext.entityType) {
    contextLine = `\n\nThe user is currently viewing: ${pageContext.entityType} detail (ID: ${pageContext.entityId}) in the ${pageContext.section} section.`;
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

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: buildSystemPrompt(pageContext),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
