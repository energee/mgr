"use client";

/**
 * EntityActionConfirmDialog — shared confirmation gate for entity actions
 * declared with `confirm: true` (EntityActionDef.confirm).
 *
 * Rendered by every action surface so the flag is honored consistently:
 * - entity-detail-unified.tsx (header buttons + Actions dropdown, including
 *   raw "Move to {state}" items whose target matches a confirm action)
 * - entity-data-table.tsx (desktop row menu via buildActionsColumn's
 *   onConfirmRequired callback, and the mobile card menu via
 *   EntityMobileCardList's onConfirmAction prop)
 *
 * Mirrors the callback-to-dialog plumbing of the delete flow
 * (EntityDeleteDialog): the caller owns open state and runs the action only
 * after the user confirms.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type EntityActionConfirmDialogProps = {
  /** Display label of the action being confirmed (e.g. "Cancel Order") */
  actionLabel: string;
  /** Title of the record the action applies to (e.g. order number) */
  recordTitle: string;
  /** Style the confirm button destructively (action.variant === "destructive") */
  destructive?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Run the action — only called after the user confirms */
  onConfirm: () => void;
};

export function EntityActionConfirmDialog({
  actionLabel,
  recordTitle,
  destructive,
  open,
  onOpenChange,
  onConfirm,
}: EntityActionConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{actionLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to apply &quot;{actionLabel}&quot; to{" "}
            <span className="font-medium text-foreground">{recordTitle}</span>.
            This may not be reversible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
