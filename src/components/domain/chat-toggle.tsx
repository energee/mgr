"use client";

import { Button } from "@/components/ui/button";
import { ClaudeIcon } from "@/components/ui/claude-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatContext } from "@/contexts/chat-context";

export function ChatToggle() {
  const { isOpen, toggle } = useChatContext();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="h-8 w-8"
        >
          <ClaudeIcon
            className={`h-4 w-4 transition-colors ${isOpen ? "text-[#D97757]" : "text-muted-foreground"}`}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {isOpen ? "Close Claude" : "Ask Claude"} (⌘.)
      </TooltipContent>
    </Tooltip>
  );
}
