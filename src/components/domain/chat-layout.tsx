"use client";

import { useState } from "react";
import { ChatPanel } from "@/components/domain/chat-panel";
import { ChatToggle } from "@/components/domain/chat-toggle";

interface ChatLayoutProps {
  children: React.ReactNode;
  header: React.ReactNode;
}

export function ChatLayout({ children, header }: ChatLayoutProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center">
        <div className="flex-1">{header}</div>
        <div className="pr-4">
          <ChatToggle onClick={() => setOpen((prev) => !prev)} open={open} />
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
        <ChatPanel open={open} onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}
