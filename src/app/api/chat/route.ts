import { streamText, UIMessage, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();

  // Get authenticated user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Try user's personal key first
  const { data: prefs } = await (supabase as any)
    .from("user_preferences")
    .select("anthropic_api_key")
    .eq("user_id", user.id)
    .single();

  let apiKey: string | null = prefs?.anthropic_api_key || null;

  // Fall back to global key from system_settings
  if (!apiKey) {
    const { data: setting } = await (supabase as any)
      .from("system_settings")
      .select("value")
      .eq("key", "anthropic_api_key")
      .single();

    const globalKey = setting?.value;
    if (globalKey && globalKey !== null && globalKey !== "null") {
      apiKey = typeof globalKey === "string" ? globalKey : null;
    }
  }

  if (!apiKey) {
    return Response.json(
      {
        error:
          "No API key configured. Add your Anthropic API key in Settings.",
      },
      { status: 400 }
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const anthropic = createAnthropic({ apiKey });

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: `You are the MGR Brewery Assistant. You help brewers manage their brewery operations.

You have deep knowledge of:
- Brewing science (mashing, fermentation, water chemistry, hop utilization)
- BJCP style guidelines
- Production planning and scheduling
- Inventory management
- Recipe formulation and optimization

You are integrated into the MGR brewery management system. Be concise and practical.
When discussing recipes, batches, or other entities, reference specifics when you have them.`,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
