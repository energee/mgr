"use client";

/** Client adapter for the dedicated user deactivate/reactivate API command. */

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { entityKeys } from "@/lib/query-keys";

type Command = "deactivate" | "reactivate";

type CommandTarget = {
  id: string;
  display_name?: string | null;
  email?: string | null;
};

export function useUserAccountStatusCommand() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ id, command }: { id: string; command: Command }) => {
      const response = await fetch(`/api/users/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Unable to update account status");
      }
      return { command };
    },
    onSuccess: ({ command }) => {
      queryClient.invalidateQueries({ queryKey: entityKeys.all("user_profiles") });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("user_profiles_with_details"),
      });
      toast.success(
        command === "deactivate" ? "User deactivated" : "User reactivated",
      );
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleUserStatusAction = useCallback(
    (actionName: string, record: Record<string, unknown>): boolean => {
      if (actionName !== "deactivate" && actionName !== "reactivate") {
        return false;
      }
      const target = record as CommandTarget;
      if (!target.id || mutation.isPending) return true;
      mutation.mutate({ id: target.id, command: actionName });
      return true;
    },
    [mutation],
  );

  return { handleUserStatusAction, isPending: mutation.isPending };
}
