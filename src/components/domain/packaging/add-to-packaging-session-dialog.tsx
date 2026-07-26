"use client";

/**
 * Add to Packaging Session Dialog
 *
 * Dialog for batches in "packaging" status that have no linked session.
 * Lets the user pick an existing planned/in_progress session or create a new one,
 * then inserts a line item linking the batch to that session.
 * When the batch has no recipe/brand (`brandId` is null), a brand picker is
 * shown — session_line_items.brand_id is NOT NULL, so a brand is required.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { entityKeys, packagingKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";
import { formatDate } from "@/lib/format";
import { useBrands } from "@/hooks/use-catalog";
import { Loader2 } from "lucide-react";

type AddToPackagingSessionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchNumber: string;
  /** Brand from the batch's recipe; null when the batch has no recipe or the recipe has no brand (a brand picker is shown instead). */
  brandId: string | null;
  brandName: string | null;
};

const CREATE_NEW = "__create_new__";

export function AddToPackagingSessionDialog({
  open,
  onOpenChange,
  batchId,
  batchNumber,
  brandId,
  brandName,
}: AddToPackagingSessionDialogProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  // Brand picked in-dialog when the batch has no recipe brand (brandId prop null)
  const [selectedBrandId, setSelectedBrandId] = useState<string>("");
  const supabase = createClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  // session_line_items.brand_id is NOT NULL — use the recipe's brand when
  // available, otherwise the one picked in the dialog.
  const effectiveBrandId = brandId ?? (selectedBrandId || null);
  const { data: brands } = useBrands();

  // Fetch existing planned/in_progress sessions
  const { data: sessions, isLoading } = useQuery({
    queryKey: entityKeys.list("packaging_sessions", { status: ["planned", "in_progress"] }),
    queryFn: async () => {
      return (await unwrap(
        supabase
          .from("packaging_sessions")
          .select("id, session_date, status")
          .in("status", ["planned", "in_progress"])
          .order("session_date", { ascending: false }),
      )) ?? [];
    },
    enabled: open,
  });

  const addToSession = useMutation({
    mutationFn: async () => {
      // Guard: the submit button already requires a brand; this protects
      // against programmatic calls (brand_id is NOT NULL).
      if (!effectiveBrandId) throw new Error("Brand is required");

      let sessionId = selectedSessionId;

      // Create new session if requested
      if (sessionId === CREATE_NEW) {
        const today = new Date().toISOString().split("T")[0];
        const { data: newSession, error: sessionError } = await supabase
          .from("packaging_sessions")
          .insert({ session_date: today, status: "planned" })
          .select("id")
          .single();
        if (sessionError) throw sessionError;
        sessionId = newSession.id;
      }

      // Insert line item linking batch to session
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- batch_id not in generated types yet
      const { error: lineError } = await (supabase.from("session_line_items") as any).insert({
        session_id: sessionId,
        brand_id: effectiveBrandId,
        batch_id: batchId,
      });
      if (lineError) throw lineError;

      return sessionId;
    },
    onSuccess: (sessionId) => {
      toast.success(`Batch ${batchNumber} added to packaging session`);
      queryClient.invalidateQueries({ queryKey: packagingKeys.historyForBatch(batchId) });
      queryClient.invalidateQueries({ queryKey: entityKeys.list("packaging_sessions") });
      queryClient.invalidateQueries({
        queryKey: entityKeys.all("packaging_sessions_with_summary"),
      });
      onOpenChange(false);
      router.push(`/production/packaging/${sessionId}`);
    },
    onError: (err: unknown) => {
      toast.error(`Failed to add to session: ${err instanceof Error ? err.message : "Unknown error"}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to Packaging Session</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="text-sm text-muted-foreground">
            Add batch <strong>{batchNumber}</strong>
            {brandName ? ` (${brandName})` : ""} to a packaging session.
          </div>

          {/* Brand picker — only when the batch has no recipe brand */}
          {brandId === null && (
            <div className="space-y-2">
              <Label>Brand</Label>
              <Select value={selectedBrandId} onValueChange={setSelectedBrandId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a brand..." />
                </SelectTrigger>
                <SelectContent>
                  {brands?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                This batch has no recipe brand, so pick the brand to package under.
              </p>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a session..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CREATE_NEW}>
                  + Create New Session
                </SelectItem>
                {sessions?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.session_date ? formatDate(s.session_date) : "No date"} — {s.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => addToSession.mutate()}
            disabled={!selectedSessionId || !effectiveBrandId || addToSession.isPending}
          >
            {addToSession.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {selectedSessionId === CREATE_NEW ? "Create & Add" : "Add to Session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
