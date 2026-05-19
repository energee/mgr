"use client";

/**
 * Chat Layout
 *
 * Wraps authenticated pages with the collapsible AI chat panel and toggle.
 * ChatPanel is dynamically imported to avoid loading it in the initial bundle.
 */

import dynamic from "next/dynamic";

const ChatPanel = dynamic(
  () => import("@/components/domain/shared/chat-panel").then((m) => m.ChatPanel),
  { ssr: false }
);

type ChatLayoutProps = {
  children: React.ReactNode;
  header: React.ReactNode;
}

export function ChatLayout({ children, header }: ChatLayoutProps) {
  return (
    <div className="flex-1 flex flex-col">
      {header}
      <div id="main-content" className="flex-1 p-4 md:p-6 overflow-y-auto">{children}</div>
      <ChatPanel />
    </div>
  );
}
