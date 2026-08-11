"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { isToolUIPart } from "ai";
import type { ToolUIPart, DynamicToolUIPart } from "ai";
import {
  User,
  Maximize2,
  Minimize2,
  ExternalLink,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  usePrefillStore,
  type NavigationIntent,
} from "@/contexts/prefill-store";
import { ClaudeIcon } from "@/components/ui/claude-icon";
import { ClaudeWordmark } from "@/components/ui/claude-wordmark";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { cn } from "@/lib/utils";
import { useChatContext } from "@/contexts/chat-context";
import { batchKeys } from "@/lib/query-keys";
import type { ConfirmWriteIntent } from "@/lib/schemas/chat-write";

function isNavigationIntent(result: unknown): result is NavigationIntent {
  return (
    typeof result === "object" &&
    result !== null &&
    "action" in result &&
    (result as Record<string, unknown>).action === "navigate"
  );
}

function isConfirmWriteIntent(result: unknown): result is ConfirmWriteIntent {
  return (
    typeof result === "object" &&
    result !== null &&
    "action" in result &&
    (result as Record<string, unknown>).action === "confirm_write"
  );
}

type ConfirmWriteStatus = "idle" | "saving" | "saved" | "dismissed";

/**
 * Confirmation gate for AI-proposed writes (Phase 4C). The tool only
 * proposed the write; nothing is persisted until the user clicks Confirm,
 * which POSTs the pending payload to /api/chat/write (executed under the
 * user's session, so RLS is the authority).
 *
 * ponytail: status lives in component state, so a remount (panel closed and
 * reopened mid-conversation) re-offers Confirm on an already-saved card;
 * readings are append-only, worst case is a duplicate reading the user can
 * delete. Persist confirmed toolCallIds in the chat context if that bites.
 */
