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
