"use client";

/**
 * Keyboard Shortcuts Dialog
 *
 * Shows a categorized list of available keyboard shortcuts.
 * Opened by pressing "?" anywhere in the app, or via the sidebar button.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useIsMac } from "@/hooks/use-is-mac";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  const isMac = useIsMac();
  const mod = isMac ? "\u2318" : "Ctrl";

  const groups: ShortcutGroup[] = [
    {
      title: "Global",
      shortcuts: [
        { keys: ["?"], description: "Show this help dialog" },
        { keys: ["/"], description: "Focus search input" },
        { keys: ["Esc"], description: "Close dialog / clear focus" },
        { keys: [mod, "."], description: "Toggle AI assistant" },
      ],
    },
    {
      title: "List Pages",
      shortcuts: [
        { keys: ["N"], description: "Create new entity" },
      ],
    },
    {
      title: "Detail Pages",
      shortcuts: [
        { keys: ["e"], description: "Toggle edit mode" },
        { keys: ["\u232B"], description: "Go back to list" },
        { keys: [mod, "\u21A9"], description: "Save changes" },
        { keys: ["Esc"], description: "Cancel editing" },
      ],
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Quick actions available throughout the app.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-4">
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {group.title}
              </h3>
              <table className="w-full text-sm">
                <tbody>
                  {group.shortcuts.map((shortcut) => (
                    <tr
                      key={shortcut.description}
                      className="border-b last:border-0"
                    >
                      <td className="py-2 pr-4">
                        <KbdGroup>
                          {shortcut.keys.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </KbdGroup>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {shortcut.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
