"use client";

/**
 * Keyboard Shortcuts Dialog
 *
 * Shows all available keyboard shortcuts in a clean table layout.
 * Triggered by pressing "?" anywhere in the app.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const shortcuts = [
  { key: "?", description: "Show this help dialog" },
  { key: "/", description: "Focus search input" },
  { key: "N", description: "Create new (on list pages)" },
  { key: "e", description: "Edit (on detail pages)" },
  { key: "⌫", description: "Go back (on detail pages)" },
  { key: "Esc", description: "Cancel / close dialog" },
];

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Quick actions available throughout the app.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2">
          <table className="w-full text-sm">
            <tbody>
              {shortcuts.map((shortcut) => (
                <tr key={shortcut.key} className="border-b last:border-0">
                  <td className="py-2.5 pr-4">
                    <kbd className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded border bg-muted text-xs font-mono font-medium">
                      {shortcut.key}
                    </kbd>
                  </td>
                  <td className="py-2.5 text-muted-foreground">
                    {shortcut.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
