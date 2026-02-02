# AI Integration Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add tool use (15 read-only tools), page-aware context, markdown rendering, session persistence, and Cmd+. keyboard shortcut to the AI chat assistant.

**Architecture:** Server-side tools in `src/app/api/chat/tools.ts` called via Vercel AI SDK's `tool()` with Supabase queries. Client-side `ChatProvider` context manages session state, page context from URL parsing, and keyboard shortcut. Markdown via `react-markdown` + `remark-gfm`.

**Tech Stack:** Vercel AI SDK (`ai`), `@ai-sdk/anthropic`, `react-markdown`, `remark-gfm`, Supabase RPC + queries, React Context.

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install react-markdown and remark-gfm**

Run: `npm install react-markdown remark-gfm`

**Step 2: Verify install**

Run: `npm ls react-markdown remark-gfm`
Expected: Both packages listed without errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-markdown and remark-gfm"
```

---

### Task 2: Create chat tools file

**Files:**
- Create: `src/app/api/chat/tools.ts`

**Step 1: Create the tools module**

This file exports a function `createChatTools(supabase)` that takes an authenticated Supabase server client and returns a tools object for the Vercel AI SDK `streamText` call.

```typescript
import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Create chat tools bound to an authenticated Supabase client.
 * All tools are read-only — the assistant cannot modify data.
 */