function ConfirmWriteCard({ intent }: { intent: ConfirmWriteIntent }) {
  const [status, setStatus] = useState<ConfirmWriteStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const confirm = async () => {
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/chat/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          writeAction: intent.writeAction,
          params: intent.params,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      setStatus("saved");
      queryClient.invalidateQueries({
        queryKey: batchKeys.readings(intent.params.batchId),
      });
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  return (
    <div className="rounded-lg border bg-muted/50 p-3 text-sm">
      <p className="mb-2 text-foreground">{intent.description}</p>
      {status === "saved" ? (
        <p className="flex items-center gap-1.5 text-emerald-600">
          <Check className="h-3.5 w-3.5" /> Saved
        </p>
      ) : status === "dismissed" ? (
        <p className="text-muted-foreground">Dismissed — nothing was saved.</p>
      ) : (
        <>
          {error && <p className="mb-2 text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={confirm} disabled={status === "saving"}>
              {status === "saving" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatus("dismissed")}
              disabled={status === "saving"}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const TOOL_TITLES: Record<string, string> = {
  // Generic entity tools
  searchEntity: "Search",
  getEntityDetail: "Get Details",
  // RPC / analysis tools
  analyzeRecipe: "Analyze Recipe",
  getRecipeSummary: "Recipe Summary",
  suggestImprovements: "Suggest Improvements",
  analyzeBatch: "Analyze Batch",
  getInventoryOverview: "Inventory Overview",
  // Specialized query tools
  getBatchStatus: "Batch Status",
  getVesselAvailability: "Vessel Availability",
  getProductionSchedule: "Production Schedule",
  getIngredientInventory: "Ingredient Inventory",
  getBatchLogs: "Batch Logs",
  getVesselCleanings: "Vessel Cleanings",
  getBatchTransfers: "Batch Transfers",
  getRecipeCost: "Recipe Cost",
  getLotExpiration: "Lot Expiration",
  getFinishedGoods: "Finished Goods",
  getKegInventory: "Keg Inventory",
  // Utility tools
  lookupEntity: "Lookup Entity",
  getAppGuide: "App Guide",
  // Navigation tools
  createBatch: "Create Batch",
  transitionBatch: "Transition Batch",
  addBatchReading: "Add Reading",
  createPackagingSession: "Create Packaging Session",
  // Confirm-gated write tools
  recordBatchReading: "Record Reading",
};

export function ChatPanel() {
  const { isOpen, close, chat } = useChatContext();
  const { messages, status } = chat;
  const [isMaximized, setIsMaximized] = useState(false);
  const router = useRouter();
  const setPrefill = usePrefillStore((s) => s.setPrefill);
  const isStreaming = status === "streaming";

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => !open && close()}
      modal={false}
    >
      <SheetContent
        side="right"
        overlay={false}
        className={cn(
          "flex flex-col p-0 gap-0 transition-[width,max-width] duration-200",
          isMaximized
            ? "w-[50vw] sm:max-w-[50vw]"
            : "w-96 sm:max-w-96"
        )}
      >
        <SheetHeader className="px-4 py-3 border-b space-y-0">
          <div className="flex items-center gap-2 pr-8">
            <ClaudeIcon className="h-4 w-4 text-[#D97757]" />
            <SheetTitle className="flex-1">
              <ClaudeWordmark />
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsMaximized((prev) => !prev)}
              aria-label={isMaximized ? "Minimize chat" : "Maximize chat"}
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <SheetDescription className="sr-only">
            AI assistant for brewery management
          </SheetDescription>
        </SheetHeader>

        <Conversation>
          <ConversationContent className="gap-4 p-4">
            {messages.length === 0 && (
              <ConversationEmptyState
                icon={
                  <ClaudeIcon className="h-8 w-8 text-[#D97757]/50" />
                }
                title="Ask me anything about your brewery."
                description="Recipes, batches, inventory, brewing science..."
              />
            )}
            {messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <div
                  className={cn(
                    "flex gap-2",
                    message.role === "user"
                      ? "justify-end"
                      : "justify-start"
                  )}
                >
                  {message.role === "assistant" && (
                    <div className="flex-shrink-0 h-6 w-6 rounded-full bg-[#D97757]/10 flex items-center justify-center mt-0.5">
                      <ClaudeIcon className="h-3.5 w-3.5 text-[#D97757]" />
                    </div>
                  )}
                  <MessageContent>
                    {message.parts.map((part, i) => {
                      if (part.type === "text") {
                        if (message.role === "assistant") {
                          return (
                            <MessageResponse
                              key={`${message.id}-${i}`}
                            >
                              {part.text}
                            </MessageResponse>
                          );
                        }
                        return (
                          <div
                            key={`${message.id}-${i}`}
                            className="whitespace-pre-wrap"
                          >
                            {part.text}
                          </div>
                        );
                      }
                      if (isToolUIPart(part)) {
                        const toolPart = part as
                          | ToolUIPart
                          | DynamicToolUIPart;

                        // ConfirmWriteIntent outputs render as confirm cards
                        if (
                          toolPart.state === "output-available" &&
                          isConfirmWriteIntent(toolPart.output)
                        ) {
                          return (
                            <ConfirmWriteCard
                              key={`${message.id}-${i}`}
                              intent={toolPart.output}
                            />
                          );
                        }

                        // NavigationIntent outputs render as action cards
                        if (
                          toolPart.state === "output-available" &&
                          isNavigationIntent(toolPart.output)
                        ) {
                          const intent = toolPart.output;
                          return (
                            <div
                              key={`${message.id}-${i}`}
                              className="rounded-lg border bg-muted/50 p-3 text-sm"
                            >
                              <p className="mb-2 text-foreground">
                                {intent.description}
                              </p>
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => {
                                  if (
                                    intent.prefillData ||
                                    intent.openDialog
                                  ) {
                                    setPrefill(
                                      intent.prefillData ?? {},
                                      intent.openDialog
                                    );
                                  }
                                  router.push(intent.url);
                                  close();
                                }}
                              >
                                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                Open Form
                              </Button>
                            </div>
                          );
                        }

                        // All other tool calls render with the Tool component
                        const toolName =
                          toolPart.type === "dynamic-tool"
                            ? toolPart.toolName
                            : toolPart.type.split("-").slice(1).join("-");
                        const title = TOOL_TITLES[toolName] ?? toolName;
                        return (
                          <Tool
                            key={`${message.id}-${i}`}
                            defaultOpen={toolPart.state === "output-error"}
                          >
                            {toolPart.type === "dynamic-tool" ? (
                              <ToolHeader
                                type={toolPart.type}
                                state={toolPart.state}
                                toolName={toolPart.toolName}
                                title={title}
                              />
                            ) : (
                              <ToolHeader
                                type={toolPart.type}
                                state={toolPart.state}
                                title={title}
                              />
                            )}
                            <ToolContent>
                              <ToolInput input={toolPart.input} />
                              {(toolPart.state === "output-available" ||
                                toolPart.state === "output-error") && (
                                <ToolOutput
                                  output={toolPart.output}
                                  errorText={toolPart.errorText}
                                />
                              )}
                            </ToolContent>
                          </Tool>
                        );
                      }
                      return null;
                    })}
                  </MessageContent>
                  {message.role === "user" && (
                    <div className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                      <User className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}
                </div>
              </Message>
            ))}
            {isStreaming &&
              messages[messages.length - 1]?.role !== "assistant" && (
                <div className="flex gap-2">
                  <div className="flex-shrink-0 h-6 w-6 rounded-full bg-[#D97757]/10 flex items-center justify-center">
                    <ClaudeIcon className="h-3.5 w-3.5 text-[#D97757] animate-pulse" />
                  </div>
                  <div className="bg-muted rounded-lg px-3 py-2 text-sm">
                    <span className="animate-pulse">Thinking...</span>
                  </div>
                </div>
              )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t p-3">
          <PromptInput
            onSubmit={(message) => {
              if (!message.text.trim()) return;
              chat.sendMessage({ text: message.text.trim() });
            }}
          >
            <PromptInputTextarea
              placeholder="Ask Claude..."
              className="min-h-[40px] max-h-[120px]"
            />
            <PromptInputFooter>
              <div />
              <PromptInputSubmit
                status={status}
                onStop={() => chat.stop()}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </SheetContent>
    </Sheet>
  );
}
