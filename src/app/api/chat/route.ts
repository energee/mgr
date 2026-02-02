import { streamText, UIMessage, convertToModelMessages } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

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
