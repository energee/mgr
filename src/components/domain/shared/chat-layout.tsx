"use client";

/**
 * Chat Layout
 *
 * Wraps authenticated pages with the collapsible AI chat panel and toggle.
 * ChatPanel uses React.lazy + explicit <Suspense> — next/dynamic(ssr:false) emits
 * an implicit Suspense at the wrong sibling position in server HTML (MGR-6).
 */

import { lazy, Suspense } from "react";
import { ErrorBoundary } from "@/components/ui/error-boundary";

const ChatPanel = lazy(() =>
  import("@/components/domain/shared/chat-panel").then((m) => ({ default: m.ChatPanel }))
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
      <ErrorBoundary fallback={<></>}>
        <Suspense fallback={null}>
          <ChatPanel />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
