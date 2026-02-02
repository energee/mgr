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
