"use client";

/**
 * Cellar Board
 *
 * The software version of the cellar whiteboard: every active vessel as a
 * tile, grouped by type (fermenters first, then foeders, brites, and the
 * rest), showing the occupying batch, fill vs. capacity, days in tank, and
 * status. Tile actions: Transfer (opens VesselTransferDialog for the
 * occupying batch) and Mark Clean (dirty → ready_for_use, status-guarded).
 * Data comes from vessels_with_batch plus two small lookups (batch volumes
 * for the fill bar, latest transfer-in per vessel for days in tank).
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { vesselKeys, entityKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";
import { getValueLabel } from "@/types/entity";
import { vesselEntity } from "@/entities/vessel";
import { VesselTransferDialog } from "@/components/domain/batch/vessel-transfer-dialog";
import { UnitDisplay } from "@/components/ui/unit-input";
import { Button } from "@/components/ui/button";
import { ArrowRightLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

/** Cellar display order; types not listed sort after these, alphabetically. */
const TYPE_ORDER = ["fermenter", "foeder", "brite"];

type CellarVessel = {
  id: string;
  name: string;
  vessel_type: string;
  status: string;
  capacity_bbl: number | null;
  batch_id: string | null;
  batch_number: string | null;
  batch_name: string | null;
  batch_status: string | null;
  recipe_name: string | null;
  /** Occupying batch volume (bbl), for the fill bar. */
  batchVolumeBbl: number | null;
  /** When the occupying batch was transferred in, for days-in-tank. */
  inTankSince: string | null;
};

const STATUS_TONE: Record<string, string> = {
  ready_for_use: "bg-emerald-100 text-emerald-800",
  dirty: "bg-amber-100 text-amber-800",
  in_use: "bg-sky-100 text-sky-800",
};

function daysIn(since: string | null): number | null {
  if (!since) return null;
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}

export function CellarBoard() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [transferVessel, setTransferVessel] = useState<CellarVessel | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);

  const { data: vessels, isLoading } = useQuery({
    queryKey: vesselKeys.cellar(),
    queryFn: async (): Promise<CellarVessel[]> => {
      const rows = (await unwrap(
        supabase
          .from("vessels_with_batch")
          .select(
            "id, name, vessel_type, status, capacity_bbl, batch_id, batch_number, batch_name, batch_status, recipe_name"
          )
          .eq("is_active", true)
          .order("name")
      )) as unknown as Omit<CellarVessel, "batchVolumeBbl" | "inTankSince">[];

      const occupied = rows.filter((r) => r.batch_id);
      let volumeByBatch = new Map<string, number | null>();
      const sinceByVessel = new Map<string, string>();
      if (occupied.length > 0) {
        const batchIds = [...new Set(occupied.map((r) => r.batch_id as string))];
        const vesselIds = occupied.map((r) => r.id);
        const [batches, transfers] = await Promise.all([
          unwrap(supabase.from("batches").select("id, volume_bbl").in("id", batchIds)),
          unwrap(
            supabase
              .from("vessel_transfers")
              .select("to_vessel_id, batch_id, transferred_at")
              .in("to_vessel_id", vesselIds)
              .order("transferred_at", { ascending: false })
          ),
        ]);
        volumeByBatch = new Map((batches ?? []).map((b) => [b.id, b.volume_bbl]));
        // Latest transfer of the occupying batch into each vessel wins.
        for (const t of transfers ?? []) {
          const holder = occupied.find((r) => r.id === t.to_vessel_id);
          if (holder && holder.batch_id === t.batch_id && !sinceByVessel.has(t.to_vessel_id)) {
            sinceByVessel.set(t.to_vessel_id, t.transferred_at);
          }
        }
      }

      return rows.map((r) => ({
        ...r,
        batchVolumeBbl: r.batch_id ? (volumeByBatch.get(r.batch_id) ?? null) : null,
        inTankSince: sinceByVessel.get(r.id) ?? null,
      }));
    },
  });

  const markClean = async (vessel: CellarVessel) => {
    // Status-guarded: a raced tile (someone else cleaned/filled it) is a no-op.
    const { error } = await supabase
      .from("vessels")
      .update({ status: "ready_for_use", updated_at: new Date().toISOString() })
      .eq("id", vessel.id)
      .eq("status", "dirty");
    if (error) {
      toast.error(`Failed to mark ${vessel.name} clean`);
    } else {
      toast.success(`${vessel.name} marked clean`);
      queryClient.invalidateQueries({ queryKey: vesselKeys.all() });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("vessels") });
      queryClient.invalidateQueries({ queryKey: entityKeys.all("vessels_with_batch") });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const groups = new Map<string, CellarVessel[]>();
  for (const v of vessels ?? []) {
    const group = groups.get(v.vessel_type);
    if (group) group.push(v);
    else groups.set(v.vessel_type, [v]);
  }
  const orderedTypes = [
    ...TYPE_ORDER.filter((t) => groups.has(t)),
    ...[...groups.keys()].filter((t) => !TYPE_ORDER.includes(t)).sort(),
  ];

  return (
    <div className="space-y-8">
      {orderedTypes.map((type) => (
        <section key={type}>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {getValueLabel(vesselEntity, "vessel_type", type)}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(groups.get(type) ?? []).map((v) => {
              const fillPct =
                v.batchVolumeBbl != null && v.capacity_bbl
                  ? Math.min(100, Math.round((v.batchVolumeBbl / v.capacity_bbl) * 100))
                  : null;
              const days = daysIn(v.inTankSince);
              return (
                <div key={v.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/production/vessels/${v.id}`}
                      className="font-medium hover:underline"
                    >
                      {v.name}
                    </Link>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${STATUS_TONE[v.status] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {getValueLabel(vesselEntity, "status", v.status)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <UnitDisplay value={v.capacity_bbl} unitType="volume" />
                  </div>

                  {v.batch_id ? (
                    <div className="mt-3 space-y-2">
                      <div className="text-sm">
                        <Link
                          href={`/production/batches/${v.batch_id}`}
                          className="font-medium hover:underline"
                        >
                          {v.batch_number}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {v.batch_name ?? v.recipe_name ?? ""}
                        </span>
                      </div>
                      {fillPct != null && (
                        <div>
                          <div className="h-1.5 w-full rounded bg-muted">
                            <div
                              className="h-1.5 rounded bg-primary"
                              style={{ width: `${fillPct}%` }}
                            />
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            <UnitDisplay value={v.batchVolumeBbl} unitType="volume" /> · {fillPct}%
                            full{days != null && <> · {days}d in tank</>}
                          </div>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTransferVessel(v);
                          setShowTransfer(true);
                        }}
                      >
                        <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Transfer
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Empty</span>
                      {v.status === "dirty" && (
                        <Button size="sm" variant="outline" onClick={() => markClean(v)}>
                          <Sparkles className="mr-1 h-3.5 w-3.5" /> Mark clean
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {transferVessel && transferVessel.batch_id && (
        <VesselTransferDialog
          batchId={transferVessel.batch_id}
          batchNumber={transferVessel.batch_number ?? ""}
          batchStatus={transferVessel.batch_status ?? undefined}
          fromVesselId={transferVessel.id}
          fromVesselName={transferVessel.name}
          currentVolume={transferVessel.batchVolumeBbl}
          open={showTransfer}
          onOpenChange={setShowTransfer}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: vesselKeys.cellar() });
          }}
        />
      )}
    </div>
  );
}
