"use client";

import dynamic from "next/dynamic";
import { ChatToggle } from "@/components/domain/chat-toggle";

const ChatPanel = dynamic(
  () => import("@/components/domain/chat-panel").then((m) => m.ChatPanel),
  { ssr: false }
);

interface ChatLayoutProps {
  children: React.ReactNode;
  header: React.ReactNode;
}

export function ChatLayout({ children, header }: ChatLayoutProps) {
  return (
    <div className="flex-1 flex flex-col">
      {header}
      <div id="main-content" className="flex-1 p-4 md:p-6 overflow-y-auto">{children}</div>
      <ChatPanel />
      <ChatToggle />
    </div>
  );
}
