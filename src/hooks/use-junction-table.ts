"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys, entityKeys } from "@/lib/query-keys";

interface UseJunctionTableOptions {
  table: string;
  recipeId: string;
  select?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable = any;

export function useJunctionTable<T extends { id?: string }>({
  table,
  recipeId,
  select = "*",
}: UseJunctionTableOptions) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: recipeKeys.junction(recipeId, table),
    });
    queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
    queryClient.invalidateQueries({ queryKey: recipeKeys.cogs(recipeId) });
    queryClient.invalidateQueries({
      queryKey: entityKeys.all("recipes_with_estimates"),
    });
  };

  const query = useQuery({
    queryKey: recipeKeys.junction(recipeId, table),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table as AnyTable)
        .select(select)
        .eq("recipe_id", recipeId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as T[];
    },
    enabled: !!recipeId,
  });

  const addMutation = useMutation({
    mutationFn: async (row: Omit<T, "id">) => {
      const { data, error } = await supabase
        .from(table as AnyTable)
        .insert({ ...row, recipe_id: recipeId } as AnyTable)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as T;
    },
    onSuccess: invalidateAll,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, fields }: { id: string; fields: Partial<T> }) => {
      const { error } = await supabase
        .from(table as AnyTable)
        .update(fields as AnyTable)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from(table as AnyTable)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async (updates: { id: string; fields: Partial<T> }[]) => {
      for (const { id, fields } of updates) {
        const { error } = await supabase
          .from(table as AnyTable)
          .update(fields as AnyTable)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: invalidateAll,
  });

  return {
    items: (query.data ?? []) as T[],
    isLoading: query.isLoading,
    error: query.error,
    add: addMutation.mutate,
    addAsync: addMutation.mutateAsync,
    update: updateMutation.mutate,
    remove: removeMutation.mutate,
    bulkUpdate: bulkUpdateMutation.mutate,
    isAdding: addMutation.isPending,
    isUpdating: updateMutation.isPending,
    isRemoving: removeMutation.isPending,
  };
}
