"use client";

/**
 * Conflict Dialog
 *
 * Shown when a concurrent modification conflict is detected.
 * Provides options to refresh data or discard changes.
 */

import { useState, useCallback } from "react";
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
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ConflictDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when the dialog should close */
  onOpenChange: (open: boolean) => void;
  /** Called when user chooses to refresh data */
  onRefresh: () => void;
  /** Called when user chooses to discard their changes */
  onDiscard: () => void;
  /** Optional custom title */
  title?: string;
  /** Optional custom description */
  description?: string;
  /** Whether refresh is in progress */
  isRefreshing?: boolean;
}

export function ConflictDialog({
  open,
  onOpenChange,
  onRefresh,
  onDiscard,
  title = "Record Modified",
  description = "This record was modified by another user while you were editing. Your changes cannot be saved.",
  isRefreshing = false,
}: ConflictDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-4 p-4 bg-muted rounded-lg">
          <p className="text-sm font-medium mb-2">What would you like to do?</p>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>
              <strong>Refresh</strong> - Load the latest data and re-apply your changes
              manually
            </li>
            <li>
              <strong>Discard</strong> - Abandon your changes and go back
            </li>
          </ul>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDiscard} disabled={isRefreshing}>
            Discard Changes
          </AlertDialogCancel>
          <AlertDialogAction onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Refreshing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Data
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Hook for managing conflict dialog state
 */
export function useConflictDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const showConflict = useCallback(() => {
    setIsOpen(true);
  }, []);

  const hideConflict = useCallback(() => {
    setIsOpen(false);
    setIsRefreshing(false);
  }, []);

  return {
    isOpen,
    isRefreshing,
    setIsRefreshing,
    showConflict,
    hideConflict,
    setIsOpen,
  };
}
