# AI Chat Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a right-side chat panel using Vercel AI SDK + AI Elements so users can converse with an AI assistant while viewing any page.

**Architecture:** Install AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`) and AI Elements chatbot components. Create a `/api/chat` route that streams responses from Claude with brewery-specific system prompt and tools. Add a collapsible right-side panel to the app layout with a toggle button in the header.

**Tech Stack:** Vercel AI SDK 6, AI Elements (shadcn registry), Anthropic Claude, Next.js App Router streaming

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install AI SDK packages**

Run in the worktree (`/Users/tedslesinski/Repos/mgr/.worktrees/feat-ai-chat`):

```bash
bun add ai @ai-sdk/react @ai-sdk/anthropic
```

**Step 2: Install AI Elements chatbot components**

```bash
npx ai-elements@latest add conversation message
```

If the CLI prompts for config, accept defaults. Components will be added to `src/components/ai-elements/`.

If `ai-elements` CLI doesn't work or requires interactive input, use the shadcn registry approach instead:

```bash
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/conversation.json
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/message.json
```

**Step 3: Verify installation**

```bash
ls src/components/ai-elements/
```

Expected: `conversation/` and `message/` directories (or similar files).

**Step 4: Commit**

```bash
git add package.json bun.lock src/components/ai-elements/
git commit -m "chore: install ai sdk and ai-elements chatbot components"
```

---

### Task 2: Add chat query keys

**Files:**
- Modify: `src/lib/query-keys.ts`

**Step 1: Add chat key factory**

Add to the end of `src/lib/query-keys.ts`, before the final line:

```typescript
// =============================================================================
// Chat Keys
// =============================================================================

export const chatKeys = {
  all: () => ["chat"] as const,
  messages: () => ["chat", "messages"] as const,
};
```

**Step 2: Run tests**

```bash
bun test
```

Expected: All 262 tests pass (query-keys tests still pass).

**Step 3: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat: add chat query key factory"
```

---

### Task 3: Create the API route

**Files:**
- Create: `src/app/api/chat/route.ts`

**Step 1: Create the chat API route**

```typescript
import { streamText, UIMessage, convertToModelMessages, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

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
```

Note: The `ANTHROPIC_API_KEY` env var must be set. The AI SDK reads it automatically.

**Step 2: Verify the route compiles**

```bash
bun typecheck
```

Expected: No type errors.

