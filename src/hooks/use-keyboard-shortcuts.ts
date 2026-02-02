"use client";

/**
 * Keyboard Shortcuts Hook
 *
 * Registers global keyboard shortcuts for the app.
 * Shortcuts are suppressed when the user is typing in an input or textarea.
 */

import { useEffect, useCallback, useState } from "react";

export interface KeyboardShortcut {
  key: string;
  label: string;
  description: string;
  handler: () => void;
  /** Whether this shortcut requires modifier keys */
  modifiers?: {
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
  };
}

/**
 * Check if the user is currently typing in an editable element.
 */
function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;

  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;

  return false;
}

/**
 * Hook to register and manage keyboard shortcuts.
 * Returns state and controls for the help dialog.
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const [helpOpen, setHelpOpen] = useState(false);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Allow Escape to always work (for closing dialogs)
      if (event.key === "Escape") {
        const escShortcut = shortcuts.find((s) => s.key === "Escape");
        escShortcut?.handler();
        return;
      }

      // Don't trigger shortcuts when typing
      if (isTyping()) return;

      for (const shortcut of shortcuts) {
        if (shortcut.key === "Escape") continue; // Already handled above

        const matchesKey = event.key === shortcut.key;
        // Check required modifiers are pressed AND unwanted modifiers are not.
        // Shift is excluded from the "no extra modifiers" check because
        // event.key already reflects shift state (e.g. "?" = Shift+/)
        const matchesMods =
          (!!shortcut.modifiers?.ctrl === event.ctrlKey) &&
          (!!shortcut.modifiers?.meta === event.metaKey) &&
          (!shortcut.modifiers?.shift || event.shiftKey) &&
          (!!shortcut.modifiers?.alt === event.altKey);

        if (matchesKey && matchesMods) {
          event.preventDefault();
          shortcut.handler();
          return;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { helpOpen, setHelpOpen };
}

/**
 * Default app-wide shortcuts. Takes callbacks for context-specific behavior.
 */
export function useAppKeyboardShortcuts({
  onShowHelp,
  onFocusSearch,
  onNavigateNew,
}: {
  onShowHelp: () => void;
  onFocusSearch?: () => void;
  onNavigateNew?: () => void;
}) {
  const shortcuts: KeyboardShortcut[] = [
    {
      key: "?",
      label: "?",
      description: "Show keyboard shortcuts",
      handler: onShowHelp,
    },
    {
      key: "Escape",
      label: "Esc",
      description: "Close dialog / clear focus",
      handler: () => {
        // Blur the active element to close popovers, etc.
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      },
    },
  ];

  if (onFocusSearch) {
    shortcuts.push({
      key: "/",
      label: "/",
      description: "Focus search input",
      handler: onFocusSearch,
    });
  }

  if (onNavigateNew) {
    shortcuts.push({
      key: "n",
      label: "n",
      description: "Create new item",
      handler: onNavigateNew,
    });
  }

  return useKeyboardShortcuts(shortcuts);
}
