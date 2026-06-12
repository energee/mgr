"use client";

/**
 * PackagingDayView — full-width live data-entry view for in-progress packaging sessions.
 *
 * Replaces EntityDetailUnified when a session has status "in_progress".
 * Optimized for real-time entry: always-visible batch-first quick-add row
 * (batch + brand carry over between adds), highlighted Actual Qty column
 * (bg-amber-50), live variance calculation, and a "Complete Session" button
 * that opens the PackagingCompletionReview modal.
 */

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/universal/status-badge";
import { packagingSessionEntity } from "@/entities/packaging-session";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { entityKeys } from "@/lib/query-keys";
import {
  useSessionLineItems,
  useLineItemMutations,
  validateNewItem,
  EMPTY_NEW_ITEM,
  type NewItemState,
} from "@/hooks/use-session-line-items";
import { parseIntOrNull } from "@/lib/format";
import { BatchCell, FormatCell } from "./packaging-shared";
import { AddLineItemRow } from "./add-line-item-row";
import { PackagingCompletionReview } from "./packaging-completion-review";

// =============================================================================
// Types
// =============================================================================

type PackagingDayViewProps = {
  sessionId: string;
};

// =============================================================================
// Component
// =============================================================================

export function PackagingDayView({ sessionId }: PackagingDayViewProps) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const [newItem, setNewItem] = useState<NewItemState>({ ...EMPTY_NEW_ITEM });
  const [showReview, setShowReview] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: entityKeys.detail("packaging_sessions", sessionId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("packaging_sessions")
        .select("id, session_date, status, notes")
        .eq("id", sessionId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { items, isLoading: itemsLoading, totalPlanned, totalActual } =
    useSessionLineItems(sessionId);

  const { addItem, updateItem, deleteItem, handleFormatChange } =
    useLineItemMutations(sessionId);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleAdd = () => {
    const error = validateNewItem(newItem);
    if (error) {
      toast.error(error);
      return;
    }
    addItem.mutate(newItem, {
      // Carry over batch + brand so multi-format runs from one batch need
      // only format + quantities per line; reset everything else.
      onSuccess: () =>
        setNewItem({
          ...EMPTY_NEW_ITEM,
          brand_id: newItem.brand_id,
          batch_id: newItem.batch_id,
        }),
    });
  };

  const handleCompleted = useCallback(() => {
    setShowReview(false);
    queryClient.invalidateQueries({
      queryKey: entityKeys.detail("packaging_sessions", sessionId),
    });
    router.push(`/production/packaging/${sessionId}`);
  }, [queryClient, sessionId, router]);

  // ---------------------------------------------------------------------------
  // Variance helper
  // ---------------------------------------------------------------------------

  const renderVariance = (planned: number | null, actual: number | null) => {
    if (actual == null) {
      return <span className="text-muted-foreground">&mdash;</span>;
    }
    const variance = actual - (planned ?? 0);
    const color = variance >= 0 ? "text-green-600" : "text-red-600";
    return (
      <span className={color}>{variance > 0 ? `+${variance}` : variance}</span>
    );
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (sessionLoading || itemsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center text-muted-foreground py-16">
        Session not found.
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex justify-between items-center border-b pb-4">
        <Link
          href="/production/packaging"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to List
        </Link>

        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            Session: {session.session_date}
          </span>
          <StatusBadge
            status={session.status}
            config={packagingSessionEntity.stateMachine?.stateDisplay}
          />
          <div className="flex items-center gap-3 text-sm">
            <span>
              Items: <strong>{items?.length ?? 0}</strong>
            </span>
            <span>
              Planned: <strong>{totalPlanned}</strong>
            </span>
            <span>
              Actual: <strong>{totalActual}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Line items table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Batch</TableHead>
            <TableHead>Brand</TableHead>
            <TableHead>Format</TableHead>
            <TableHead className="w-[120px]">Planned Qty</TableHead>
            <TableHead className="w-[120px] bg-amber-50">Actual Qty</TableHead>
            <TableHead className="w-[80px]">Variance</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {items?.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <BatchCell
                  brandId={item.brand_id}
                  currentBatchId={item.batch_id ?? ""}
                  onSelect={(batchId) =>
                    updateItem.mutate({
                      id: item.id,
                      field: "batch_id",
                      value: batchId,
                    })
                  }
                />
              </TableCell>

              <TableCell className="font-medium">{item.brand_name}</TableCell>

              <TableCell>
                <FormatCell
                  formatId={item.selling_format_id ?? ""}
                  onFormatChange={(v) => handleFormatChange(item.id, v)}
                  kegOwnerId={item.keg_owner_id || ""}
                  onKegOwnerChange={(v) =>
                    updateItem.mutate({
                      id: item.id,
                      field: "keg_owner_id",
                      value: v || null,
                    })
                  }
                />
              </TableCell>

              <TableCell>
                <Input
                  type="number"
                  min={0}
                  key={`planned-${item.id}-${item.planned_quantity}`}
                  defaultValue={item.planned_quantity ?? ""}
                  onBlur={(e) =>
                    updateItem.mutate({
                      id: item.id,
                      field: "planned_quantity",
                      value: parseIntOrNull(e.target.value),
                    })
                  }
                  className="h-8 w-full"
                  placeholder="--"
                />
              </TableCell>

              <TableCell className="bg-amber-50">
                <Input
                  type="number"
                  min={0}
                  key={`actual-${item.id}-${item.actual_quantity}`}
                  defaultValue={item.actual_quantity ?? ""}
                  onBlur={(e) =>
                    updateItem.mutate({
                      id: item.id,
                      field: "actual_quantity",
                      value: parseIntOrNull(e.target.value),
                    })
                  }
                  className="h-8 w-full"
                  placeholder="--"
                />
              </TableCell>

              <TableCell className="text-center">
                {renderVariance(item.planned_quantity, item.actual_quantity)}
              </TableCell>

              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove line item"
                  className="h-8 w-8 text-destructive"
                  onClick={() => deleteItem.mutate(item.id)}
                  disabled={deleteItem.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}

          {/* Quick-add row (always visible) */}
          <AddLineItemRow
            newItem={newItem}
            onChange={setNewItem}
            onAdd={handleAdd}
            isPending={addItem.isPending}
            showVarianceCell
          />

          {(!items || items.length === 0) && (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center text-muted-foreground py-8"
              >
                No line items yet. Use the row above to add products to this
                packaging session.
              </TableCell>
            </TableRow>
          )}
        </TableBody>

        {items && items.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="text-right font-medium">
                Totals
              </TableCell>
              <TableCell className="font-bold">{totalPlanned}</TableCell>
              <TableCell className="font-bold bg-amber-50">
                {totalActual}
              </TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableFooter>
        )}
      </Table>

      {/* Action bar */}
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => setShowReview(true)}
          disabled={!items || items.length === 0}
        >
          Complete Session
        </Button>
      </div>

      {/* Completion review modal */}
      {showReview && (
        <PackagingCompletionReview
          sessionId={sessionId}
          items={(items ?? []).map((item) => ({
            id: item.id,
            brand_name: item.brand_name,
            batch_code: item.batch_code,
            format_name: item.selling_format_name,
            planned_quantity: item.planned_quantity,
            actual_quantity: item.actual_quantity,
          }))}
          open={showReview}
          onOpenChange={setShowReview}
          onCompleted={handleCompleted}
        />
      )}
    </div>
  );
}