**Step 3: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: add /api/chat streaming route with Anthropic"
```

---

### Task 4: Create the chat panel component

**Files:**
- Create: `src/components/domain/chat-panel.tsx`

This is the main chat UI component — a right-side panel with message list and input.

**Step 1: Create the chat panel**

```typescript
"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, X, Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input.trim() });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const isStreaming = status === "streaming";

  if (!open) return null;

  return (
    <div className="w-96 border-l bg-background flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-accent" />
          <span className="font-medium text-sm">Brewery Assistant</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
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
                  return (
                    <div key={`${message.id}-${i}`} className="whitespace-pre-wrap">
                      {part.text}
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

      {/* Input */}
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

Note: We build this from existing shadcn primitives (Button, Textarea) rather than AI Elements message/conversation components initially. This keeps it simple and matches the existing design system. AI Elements can be layered in later for markdown rendering, code blocks, and tool call display.

**Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: No type errors.

**Step 3: Commit**

```bash
git add src/components/domain/chat-panel.tsx
git commit -m "feat: add chat panel component with message list and input"
```

---

### Task 5: Integrate chat panel into app layout

**Files:**
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/components/domain/app-header.tsx`
- Create: `src/components/domain/chat-toggle.tsx`

**Step 1: Create the chat toggle button**

Create `src/components/domain/chat-toggle.tsx`:

```typescript
"use client";

import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ChatToggleProps {
  onClick: () => void;
  open: boolean;
}

export function ChatToggle({ onClick, open }: ChatToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={open ? "secondary" : "ghost"}
          size="icon"
          onClick={onClick}
          className="h-8 w-8"
        >
          <MessageCircle className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {open ? "Close assistant" : "Open assistant"}
      </TooltipContent>
    </Tooltip>
  );
}
```

**Step 2: Create a client wrapper for the layout chat state**

Since the app layout is a server component, we need a client component that manages the chat open/close state and wraps the main content area.

Create `src/components/domain/chat-layout.tsx`:

```typescript
"use client";

import { useState } from "react";
import { ChatPanel } from "@/components/domain/chat-panel";
import { ChatToggle } from "@/components/domain/chat-toggle";

export function useChatLayout() {
  const [open, setOpen] = useState(false);
  return { open, toggle: () => setOpen((v) => !v), close: () => setOpen(false) };
}

interface ChatLayoutProps {
  children: React.ReactNode;
  header: React.ReactNode;
}

export function ChatLayout({ children, header }: ChatLayoutProps) {
  const { open, toggle, close } = useChatLayout();

  return (
    <div className="flex-1 flex flex-col">
      {/* Header with chat toggle injected */}
      <div className="flex items-center">
        <div className="flex-1">{header}</div>
        <div className="pr-4">
          <ChatToggle onClick={toggle} open={open} />
        </div>
      </div>
      {/* Content + Chat Panel */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
        <ChatPanel open={open} onClose={close} />
      </div>
    </div>
  );
}
```

**Step 3: Update the app layout**

Modify `src/app/(app)/layout.tsx` to use `ChatLayout`:

Replace the current return with:

```typescript
import { ChatLayout } from "@/components/domain/chat-layout";

// ... existing imports and auth check ...

return (
  <AppProviders>
    <div className="flex min-h-screen">
      <AppSidebar />
      <ChatLayout header={<AppHeader user={user} breweryName={breweryName} />}>
        {children}
      </ChatLayout>
    </div>
  </AppProviders>
);
```

Remove the old `<div className="flex-1 flex flex-col">`, `<AppHeader>`, and `<main>` wrapping — `ChatLayout` handles all of that now.

**Step 4: Run typecheck and dev server**

```bash
bun typecheck
```

Expected: No type errors.

**Step 5: Commit**

```bash
git add src/components/domain/chat-toggle.tsx src/components/domain/chat-layout.tsx src/app/\(app\)/layout.tsx
git commit -m "feat: integrate chat panel into app layout with toggle button"
```

---

### Task 6: Add ANTHROPIC_API_KEY to env

**Files:**
- Modify: `.env.local` (local only, never committed)

**Step 1: Add the API key**

```bash
echo "ANTHROPIC_API_KEY=your-key-here" >> .env.local
```

The user must replace `your-key-here` with their actual Anthropic API key.

**Step 2: Verify the env var is loaded**

Start the dev server and open the chat panel. Send a test message. If you get a streaming response, it works.

```bash
bun dev
```

No commit for this step (env files are gitignored).

---

### Task 7: Manual smoke test

**No files changed — verification only.**

**Step 1: Start dev server**

```bash
bun dev
```

**Step 2: Verify chat toggle**

- Navigate to any page (e.g., `/production/batches`)
- The chat toggle button (MessageCircle icon) should appear in the header, right side
- Click it — the chat panel should slide in from the right
- Click again — it should close

**Step 3: Verify chat functionality**

- Open the chat panel
- Type "What styles of beer have the highest IBU?" and press Enter
- The message should appear as a user bubble on the right
- A streaming response should appear as an assistant bubble on the left
- The response should auto-scroll as it streams

**Step 4: Verify layout**

- With the chat panel open, the main content area should still be visible and scrollable
- The panel should be 384px wide (w-96)
- The panel should fill the full height between header and bottom

**Step 5: Run all tests**

```bash
bun test
```

Expected: All 262 tests still pass.

---

## Post-MVP Enhancements (not in scope)

These can be added later in separate PRs:

- **Markdown rendering** in assistant messages (via AI Elements `message` component)
- **Tool calls** — expose `analyzeStyleCompliance`, `getRecipeSummary`, etc. as AI SDK tools so the assistant can query live brewery data
- **Page context** — pass current page/entity info to the system prompt so the assistant knows what you're looking at
- **Chat persistence** — save chat history to Supabase
- **Keyboard shortcut** — `Cmd+K` or similar to toggle the panel
