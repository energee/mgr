"use client";

/**
 * Add to Packaging Session Dialog
 *
 * Dialog for batches in "packaging" status that have no linked session.
 * Lets the user pick an existing planned/in_progress session or create a new one,
 * then inserts a line item linking the batch to that session.
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
import { toast } from "sonner";
import { entityKeys, packagingKeys } from "@/lib/query-keys";
import { formatDate } from "@/lib/format";
import { Loader2 } from "lucide-react";

type AddToPackagingSessionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  batchNumber: string;
  brandId: string;
  brandName: string;
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
  const supabase = createClient();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Fetch existing planned/in_progress sessions
  const { data: sessions, isLoading } = useQuery({
    queryKey: entityKeys.list("packaging_sessions", { status: ["planned", "in_progress"] }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packaging_sessions")
        .select("id, session_date, status")
        .in("status", ["planned", "in_progress"])
        .order("session_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const addToSession = useMutation({
    mutationFn: async () => {
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
        brand_id: brandId,
        batch_id: batchId,
      });
      if (lineError) throw lineError;

      return sessionId;
    },
    onSuccess: (sessionId) => {
      toast.success(`Batch ${batchNumber} added to packaging session`);
      queryClient.invalidateQueries({ queryKey: packagingKeys.historyForBatch(batchId) });
      queryClient.invalidateQueries({ queryKey: entityKeys.list("packaging_sessions") });
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
            Add batch <strong>{batchNumber}</strong> ({brandName}) to a packaging session.
          </div>

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
            disabled={!selectedSessionId || addToSession.isPending}
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
