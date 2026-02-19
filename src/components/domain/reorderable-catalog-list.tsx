/**
 * Reorderable Catalog List
 *
 * A compact table for catalog items (keg types, keg owners, etc.) with
 * up/down reorder handles that persist position via Supabase.
 * Replaces EntityList when manual ordering is needed.
 */

"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys } from "@/lib/query-keys";
import { toast } from "sonner";
import Link from "next/link";
import { Plus } from "lucide-react";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Column {
  key: string;
  header: string;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
}

interface ReorderableCatalogListProps {
  /** Supabase table name */
  table: string;
  /** Columns to display */
  columns: Column[];
  /** Base path for detail links (row click navigates to basePath/[id]) */
  basePath: string;
  /** Display name for the create button */
  displayName: string;
  /** Optional filter (e.g., { is_active: true }) */
  filter?: Record<string, unknown>;
}

export function ReorderableCatalogList({
  table,
  columns,
  basePath,
  displayName,
  filter,
}: ReorderableCatalogListProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const queryKey = entityKeys.list(table, { _ordered: true, ...filter });

  const { data: items, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      // Dynamic table name requires cast — component is generic across tables
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase as any)
        .from(table)
        .select("*")
        .order("position", { nullsFirst: false })
        .order("name");

      if (filter) {
        for (const [key, value] of Object.entries(filter)) {
          query = query.eq(key, value as string);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Record<string, unknown>[];
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ updates }: { updates: { id: string; position: number }[] }) => {
      for (const { id, position } of updates) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from(table)
          .update({ position })
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast.error("Failed to reorder");
    },
  });

  const handleMove = useCallback(
    (index: number, direction: "up" | "down") => {
      if (!items) return;
      if (direction === "up" && index === 0) return;
      if (direction === "down" && index === items.length - 1) return;

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      const updated = [...items];
      [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];

      // Persist new positions
      const positionUpdates = updated.map((item, i) => ({
        id: item.id as string,
        position: i,
      }));

      reorderMutation.mutate({ updates: positionUpdates });
    },
    [items, reorderMutation]
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href={`${basePath}/new`}>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Add {displayName}
          </Button>
        </Link>
      </div>

      {!items?.length ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No {displayName.toLowerCase()}s found.
        </p>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]" />
                {columns.map((col) => (
                  <TableHead key={col.key}>{col.header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item.id as string} className="group">
                  <TableCell className="py-1">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleMove(index, "up")}
                        disabled={reorderMutation.isPending || index === 0}
                        className="p-0.5 hover:bg-muted rounded disabled:opacity-30"
                      >
                        <GripVertical className="h-3 w-3 rotate-180" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(index, "down")}
                        disabled={reorderMutation.isPending || index === items.length - 1}
                        className="p-0.5 hover:bg-muted rounded disabled:opacity-30"
                      >
                        <GripVertical className="h-3 w-3" />
                      </button>
                    </div>
                  </TableCell>
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Link
                        href={`${basePath}/${item.id}`}
                        className="hover:underline"
                      >
                        {col.render
                          ? col.render(item[col.key], item)
                          : item[col.key] != null
                            ? String(item[col.key])
                            : "—"}
                      </Link>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
