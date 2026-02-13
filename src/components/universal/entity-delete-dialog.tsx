"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
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
import { toast } from "sonner";

interface EntityDeleteDialogProps {
  entityTable: string;
  entityDisplayName: string;
  recordId: string;
  recordTitle: string;
  deleteMode: "hard" | "soft";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EntityDeleteDialog({
  entityTable,
  entityDisplayName,
  recordId,
  recordTitle,
  deleteMode,
  open,
  onOpenChange,
  onSuccess,
}: EntityDeleteDialogProps) {
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const isSoft = deleteMode === "soft";
  const verb = isSoft ? "Deactivate" : "Delete";
  const verbing = isSoft ? "Deactivating..." : "Deleting...";

  const mutation = useMutation({
    mutationFn: async () => {
      if (isSoft) {
        const { error } = await supabase
          .from(entityTable)
          .update({ is_active: false } as Record<string, unknown>)
          .eq("id", recordId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from(entityTable)
          .delete()
          .eq("id", recordId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      const pastVerb = isSoft ? "deactivated" : "deleted";
      toast.success(`${entityDisplayName} "${recordTitle}" ${pastVerb}`);
      onOpenChange(false);
      onSuccess();
    },
    onError: (err: unknown) => {
      const pgError = err as { code?: string; message?: string };
      if (pgError.code === "23503") {
        setError(
          `Cannot delete — this ${entityDisplayName.toLowerCase()} is referenced by other records.`
        );
      } else {
        setError(pgError.message ?? "An unexpected error occurred");
      }
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {verb} {entityDisplayName.toLowerCase()}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSoft
              ? `This will deactivate "${recordTitle}". It will be hidden from lists and dropdowns but preserved for historical records.`
              : `This will permanently delete "${recordTitle}". This action cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" disabled={mutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? verbing : verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
