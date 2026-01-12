"use client";

/**
 * Batch Transfers Page
 *
 * Track batch movements between vessels.
 * Features:
 * - Transfer history timeline
 * - Current vessel indication
 * - Record new transfers
 */

import { use, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { VesselTransferForm } from "@/components/domain/vessel-transfer-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, ArrowLeft, ArrowRight, Container, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface Transfer {
  id: string;
  batch_id: string;
  from_vessel_id: string | null;
  to_vessel_id: string;
  volume_bbl: number;
  transferred_at: string;
  transferred_by: string | null;
  notes: string | null;
  from_vessel?: {
    id: string;
    name: string;
    vessel_type: string;
  } | null;
  to_vessel: {
    id: string;
    name: string;
    vessel_type: string;
  };
}

export default function BatchTransfersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  // Fetch batch
  const { data: batch, isLoading: loadingBatch } = useQuery({
    queryKey: ["batch", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("id, batch_number, name, fermenter")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch transfers
  const { data: transfers = [], isLoading: loadingTransfers } = useQuery({
    queryKey: ["batch-transfers", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vessel_transfers")
        .select(`
          id,
          batch_id,
          from_vessel_id,
          to_vessel_id,
          volume_bbl,
          transferred_at,
          transferred_by,
          notes,
          from_vessel:vessels!vessel_transfers_from_vessel_id_fkey(id, name, vessel_type),
          to_vessel:vessels!vessel_transfers_to_vessel_id_fkey(id, name, vessel_type)
        `)
        .eq("batch_id", id)
        .order("transferred_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Transfer[];
    },
  });

  // Add transfer mutation
  const addTransfer = useMutation({
    mutationFn: async (transfer: {
      from_vessel_id: string | null;
      to_vessel_id: string;
      volume_bbl: number;
      transferred_at: string;
      notes?: string;
    }) => {
      const { error } = await supabase.from("vessel_transfers").insert({
        batch_id: id,
        from_vessel_id: transfer.from_vessel_id,
        to_vessel_id: transfer.to_vessel_id,
        volume_bbl: transfer.volume_bbl,
        transferred_at: transfer.transferred_at,
        notes: transfer.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch-transfers", id] });
      setShowForm(false);
      toast.success("Transfer recorded");
    },
    onError: (error) => {
      toast.error("Failed to record transfer", { description: error.message });
    },
  });

  // Delete transfer mutation
  const deleteTransfer = useMutation({
    mutationFn: async (transferId: string) => {
      const { error } = await supabase
        .from("vessel_transfers")
        .delete()
        .eq("id", transferId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["batch-transfers", id] });
      toast.success("Transfer deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete transfer", { description: error.message });
    },
  });

  // Current vessel is the destination of the most recent transfer
  const currentVessel = useMemo(() => {
    if (transfers.length === 0) return null;
    return transfers[transfers.length - 1]?.to_vessel || null;
  }, [transfers]);

  if (loadingBatch) {
    return (
      <div className="container max-w-2xl py-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-4 w-32 mb-8" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/production/batches/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Batch
          </Link>
          <h1 className="text-2xl font-bold">{batch?.name}</h1>
          <p className="text-muted-foreground">
            {batch?.batch_number} &bull; Vessel Transfers
          </p>
        </div>
        {!showForm && (
          <Button size="lg" onClick={() => setShowForm(true)} className="h-12 gap-2">
            <Plus className="h-5 w-5" />
            <span className="hidden sm:inline">Transfer</span>
          </Button>
        )}
      </div>

      {/* Current Location */}
      {currentVessel && (
        <Card className="border-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Current Location
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Container className="h-8 w-8 text-primary" />
              <div>
                <div className="text-xl font-semibold">{currentVessel.name}</div>
                <div className="text-sm text-muted-foreground">
                  {currentVessel.vessel_type}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Form */}
      {showForm && (
        <VesselTransferForm
          batchId={id}
          currentVesselId={currentVessel?.id}
          onSubmit={addTransfer.mutateAsync}
          onCancel={() => setShowForm(false)}
          isSubmitting={addTransfer.isPending}
        />
      )}

      {/* Transfer History */}
      {loadingTransfers ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : transfers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Container className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No transfers recorded</h3>
            <p className="text-muted-foreground mb-4">
              Record the initial knockout or subsequent vessel transfers.
            </p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Record First Transfer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transfer History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

              <div className="space-y-6">
                {transfers.map((transfer, index) => (
                  <div key={transfer.id} className="relative pl-10">
                    {/* Timeline dot */}
                    <div
                      className={`absolute left-2.5 w-3 h-3 rounded-full border-2 ${
                        index === transfers.length - 1
                          ? "bg-primary border-primary"
                          : "bg-background border-muted-foreground"
                      }`}
                    />

                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          {transfer.from_vessel ? (
                            <>
                              <span className="font-medium">
                                {transfer.from_vessel.name}
                              </span>
                              <ArrowRight className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {transfer.to_vessel.name}
                              </span>
                            </>
                          ) : (
                            <>
                              <Badge variant="secondary">Knockout</Badge>
                              <ArrowRight className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {transfer.to_vessel.name}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(transfer.transferred_at).toLocaleDateString()}{" "}
                          {new Date(transfer.transferred_at).toLocaleTimeString(
                            [],
                            { hour: "2-digit", minute: "2-digit" }
                          )}{" "}
                          &bull; {transfer.volume_bbl} BBL
                        </div>
                        {transfer.notes && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {transfer.notes}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm("Delete this transfer?")) {
                            deleteTransfer.mutate(transfer.id);
                          }
                        }}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
