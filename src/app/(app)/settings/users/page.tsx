/**
 * User Management Page
 *
 * List all users with role and activity information.
 */

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EntityList } from "@/components/universal/entity-list";
import { userProfileEntity } from "@/entities/user-profile";
import { entityKeys } from "@/lib/query-keys";
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

interface DeleteTarget {
  id: string;
  name: string;
}

export default function UsersSettingsPage() {
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete user");
      }
    },
    onSuccess: () => {
      toast.success(`User "${deleteTarget?.name}" deleted`);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: entityKeys.list("user_profile") });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <>
      <EntityList
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entity={userProfileEntity as any}
        basePath="/settings/users"
        onAction={(actionName, record) => {
          if (actionName === "delete") {
            const r = record as Record<string, unknown>;
            setDeleteTarget({
              id: r.id as string,
              name: (r.display_name as string) || (r.email as string) || "Unknown",
            });
            return true;
          }
          return false;
        }}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteTarget?.name}&quot; and
              remove their login access. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="outline"
              disabled={deleteMutation.isPending}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
