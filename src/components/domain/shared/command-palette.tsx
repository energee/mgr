"use client";

/**
 * Command Palette
 *
 * Global cmd+K / ctrl+K navigation palette. Lists all navigation targets
 * from the shared nav config (`nav-items.ts` — the same source the sidebar
 * uses), grouped by sidebar section, plus Help and (permission-gated)
 * Settings. Selecting an item routes via next/navigation.
 *
 * Mounted once in the authenticated app layout (`src/app/(app)/layout.tsx`)
 * so the keyboard shortcut is registered exactly once globally.
 * Navigation-only by design — no entity search.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/contexts/permissions";
import {
  AnimatedHelpCircle,
  AnimatedSettings,
} from "@/components/icons/animated";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { navigation } from "@/components/domain/shared/nav-items";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { can } = usePermissions();

  // Register the global shortcut. Unlike useKeyboardShortcuts, this fires
  // even while an input is focused — the standard behavior for cmd+K.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Go to page"
      description="Search for a page to navigate to..."
    >
      <CommandInput placeholder="Go to page..." />
      <CommandList>
        <CommandEmpty>No pages found.</CommandEmpty>
        {navigation.map((section) => (
          <CommandGroup key={section.label} heading={section.label}>
            {section.items.map((item) => (
              <CommandItem
                key={item.href}
                // Include the section label so e.g. "reports ttb" matches.
                value={`${section.label} ${item.label}`}
                onSelect={() => navigate(item.href)}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandGroup heading="General">
          <CommandItem value="Help" onSelect={() => navigate("/help")}>
            <AnimatedHelpCircle className="h-4 w-4" />
            <span>Help</span>
          </CommandItem>
          {can("settings:manage") && (
            <CommandItem value="Settings" onSelect={() => navigate("/settings")}>
              <AnimatedSettings className="h-4 w-4" />
              <span>Settings</span>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
