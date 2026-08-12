"use client";

/**
 * Text prompt input for the AI chat panel: PromptInput (form wrapper),
 * PromptInputTextarea (Enter-to-submit textarea), PromptInputFooter, and
 * PromptInputSubmit (submit/stop button that reflects chat status). Trimmed
 * to the text-only surface chat-panel.tsx uses — attachments, providers,
 * model select, command palette, tabs, and hover cards were removed.
 */

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ChatStatus } from "ai";
import { ArrowUpIcon, SquareIcon, XIcon } from "lucide-react";
import type {
  ComponentProps,
  FormEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
  MouseEvent,
} from "react";

export type PromptInputMessage = {
  text: string;
}

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit"
> & {
  onSubmit: (message: PromptInputMessage) => void;
};

export const PromptInput = ({
  className,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const text = (new FormData(form).get("message") as string) || "";
    // Reset immediately after capturing text so the field clears on submit.
    form.reset();
    onSubmit({ text });
  };

  return (
    <form
      className={cn("w-full", className)}
      onSubmit={handleSubmit}
      {...props}
    >
      <InputGroup className="overflow-hidden">{children}</InputGroup>
    </form>
  );
};

export type PromptInputTextareaProps = ComponentProps<
  typeof InputGroupTextarea
>;

// Submit on Enter (Shift+Enter inserts a newline; Enter during IME
// composition is ignored so it confirms the composition instead).
const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) {
    return;
  }
  e.preventDefault();
  e.currentTarget.form?.requestSubmit();
};

export const PromptInputTextarea = ({
  className,
  placeholder = "What would you like to know?",
  ...props
}: PromptInputTextareaProps) => (
  <InputGroupTextarea
    className={cn("field-sizing-content max-h-48 min-h-16", className)}
    name="message"
    onKeyDown={handleKeyDown}
    placeholder={placeholder}
    {...props}
  />
);

export type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputFooter = ({
  className,
  ...props
}: PromptInputFooterProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("justify-between gap-1", className)}
    {...props}
  />
);

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  status,
  onStop,
  onClick,
  ...props
}: PromptInputSubmitProps) => {
  const isGenerating = status === "submitted" || status === "streaming";

  let icon = <ArrowUpIcon className="size-4" />;

  if (status === "submitted") {
    icon = <Spinner />;
  } else if (status === "streaming") {
    icon = <SquareIcon className="size-4" />;
  } else if (status === "error") {
    icon = <XIcon className="size-4" />;
  }

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (isGenerating && onStop) {
      e.preventDefault();
      onStop();
      return;
    }
    onClick?.(e);
  };

  return (
    <InputGroupButton
      aria-label={isGenerating ? "Stop" : "Submit"}
      className={className}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? "button" : "submit"}
      variant={variant}
      {...props}
    >
      {icon}
    </InputGroupButton>
  );
};
