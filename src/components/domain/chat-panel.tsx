"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Maximize2, Minimize2, ExternalLink } from "lucide-react";
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
} from "@/stores/prefill-store";
import { ClaudeIcon } from "@/components/ui/claude-icon";
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
import { cn } from "@/lib/utils";
import { useChatContext } from "@/contexts/chat-context";

function isNavigationIntent(result: unknown): result is NavigationIntent {
  return (
    typeof result === "object" &&
    result !== null &&
    "action" in result &&
    (result as Record<string, unknown>).action === "navigate"
  );
}

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
            <SheetTitle className="text-sm flex-1">Claude</SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsMaximized((prev) => !prev)}
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
                      if (part.type.startsWith("tool-")) {
                        const toolPart = part as {
                          state: string;
                          output?: unknown;
                        };
                        if (toolPart.state === "output-available") {
                          if (isNavigationIntent(toolPart.output)) {
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
                          return null;
                        }
                        return (
                          <div
                            key={`${message.id}-${i}`}
                            className="text-xs text-muted-foreground italic"
                          >
                            Looking up data...
                          </div>
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
