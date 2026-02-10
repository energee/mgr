"use client";

import { Button } from "@/components/ui/button";
import { ClaudeIcon } from "@/components/ui/claude-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatContext } from "@/contexts/chat-context";

export function ChatToggle() {
  const { isOpen, toggle, chat } = useChatContext();
  const isWorking = chat.status === "submitted" || chat.status === "streaming";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          onClick={toggle}
          className={`group fixed bottom-4 right-4 z-50 h-10 w-10 rounded-full shadow-lg transition-colors ${
            isOpen
              ? "bg-[#D97757] text-white border-[#D97757] hover:bg-[#c56847] hover:text-white"
              : "hover:border-[#D97757]/50"
          }`}
        >
          {isWorking && !isOpen && (
            <span className="absolute inset-0 rounded-full animate-ping bg-[#D97757]/30" />
          )}
          <ClaudeIcon className={`h-5 w-5 transition-transform duration-300 group-hover:scale-75 ${isOpen ? "" : "text-[#D97757]"}`} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        {isOpen ? "Close Claude" : "Ask Claude"} (⌘.)
      </TooltipContent>
    </Tooltip>
  );
}
