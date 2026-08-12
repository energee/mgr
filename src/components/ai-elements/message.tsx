"use client";

/**
 * Chat message primitives for the AI chat panel: Message (row alignment by
 * role), MessageContent (bubble styling), and MessageResponse (streaming
 * markdown via Streamdown). Trimmed to the components chat-panel.tsx uses —
 * branch navigation, toolbars, and per-message actions were removed.
 */

import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  />
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

// Module-level so the object keeps a stable identity — Streamdown's memo
// compares `plugins` by reference, and a per-render literal would force every
// plugin-consuming descendant to re-render on each streaming chunk.
const STREAMDOWN_PLUGINS = { code, mermaid, math, cjk };

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      plugins={STREAMDOWN_PLUGINS}
      {...props}
    />
  ),
  // Re-render only when the streamed markdown changes; className and plugins
  // are stable for the chat panel's lifetime.
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

MessageResponse.displayName = "MessageResponse";
