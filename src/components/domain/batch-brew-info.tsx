"use client";

/**
 * BatchBrewInfo - Display Brew Info Section for Batch Detail
 *
 * Shows:
 * - Linked brew logs with BrewLogLinker
 * - Aggregated brew metrics (brew date, OG)
 */

import { BrewLogLinker } from "./brew-log-linker";

interface BatchBrewInfoProps {
  data: {
    id: string;
    name: string;
    batch_number: string;
    brew_date?: string | null;
    actual_og?: number | null;
    volume_from_brews_bbl?: number | null;
    brew_count?: number | null;
  };
}

export function BatchBrewInfo({ data }: BatchBrewInfoProps) {
  const hasBrewData = data.brew_date || data.actual_og;

  return (
    <div className="space-y-6">
      {/* Aggregated metrics from linked brews */}
      {hasBrewData && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {data.brew_date && (
            <div>
              <div className="text-sm font-medium text-muted-foreground">
                Brew Date
              </div>
              <div className="text-lg">
                {new Date(data.brew_date).toLocaleDateString()}
              </div>
            </div>
          )}
          {data.actual_og && (
            <div>
              <div className="text-sm font-medium text-muted-foreground">
                Actual OG
              </div>
              <div className="text-lg">{data.actual_og.toFixed(1)}°P</div>
            </div>
          )}
          {data.volume_from_brews_bbl != null && (
            <div>
              <div className="text-sm font-medium text-muted-foreground">
                Volume from Brews
              </div>
              <div className="text-lg">{data.volume_from_brews_bbl} BBL</div>
            </div>
          )}
          {data.brew_count != null && data.brew_count > 1 && (
            <div>
              <div className="text-sm font-medium text-muted-foreground">
                Contributing Brews
              </div>
              <div className="text-lg">{data.brew_count}</div>
            </div>
          )}
        </div>
      )}

      {/* Brew log linker */}
      <BrewLogLinker
        batchId={data.id}
        batchName={`${data.batch_number} - ${data.name}`}
      />
    </div>
  );
}
