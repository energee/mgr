"use client";

/**
 * Pricing Mobile Cards
 *
 * Renders pricing matrix data as stacked tier cards for narrow viewports.
 * Cells remain inline-editable via PriceCell (without grid navigation).
 */

import { PriceCell } from "@/components/domain/pricing/price-cell";
import type {
  FormatGroup,
  PricingTier,
  PricingTierPrice,
} from "@/components/domain/pricing/types";

export function PricingMobileCards({
  tiers,
  formatGroups,
  priceMap,
  activeChannelId,
  onSave,
}: {
  tiers: PricingTier[];
  formatGroups: FormatGroup[];
  priceMap: Map<string, Map<string, PricingTierPrice>>;
  activeChannelId: string;
  onSave: (tierId: string, formatId: string, channelId: string, value: number | null) => void;
}) {
  return (
    <div className="space-y-4">
      {tiers.map((tier) => (
        <div key={tier.id} className="rounded-lg border bg-card">
          <div className="px-3 py-2 border-b bg-muted/30">
            <div className="font-medium text-sm">{tier.name}</div>
            {tier.cogs_max != null && (
              <div className="text-[10px] text-muted-foreground">
                &le; ${Number(tier.cogs_max).toFixed(2)}/unit
              </div>
            )}
          </div>
          <div className="divide-y">
            {formatGroups.map((group) => (
              <div key={group.containerName}>
                {formatGroups.length > 1 && (
                  <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/20">
                    {group.containerName}
                  </div>
                )}
                {group.formats.map((fmt) => {
                  const priceObj = priceMap.get(tier.id)?.get(fmt.id);
                  return (
                    <div
                      key={fmt.id}
                      className="flex items-center justify-between px-3 py-1.5"
                    >
                      <span className="text-sm text-muted-foreground truncate mr-2">
                        {fmt.name}
                      </span>
                      <div className="w-24 shrink-0">
                        <PriceCell
                          price={priceObj?.price ?? null}
                          tierId={tier.id}
                          formatId={fmt.id}
                          channelId={activeChannelId}
                          rowIndex={0}
                          colIndex={0}
                          onSave={onSave}
                          onNavigate={() => {}}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
