"use client";

/**
 * BatchBrewInfo - Display per-brew-log summary cards on Batch Detail
 *
 * Shows:
 * - Per-brew-log cards with brewer, measurements, and phase highlights
 * - Collapsible BrewLogLinker for managing linked brew logs
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { batchKeys } from "@/lib/query-keys";
import { unwrap } from "@/lib/supabase/query-helpers";
import { BrewLogLinker } from "@/components/domain/brew/brew-log-linker";
import { Badge } from "@/components/ui/badge";
import { UnitDisplay } from "@/components/ui/unit-input";
import { extractBrewMeasurements, toBrewMeasurementUnits } from "@/domain/brew-events";
import { useResolvedUnitPreferences } from "@/hooks/use-unit-preferences";
import type { BrewEvent } from "@/types/domain";
import Link from "next/link";

type BatchBrewInfoProps = {
  data: {
    id: string;
    name: string;
    batch_code: string;
    brew_date?: string | null;
    actual_og?: number | null;
    volume_from_brews_bbl?: number | null;
    brew_count?: number | null;
  };
}

type BrewSummaryLink = {
  id: string;
  volume_bbl: number;
  notes: string | null;
  brew_log: {
    id: string;
    brew_number: string;
    brew_date: string;
    status: string;
    events: unknown[] | null;
    brewer_id: string | null;
  };
  brewer_name: string | null;
}

export function BatchBrewInfo({ data }: BatchBrewInfoProps) {
  const supabase = createClient();
  const measurementUnits = toBrewMeasurementUnits(useResolvedUnitPreferences());

  // Fetch linked brew logs with events data
  const { data: linkedBrews = [], isLoading } = useQuery({
    queryKey: batchKeys.brewSummary(data.id),
    queryFn: async () => {
      const links = await unwrap(
        supabase
          .from("brew_log_batches")
          .select(
            `
          id, volume_bbl, notes,
          brew_log:brew_logs(
            id, brew_number, brew_date, status, events, brewer_id
          )
        `
          )
          .eq("batch_id", data.id)
      );
      if (!links || links.length === 0) return [];

      // Collect unique brewer_ids to fetch display names
      const brewerIds = [
        ...new Set(
          links
            .map((l) => {
              const bl = l.brew_log as unknown as BrewSummaryLink["brew_log"];
              return bl?.brewer_id;
            })
            .filter((id): id is string => !!id)
        ),
      ];

      let brewerMap: Record<string, string> = {};
      if (brewerIds.length > 0) {
        const { data: brewers } = await supabase
          .from("user_profiles")
          .select("id, display_name")
          .in("id", brewerIds);
        if (brewers) {
          brewerMap = Object.fromEntries(
            brewers.map((b) => [b.id, b.display_name ?? ""])
          );
        }
      }

      return links.map((link) => {
        const bl = link.brew_log as unknown as BrewSummaryLink["brew_log"];
        return {
          id: link.id,
          volume_bbl: link.volume_bbl,
          notes: link.notes,
          brew_log: bl,
          brewer_name: bl?.brewer_id ? (brewerMap[bl.brewer_id] ?? null) : null,
        } as BrewSummaryLink;
      });
    },
  });

  return (
    <div className="space-y-6">
      {/* Per-brew-log summary cards */}
      {isLoading ? (
        <div className="animate-pulse h-24 bg-muted rounded-md" />
      ) : linkedBrews.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No brew logs linked yet.
        </p>
      ) : (
        <div className="space-y-3">
          {linkedBrews.map((link) => {
            const brew = link.brew_log;
            if (!brew) return null;
            const highlights = Array.isArray(brew.events)
              ? extractBrewMeasurements(brew.events as BrewEvent[], measurementUnits)
              : [];

            return (
              <div key={link.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Link
                    href={`/production/brew-logs/${brew.id}`}
                    className="font-medium hover:text-primary transition-colors"
                  >
                    {brew.brew_number}
                  </Link>
                  <Badge variant="outline">
                    <UnitDisplay value={link.volume_bbl} unitType="volume" />
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <div>
                    <span className="text-muted-foreground">Brew Date</span>
                    <span className="ml-2">
                      {new Date(brew.brew_date).toLocaleDateString("en-US")}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Brewer</span>
                    <span className="ml-2">
                      {link.brewer_name || "\u2014"}
                    </span>
                  </div>
                </div>
                {highlights.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {highlights.map((h) => (
                      <Badge
                        key={h.label}
                        variant="secondary"
                        className="text-xs font-normal"
                      >
                        {h.label}: {h.value}
                      </Badge>
                    ))}
                  </div>
                )}
                {link.notes && (
                  <p className="text-sm text-muted-foreground italic">
                    {link.notes}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Collapsible BrewLogLinker */}
      <details className="group">
        <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
          Manage linked brew logs
        </summary>
        <div className="mt-3">
          <BrewLogLinker
            batchId={data.id}
            batchName={`${data.batch_code} - ${data.name}`}
          />
        </div>
      </details>
    </div>
  );
}