export function createChatTools(supabase: SupabaseClient) {
  return {
    // =========================================================================
    // SQL Function Tools (via Supabase RPC)
    // =========================================================================

    analyzeRecipe: tool({
      description:
        "Analyze a recipe against its target BJCP style guidelines. Returns compliance status for OG, FG, ABV, IBU, SRM.",
      parameters: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: async ({ recipeId }) => {
        const { data, error } = await supabase.rpc(
          "analyze_recipe_style_compliance",
          { p_recipe_id: recipeId }
        );
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getRecipeSummary: tool({
      description:
        "Get a comprehensive recipe summary including grain bill, hop schedule, yeast, water profile, mash/fermentation schedules, and calculated estimates.",
      parameters: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: async ({ recipeId }) => {
        const { data, error } = await supabase.rpc("get_recipe_summary", {
          p_recipe_id: recipeId,
        });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    suggestImprovements: tool({
      description:
        "Get improvement suggestions for a recipe based on brewing best practices, style compliance, yeast health, grain bill composition, and water chemistry.",
      parameters: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: async ({ recipeId }) => {
        const { data, error } = await supabase.rpc(
          "suggest_recipe_improvements",
          { p_recipe_id: recipeId }
        );
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    analyzeBatch: tool({
      description:
        "Analyze batch performance by comparing actual measurements (OG, FG, ABV) against recipe targets. Includes fermentation timeline and latest readings.",
      parameters: z.object({
        batchId: z.string().uuid().describe("The batch UUID"),
      }),
      execute: async ({ batchId }) => {
        const { data, error } = await supabase.rpc(
          "analyze_batch_performance",
          { p_batch_id: batchId }
        );
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getInventoryOverview: tool({
      description:
        "Get a snapshot of current inventory: finished goods, raw materials with available quantities, and batches in progress.",
      parameters: z.object({}),
      execute: async () => {
        const { data, error } = await supabase.rpc("get_inventory_overview");
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    // =========================================================================
    // Query Helper Tools (direct Supabase queries)
    // =========================================================================

    searchRecipes: tool({
      description: "Search recipes by name. Returns recipe details with style info.",
      parameters: z.object({
        query: z.string().describe("Search term to match against recipe names"),
        limit: z.number().optional().default(10).describe("Max results to return"),
      }),
      execute: async ({ query, limit }) => {
        const { data, error } = await supabase
          .from("recipes_with_estimates")
          .select("*, style:beer_styles(id, name, category)")
          .ilike("name", `%${query}%`)
          .limit(limit);
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getBatchStatus: tool({
      description:
        "Get a summary of all batches grouped by status (planned, fermenting, conditioning, etc.). Useful for production overview.",
      parameters: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("batches")
          .select("status")
          .neq("status", "cancelled");
        if (error) throw new Error(error.message);
        const summary: Record<string, number> = {};
        for (const batch of data || []) {
          summary[batch.status] = (summary[batch.status] || 0) + 1;
        }
        return summary;
      },
    }),

    getVesselAvailability: tool({
      description:
        "Get vessel utilization: which vessels are available, which are in use, and their current batch assignments.",
      parameters: z.object({}),
      execute: async () => {
        const { data, error } = await supabase
          .from("vessels_with_batch")
          .select(
            "id, name, vessel_type, capacity_bbl, status, current_batch_id, batch_number"
          )
          .eq("is_active", true)
          .order("name");
        if (error) throw new Error(error.message);
        const available = data?.filter(
          (v) => v.status === "ready_for_use" && !v.current_batch_id
        );
        const inUse = data?.filter((v) => v.current_batch_id);
        return {
          all: data,
          available,
          inUse,
          summary: {
            total: data?.length || 0,
            available: available?.length || 0,
            inUse: inUse?.length || 0,
          },
        };
      },
    }),

    getProductionSchedule: tool({
      description:
        "Get batches scheduled within a date range. Includes recipe name and volume.",
      parameters: z.object({
        startDate: z.string().describe("Start date (YYYY-MM-DD)"),
        endDate: z.string().describe("End date (YYYY-MM-DD)"),
      }),
      execute: async ({ startDate, endDate }) => {
        const { data, error } = await supabase
          .from("batches")
          .select(
            "id, batch_number, status, planned_start_date, recipe:recipes(name, volume_bbl, fermentation_days, conditioning_days)"
          )
          .gte("planned_start_date", startDate)
          .lte("planned_start_date", endDate)
          .neq("status", "cancelled")
          .order("planned_start_date");
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getIngredientInventory: tool({
      description:
        "Get raw ingredient inventory levels with lot quantities and expiration dates. Optionally filter by category (malt, hop, yeast, adjunct, chemical).",
      parameters: z.object({
        category: z
          .string()
          .optional()
          .describe("Filter by category: malt, hop, yeast, adjunct, chemical"),
      }),
      execute: async ({ category }) => {
        let query = supabase.from("inventory_items").select(
          "id, name, category, unit, reorder_point, inventory_lots(quantity, expiration_date)"
        );
        if (category) {
          query = query.eq("category", category);
        }
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return (data as Array<{
          id: string;
          name: string;
          category: string;
          unit: string;
          reorder_point: number | null;
          inventory_lots: Array<{ quantity: number; expiration_date: string | null }>;
        }>)?.map((item) => ({
          ...item,
          total_quantity:
            item.inventory_lots?.reduce((sum, lot) => sum + lot.quantity, 0) || 0,
          earliest_expiration: item.inventory_lots?.reduce(
            (earliest: string | null, lot) => {
              if (!lot.expiration_date) return earliest;
              if (!earliest) return lot.expiration_date;
              return lot.expiration_date < earliest ? lot.expiration_date : earliest;
            },
            null as string | null
          ),
        }));
      },
    }),

    // =========================================================================
    // New Tools (data not previously accessible to AI)
    // =========================================================================

    getBatchLogs: tool({
      description:
        "Get the event log for a batch: gravity readings, status changes, measurements, and notes. Ordered chronologically.",
      parameters: z.object({
        batchId: z.string().uuid().describe("The batch UUID"),
      }),
      execute: async ({ batchId }) => {
        const { data, error } = await supabase
          .from("batch_logs")
          .select("id, log_type, data, created_at, created_by_name")
          .eq("batch_id", batchId)
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getVesselCleanings: tool({
      description:
        "Get cleaning history for a vessel: cleaning type (CIP, caustic, acid, sanitize), chemicals used, duration, and dates.",
      parameters: z.object({
        vesselId: z.string().uuid().describe("The vessel UUID"),
      }),
      execute: async ({ vesselId }) => {
        const { data, error } = await supabase
          .from("vessel_cleanings")
          .select(
            "id, cleaning_type, from_status, to_status, duration_min, chemicals_used, notes, created_at"
          )
          .eq("vessel_id", vesselId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getBatchTransfers: tool({
      description:
        "Get the transfer history for a batch: which vessels it moved between, volumes, and dates.",
      parameters: z.object({
        batchId: z.string().uuid().describe("The batch UUID"),
      }),
      execute: async ({ batchId }) => {
        const { data, error } = await supabase
          .from("vessel_transfers")
          .select(
            "id, from_vessel:vessels!vessel_transfers_from_vessel_id_fkey(name), to_vessel:vessels!vessel_transfers_to_vessel_id_fkey(name), volume_bbl, transfer_type, notes, transferred_at"
          )
          .eq("batch_id", batchId)
          .order("transferred_at", { ascending: true });
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getRecipeCost: tool({
      description:
        "Get the cost breakdown (COGS) for a recipe including ingredient costs per batch.",
      parameters: z.object({
        recipeId: z.string().uuid().describe("The recipe UUID"),
      }),
      execute: async ({ recipeId }) => {
        const { data, error } = await supabase
          .from("recipes_with_cogs")
          .select("*")
          .eq("id", recipeId)
          .single();
        if (error) throw new Error(error.message);
        return data;
      },
    }),

    getLotExpiration: tool({
      description:
        "Get ingredient lots expiring within a given number of days. Useful for identifying inventory that needs to be used soon.",
      parameters: z.object({
        daysAhead: z
          .number()
          .optional()
          .default(30)
          .describe("Number of days to look ahead for expiring lots"),
      }),
      execute: async ({ daysAhead }) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + daysAhead);
        const { data, error } = await supabase
          .from("inventory_lots_with_quantities")
          .select("*")
          .not("expiration_date", "is", null)
          .lte("expiration_date", cutoff.toISOString().split("T")[0])
          .gt("available_quantity", 0)
          .order("expiration_date", { ascending: true });
        if (error) throw new Error(error.message);
        return data;
      },
    }),
  };
}
```

**Step 2: Commit**

```bash
git add src/app/api/chat/tools.ts
git commit -m "feat: add 15 read-only chat tools for AI assistant"
```

---

### Task 3: Wire tools and page context into the chat route

**Files:**
- Modify: `src/app/api/chat/route.ts`

**Step 1: Update the chat route**

Replace the full file content. Key changes:
- Import `createChatTools` from `./tools`
- Read `pageContext` from request body
- Build dynamic system prompt with page context appended
- Pass tools and `maxSteps: 5` to `streamText`

```typescript
import { streamText, type UIMessage, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createChatTools } from "./tools";

const BASE_SYSTEM_PROMPT = `You are the MGR Brewery Assistant. You help brewers manage their brewery operations.

You have deep knowledge of:
- Brewing science (mashing, fermentation, water chemistry, hop utilization)
- BJCP style guidelines
- Production planning and scheduling
- Inventory management
- Recipe formulation and optimization

You are integrated into the MGR brewery management system. You have access to tools that let you query live brewery data — use them when the user asks about specific recipes, batches, inventory, vessels, or production schedules.

Be concise and practical. When you use a tool, summarize the results clearly. Format data in tables when appropriate.`;

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

async function resolveApiKey(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
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
    maxSteps: 5,
  });

  return result.toUIMessageStreamResponse();
}
```

**Step 2: Verify the dev server compiles**

Run: `npm run dev` (check terminal for compile errors)

**Step 3: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: wire tools and page context into chat route"
```

---

### Task 4: Create ChatProvider context

**Files:**
- Create: `src/contexts/chat-context.tsx`

**Step 1: Create the ChatProvider**

This context manages chat state (messages survive navigation), open/close toggle, page context from URL, and the Cmd+. keyboard shortcut.

```typescript
"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// Page context parsing
// ---------------------------------------------------------------------------

interface PageContext {
  section?: string;
  entityType?: string;
  entityId?: string;
}

/** Map URL path segments to entity types (plural path → singular entity) */
const ENTITY_MAP: Record<string, string> = {
  batches: "batch",
  recipes: "recipe",
  "brew-logs": "brew log",
  vessels: "vessel",
  "yeast-pitches": "yeast pitch",
  "packaging-sessions": "packaging session",
  "finished-goods": "finished good",
  hops: "hop",
  malts: "malt",
  yeasts: "yeast",
  "water-profiles": "water profile",
  "inventory-items": "inventory item",
  "purchase-orders": "purchase order",
  orders: "order",
  customers: "customer",
  "keg-inventory": "keg inventory",
  suppliers: "supplier",
  locations: "location",
};

const SECTIONS = new Set([
  "production",
  "packaging",
  "inventory",
  "purchasing",
  "sales",
  "reports",
]);

function parsePageContext(pathname: string): PageContext | undefined {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;

  const section = SECTIONS.has(segments[0]) ? segments[0] : undefined;
  if (!section) return undefined;

  const entitySegment = segments[1];
  const entityType = entitySegment ? ENTITY_MAP[entitySegment] : undefined;

  // UUID pattern for entity IDs
  const idSegment = segments[2];
  const isUuid = idSegment && /^[0-9a-f-]{36}$/i.test(idSegment);
  const entityId = isUuid ? idSegment : undefined;

  return { section, entityType, entityId };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ChatContextValue {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  chat: UseChatHelpers;
  pageContext: PageContext | undefined;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ChatProviderProps {
  children: ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const pageContext = parsePageContext(pathname);

  const chat = useChat({
    body: { pageContext },
  });

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Cmd+. / Ctrl+. keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "." && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <ChatContext.Provider value={{ isOpen, toggle, close, chat, pageContext }}>
      {children}
    </ChatContext.Provider>
  );
}
```

**Step 2: Commit**

```bash
git add src/contexts/chat-context.tsx
git commit -m "feat: add ChatProvider with session state, page context, and Cmd+. shortcut"
```

---

### Task 5: Wire ChatProvider into app layout and update chat components

**Files:**
- Modify: `src/components/domain/app-providers.tsx` (add ChatProvider)
- Modify: `src/components/domain/chat-layout.tsx` (consume context instead of local state)
- Modify: `src/components/domain/chat-toggle.tsx` (consume context)
- Modify: `src/components/domain/chat-panel.tsx` (consume context + add markdown rendering)

**Step 1: Add ChatProvider to AppProviders**

In `src/components/domain/app-providers.tsx`, add `ChatProvider` as the innermost wrapper:

```typescript
"use client";

import type { ReactNode } from "react";
import { NotificationsProvider } from "@/contexts/notifications";
import { KeyboardShortcutsProvider } from "@/components/domain/keyboard-shortcuts-provider";
import { ChatProvider } from "@/contexts/chat-context";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <NotificationsProvider>
      <KeyboardShortcutsProvider>
        <ChatProvider>{children}</ChatProvider>
      </KeyboardShortcutsProvider>
    </NotificationsProvider>
  );
}
```

**Step 2: Simplify ChatLayout to consume context**

Replace `src/components/domain/chat-layout.tsx`:

```typescript
"use client";

import { ChatPanel } from "@/components/domain/chat-panel";
import { ChatToggle } from "@/components/domain/chat-toggle";

interface ChatLayoutProps {
  children: React.ReactNode;
  header: React.ReactNode;
}

export function ChatLayout({ children, header }: ChatLayoutProps) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center">
        <div className="flex-1">{header}</div>
        <div className="pr-4">
          <ChatToggle />
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
        <ChatPanel />
      </div>
    </div>
  );
}
```

**Step 3: Simplify ChatToggle to consume context**

Replace `src/components/domain/chat-toggle.tsx`:

```typescript
"use client";

import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatContext } from "@/contexts/chat-context";

export function ChatToggle() {
  const { isOpen, toggle } = useChatContext();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={isOpen ? "secondary" : "ghost"}
          size="icon"
          onClick={toggle}
          className="h-8 w-8"
        >
          <MessageCircle className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isOpen ? "Close assistant" : "Open assistant"} (⌘.)
      </TooltipContent>
    </Tooltip>
  );
}
```

**Step 4: Update ChatPanel to consume context and render markdown**

Replace `src/components/domain/chat-panel.tsx`:

```typescript
"use client";

import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, X, Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatContext } from "@/contexts/chat-context";

export function ChatPanel() {
  const { isOpen, close, chat } = useChatContext();
  const { messages, status } = chat;
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isStreaming = status === "streaming";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!input.trim()) return;
    chat.sendMessage({ text: input.trim() });
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="w-96 border-l bg-background flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-accent" />
          <span className="font-medium text-sm">Brewery Assistant</span>
        </div>
        <Button variant="ghost" size="icon" onClick={close} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-8">
            <Bot className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p>Ask me anything about your brewery.</p>
            <p className="mt-1 text-xs">Recipes, batches, inventory, brewing science...</p>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex gap-2",
              message.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {message.role === "assistant" && (
              <div className="flex-shrink-0 h-6 w-6 rounded-full bg-accent/10 flex items-center justify-center mt-0.5">
                <Bot className="h-3.5 w-3.5 text-accent" />
              </div>
            )}
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-sm max-w-[85%]",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  if (message.role === "assistant") {
                    return (
                      <div key={`${message.id}-${i}`} className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {part.text}
                        </ReactMarkdown>
                      </div>
                    );
                  }
                  return (
                    <div key={`${message.id}-${i}`} className="whitespace-pre-wrap">
                      {part.text}
                    </div>
                  );
                }
                if (part.type === "tool-invocation") {
                  return (
                    <div
                      key={`${message.id}-${i}`}
                      className="text-xs text-muted-foreground italic"
                    >
                      {part.toolInvocation.state === "result"
                        ? null
                        : `Looking up data...`}
                    </div>
                  );
                }
                return null;
              })}
            </div>
            {message.role === "user" && (
              <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                <User className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
          </div>
        ))}
        {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-2">
            <div className="flex-shrink-0 h-6 w-6 rounded-full bg-accent/10 flex items-center justify-center">
              <Bot className="h-3.5 w-3.5 text-accent animate-pulse" />
            </div>
            <div className="bg-muted rounded-lg px-3 py-2 text-sm">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your brewery..."
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isStreaming}
            className="flex-shrink-0 h-10 w-10"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
```

**Step 5: Verify the dev server compiles and the page loads**

Run: Visit `http://localhost:3000` in the browser. Chat panel should open/close with the toggle button and with Cmd+.

**Step 6: Commit**

```bash
git add src/components/domain/app-providers.tsx src/components/domain/chat-layout.tsx src/components/domain/chat-toggle.tsx src/components/domain/chat-panel.tsx
git commit -m "feat: session-persistent chat with markdown, page context, and keyboard shortcut"
```

---

### Task 6: Add Cmd+. to keyboard shortcuts help dialog

**Files:**
- Modify: `src/components/domain/keyboard-shortcuts-provider.tsx`

**Step 1: Register the chat shortcut in the help dialog**

The actual Cmd+. handler lives in ChatProvider (it needs to work even when typing in the chat input, so the `isTyping()` guard in `useKeyboardShortcuts` would block it). But we need to register it in the shortcuts list so it appears in the `?` help dialog.

Add a display-only entry to the shortcuts array in `keyboard-shortcuts-provider.tsx`. Since the handler is a no-op (ChatProvider handles the real event), this is purely for discoverability:

In the `useKeyboardShortcuts` call, add this entry:

```typescript
{
  key: ".",
  label: "⌘.",
  description: "Toggle AI assistant",
  modifiers: { meta: true },
  handler: () => {}, // Handled by ChatProvider
},
```

**Step 2: Commit**

```bash
git add src/components/domain/keyboard-shortcuts-provider.tsx
git commit -m "feat: show Cmd+. in keyboard shortcuts help dialog"
```

---

### Task 7: Manual smoke test

**No files changed — verification only.**

**Step 1: Open the app at http://localhost:3000**

**Step 2: Test keyboard shortcut**
- Press Cmd+. — chat panel should open
- Press Cmd+. again — chat panel should close

**Step 3: Test session persistence**
- Open chat, send a message (any question)
- Navigate to a different page (e.g., click Production > Batches)
- Chat panel should still be open with the same messages

**Step 4: Test page context**
- Navigate to a specific batch detail page
- Ask the assistant "What am I looking at?"
- The assistant should reference the batch/section

**Step 5: Test tool use**
- Ask "What's my batch status summary?"
- The assistant should call the `getBatchStatus` tool and return actual data
- Ask "Search for recipes with IPA in the name"
- The assistant should call `searchRecipes` and return results in a markdown table

**Step 6: Test markdown rendering**
- Verify that tool results render with formatted tables, bold text, etc.
- Verify user messages remain plain text

**Step 7: Test ? help dialog**
- Press `?` — the keyboard shortcuts dialog should show ⌘. for "Toggle AI assistant"
