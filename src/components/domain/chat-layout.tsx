"use client";

import { ChatPanel } from "@/components/domain/chat-panel";

interface ChatLayoutProps {
  children: React.ReactNode;
  header: React.ReactNode;
}

export function ChatLayout({ children, header }: ChatLayoutProps) {
  return (
    <div className="flex-1 flex flex-col">
      {header}
      <main className="flex-1 p-4 md:p-6 overflow-y-auto">{children}</main>
      <ChatPanel />
    </div>
  );
}
