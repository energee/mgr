"use client";

/**
 * Keyboard Shortcuts Provider
 *
 * Registers global keyboard shortcuts and renders the help dialog.
 * Added to AppProviders so shortcuts are available on all authenticated pages.
 * Exports KeyboardShortcutsContext so the sidebar can trigger the help dialog.
 */

import { createContext, useState, useCallback, type ReactNode } from "react";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShortcutsDialog } from "@/components/ui/keyboard-shortcuts-dialog";

export const KeyboardShortcutsContext = createContext<{ openHelp: () => void }>({
  openHelp: () => {},
});

type KeyboardShortcutsProviderProps = {
  children: ReactNode;
}

export function KeyboardShortcutsProvider({ children }: KeyboardShortcutsProviderProps) {
  const [helpOpen, setHelpOpen] = useState(false);

  const toggleHelp = useCallback(() => {
    setHelpOpen((prev) => !prev);
  }, []);

  const openHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);

  const focusSearch = useCallback(() => {
    // Find the search input on the page and focus it
    const searchInput = document.querySelector<HTMLInputElement>(
      'input[placeholder*="Search"]'
    );
    if (searchInput) {
      searchInput.focus();
    }
  }, []);

  useKeyboardShortcuts([
    {
      key: "?",
      label: "?",
      description: "Show keyboard shortcuts",
      handler: toggleHelp,
    },
    {
      key: "/",
      label: "/",
      description: "Focus search input",
      handler: focusSearch,
    },
    {
      key: ".",
      label: "⌘.",
      description: "Toggle AI assistant",
      modifiers: { meta: true },
      handler: () => {}, // Handled by ChatProvider
    },
    {
      key: "Escape",
      label: "Esc",
      description: "Close dialog / clear focus",
      handler: () => {
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      },
    },
  ]);

  return (
    <KeyboardShortcutsContext.Provider value={{ openHelp }}>
      {children}
      <KeyboardShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </KeyboardShortcutsContext.Provider>
  );
}
