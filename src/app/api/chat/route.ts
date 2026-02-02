import { streamText, type UIMessage, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const SYSTEM_PROMPT = `You are the MGR Brewery Assistant. You help brewers manage their brewery operations.

You have deep knowledge of:
- Brewing science (mashing, fermentation, water chemistry, hop utilization)
- BJCP style guidelines
- Production planning and scheduling
- Inventory management
- Recipe formulation and optimization

You are integrated into the MGR brewery management system. Be concise and practical.
When discussing recipes, batches, or other entities, reference specifics when you have them.`;

/**
 * Resolve the Anthropic API key for the current user.
 * Checks user preferences first, then falls back to the global system setting.
 */
async function resolveApiKey(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Try user's personal key first
  const { data: prefs } = await db
    .from("user_preferences")
    .select("anthropic_api_key")
    .eq("user_id", userId)
    .single();

  if (prefs?.anthropic_api_key) {
    return prefs.anthropic_api_key;
  }

  // Fall back to global key from system_settings.
  // Uses admin client to bypass RLS (SELECT policy excludes api_key rows).
  const adminDb = await createAdminClient();
  const { data: setting } = await adminDb
    .from("system_settings")
    .select("value")
    .eq("key", "anthropic_api_key")
    .single();

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

  const { messages }: { messages: UIMessage[] } = await req.json();
  const anthropic = createAnthropic({ apiKey });

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
