"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";
import type { Database } from "@/types/supabase";

type RecipeUpdate = Database["public"]["Tables"]["recipes"]["Update"];

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

interface UseRecipeAutoSaveOptions {
  recipeId: string;
  delay?: number;
}

export function useRecipeAutoSave({
  recipeId,
  delay = 1500,
}: UseRecipeAutoSaveOptions) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const pendingChanges = useRef<Partial<RecipeUpdate>>({});
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation({
    mutationFn: async (fields: Partial<RecipeUpdate>) => {
      const { error } = await supabase
        .from("recipes")
        .update(fields)
        .eq("id", recipeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.cogs(recipeId) });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("recipes_with_estimates"),
      });
      setStatus("saved");
      // Clear "saved" after 2 seconds
      savedTimeoutRef.current = setTimeout(() => setStatus("idle"), 2000);
    },
    onError: () => {
      setStatus("error");
    },
  });

  const flush = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const changes = { ...pendingChanges.current };
    if (Object.keys(changes).length > 0) {
      pendingChanges.current = {};
      setStatus("saving");
      mutation.mutate(changes);
    }
  }, [mutation]);

  const updateFields = useCallback(
    (fields: Partial<RecipeUpdate>) => {
      Object.assign(pendingChanges.current, fields);

      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current);
        savedTimeoutRef.current = null;
      }
      setStatus("pending");

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        const changes = { ...pendingChanges.current };
        pendingChanges.current = {};
        if (Object.keys(changes).length > 0) {
          setStatus("saving");
          mutation.mutate(changes);
        }
      }, delay);
    },
    [delay, mutation]
  );

  // Flush on unmount or navigation
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (Object.keys(pendingChanges.current).length > 0) {
        flush();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      // Flush remaining changes on unmount
      const changes = { ...pendingChanges.current };
      if (Object.keys(changes).length > 0) {
        pendingChanges.current = {};
        supabase
          .from("recipes")
          .update(changes)
          .eq("id", recipeId)
          .then(() => {
            queryClient.invalidateQueries({
              queryKey: recipeKeys.detail(recipeId),
            });
          });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  const retry = useCallback(() => {
    setStatus("saving");
    // Re-flush whatever was last attempted
    flush();
  }, [flush]);

  return { updateFields, flush, retry, status };
}
