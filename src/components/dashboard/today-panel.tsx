"use client";

/**
 * Today Panel
 *
 * Head brewer's morning attention list for the production dashboard.
 * Aggregates four independent "needs attention today" signals, each rendered
 * as a section that only appears when non-empty:
 *
 * - Batches at/past their recipe schedule: fermenting batches whose elapsed
 *   days >= recipe fermentation_days, conditioning batches past
 *   fermentation_days + conditioning_days. Uses the shared schedule math in
 *   src/domain/batch-schedule.ts (planned_start_date + recipe durations,
 *   with the standard 14/7-day fallbacks).
 * - Purchase orders due or overdue: expected_date <= today and still open
 *   (submitted / confirmed / partial).
 * - Kegs out at customers for more than 30 days (keg_aging_report view, the
 *   same source as inventory/kegs/reports).
 * - Inventory lots expiring within 30 days (inventoryService.getExpiringLots,
 *   the same allocation-aware source as the inventory dashboard).
 *
 * The four queries run in parallel (independent useQuery hooks). The panel
 * shows a skeleton while any query is loading and hides entirely once loaded
 * with nothing to report, so it never flashes a false empty state.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { AlertTriangle, CalendarClock, PackageOpen, Timer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { dashboardKeys } from "@/lib/query-keys";
import { phaseEndDays } from "@/domain/batch-schedule";
import { dynamicFrom } from "@/services/types";
import { inventoryService, formatServiceError } from "@/services";
import type { ExpiringLot } from "@/services";
import { CACHE_DURATIONS, POLLING_INTERVALS } from "@/lib/constants";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { Skeleton } from "@/components/ui/skeleton";

// =============================================================================
// Types
// =============================================================================

/** A fermenting/conditioning batch at or past its recipe schedule. */
type OverdueBatch = {
  id: string;
  batch_code: string;
  name: string;
  status: string;
  /** Days at/past the scheduled phase end (0 = due today). */
  days_over: number;
  current_vessel_name: string | null;
};

/** An open purchase order whose expected date has arrived or passed. */
type DuePurchaseOrder = {
  id: string;
  po_number: string;
  status: string;
  expected_date: string;
  supplier_name: string | null;
};

/** A customer/keg-type pair with kegs out longer than 30 days. */
type AgingKegRow = {
  customer_id: string;
  customer_name: string;
  keg_type_name: string;
  kegs_out: number;
  days_out: number;
};

// =============================================================================
// Component
// =============================================================================

/** Shared timestamp for "today" comparisons within a render pass. */
function todayISODate(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** Kegs out at customers longer than this many days need attention. */
const KEG_AGING_THRESHOLD_DAYS = 30;

/** Inventory lots expiring within this many days are surfaced. */
const EXPIRING_LOT_WINDOW_DAYS = 30;

/** Query options shared by all four Today-panel queries. */
const todayQueryOptions = {
  refetchInterval: POLLING_INTERVALS.NORMAL,
  refetchIntervalInBackground: false,
  staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
} as const;

export function TodayPanel() {
  const supabase = createClient();

  // --- Batches at/past schedule -------------------------------------------
  // Shared occupancy model (src/domain/batch-schedule.ts): a batch occupies
  // its phase for planned_start_date + fermentation_days (+ conditioning_days),
  // defaulting to 14/7 days when the recipe doesn't specify.
  const { data: overdueBatches = [], isLoading: batchesLoading } = useQuery({
    queryKey: dashboardKeys.today.overdueBatches(),
    queryFn: async (): Promise<OverdueBatch[]> => {
      const { data, error } = await supabase
        .from("batches_with_brew_info")
        .select(
          `
          id,
          batch_code,
          name,
          status,
          planned_start_date,
          current_vessel_name,
          recipes:recipe_id (fermentation_days, conditioning_days)
        `,
        )
        .in("status", ["fermenting", "conditioning"]);

      if (error) throw error;

      const today = new Date();
      const result: OverdueBatch[] = [];
      for (const b of data || []) {
        if (!b.planned_start_date) continue;
        const recipe = b.recipes as {
          fermentation_days: number | null;
          conditioning_days: number | null;
        } | null;
        // Phase is "at schedule" once elapsed days reach the recipe duration:
        // fermenting -> fermentation_days, conditioning -> ferm + conditioning.
        const phaseDays = phaseEndDays(recipe, b.status);
        const elapsed = differenceInCalendarDays(
          today,
          parseISO(b.planned_start_date),
        );
        if (elapsed >= phaseDays) {
          result.push({
            id: b.id as string,
            batch_code: b.batch_code as string,
            name: b.name as string,
            status: b.status as string,
            days_over: elapsed - phaseDays,
            current_vessel_name: (b.current_vessel_name as string) ?? null,
          });
        }
      }
      return result.sort((a, b) => b.days_over - a.days_over);
    },
    ...todayQueryOptions,
  });

  // --- Purchase orders due/overdue ------------------------------------------
  const { data: duePOs = [], isLoading: posLoading } = useQuery({
    queryKey: dashboardKeys.today.duePOs(),
    queryFn: async (): Promise<DuePurchaseOrder[]> => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("id, po_number, status, expected_date, supplier:suppliers(name)")
        .lte("expected_date", todayISODate())
        // Open = sent but not yet fully received/terminated. Drafts haven't
        // been placed; fulfilled/cancelled/closed need no receiving action.
        .in("status", ["submitted", "confirmed", "partial"])
        .order("expected_date", { ascending: true })
        .limit(10);

      if (error) throw error;

      return (data || []).map((po) => ({
        id: po.id,
        po_number: po.po_number,
        status: po.status,
        expected_date: po.expected_date as string,
        supplier_name: (po.supplier as { name: string } | null)?.name ?? null,
      }));
    },
    ...todayQueryOptions,
  });

  // --- Kegs out > 30 days ----------------------------------------------------
  const { data: agingKegs = [], isLoading: kegsLoading } = useQuery({
    queryKey: dashboardKeys.today.agingKegs(),
    queryFn: async (): Promise<AgingKegRow[]> => {
      const { data, error } = await dynamicFrom(supabase, "keg_aging_report")
        .select("customer_id, customer_name, keg_type_name, kegs_out, days_out")
        .gt("days_out", KEG_AGING_THRESHOLD_DAYS)
        .order("days_out", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as AgingKegRow[];
    },
    ...todayQueryOptions,
  });

  // --- Lots expiring within 30 days -----------------------------------------
  const { data: expiringLots = [], isLoading: lotsLoading } = useQuery({
    queryKey: dashboardKeys.today.expiringLots(),
    queryFn: async (): Promise<ExpiringLot[]> => {
      const result = await inventoryService.getExpiringLots(
        supabase,
        EXPIRING_LOT_WINDOW_DAYS,
        10,
      );
      if (!result.success) throw new Error(formatServiceError(result.error));
      return result.data;
    },
    ...todayQueryOptions,
  });

  const isLoading = batchesLoading || posLoading || kegsLoading || lotsLoading;
  const isEmpty =
    overdueBatches.length === 0 &&
    duePOs.length === 0 &&
    agingKegs.length === 0 &&
    expiringLots.length === 0;

  // Skeleton while fetching — avoids flashing a false "all clear" (the panel
  // hides entirely when there is genuinely nothing to report).
  if (isLoading) {
    return (
      <DashboardSection title="Today">
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </DashboardSection>
    );
  }

  if (isEmpty) return null;

  return (
    <DashboardSection title="Today">
      <div className="grid gap-5 md:grid-cols-2">
        {overdueBatches.length > 0 && (
          <TodayGroup icon={Timer} title="Batches at/past schedule">
            {overdueBatches.map((b) => (
              <TodayRow
                key={b.id}
                href={`/production/batches/${b.id}`}
                primary={b.batch_code}
                secondary={[
                  // Query filters to fermenting/conditioning, so status is
                  // already the display string.
                  b.status,
                  b.current_vessel_name,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                detail={
                  b.days_over === 0 ? "due today" : `${b.days_over}d over`
                }
                urgent={b.days_over > 0}
              />
            ))}
          </TodayGroup>
        )}

        {duePOs.length > 0 && (
          <TodayGroup icon={CalendarClock} title="POs due / overdue">
            {duePOs.map((po) => (
              <TodayRow
                key={po.id}
                href={`/purchasing/pos/${po.id}`}
                primary={po.po_number}
                secondary={po.supplier_name ?? po.status}
                detail={`expected ${format(parseISO(po.expected_date), "MMM d")}`}
                urgent={po.expected_date < todayISODate()}
              />
            ))}
          </TodayGroup>
        )}

        {agingKegs.length > 0 && (
          <TodayGroup
            icon={PackageOpen}
            title={`Kegs out > ${KEG_AGING_THRESHOLD_DAYS} days`}
          >
            {agingKegs.map((row, i) => (
              <TodayRow
                key={`${row.customer_id}-${row.keg_type_name}-${i}`}
                href={`/sales/customers/${row.customer_id}`}
                primary={row.customer_name}
                secondary={`${row.kegs_out} × ${row.keg_type_name}`}
                detail={`${row.days_out}d out`}
                urgent={row.days_out > 60}
              />
            ))}
          </TodayGroup>
        )}

        {expiringLots.length > 0 && (
          <TodayGroup
            icon={AlertTriangle}
            title={`Expiring lots (${EXPIRING_LOT_WINDOW_DAYS}d)`}
          >
            {expiringLots.map((lot) => (
              <TodayRow
                key={lot.id}
                href={`/inventory/lots/${lot.id}`}
                primary={lot.item_name}
                secondary={`Lot ${lot.lot_number}`}
                detail={
                  lot.days_until_expiry < 0
                    ? "expired"
                    : lot.days_until_expiry === 0
                      ? "today"
                      : `${lot.days_until_expiry}d`
                }
                urgent={lot.days_until_expiry <= 7}
              />
            ))}
          </TodayGroup>
        )}
      </div>
    </DashboardSection>
  );
}

// =============================================================================
// Presentational helpers
// =============================================================================

/** Titled sub-group within the Today panel (icon + heading + row list). */
function TodayGroup({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

/** A single linked attention row: primary label, context, right-aligned detail. */
function TodayRow({
  href,
  primary,
  secondary,
  detail,
  urgent,
}: {
  href: string;
  primary: string;
  secondary?: string;
  detail: string;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-baseline justify-between gap-3 py-1.5 text-sm hover:bg-muted/50"
    >
      <span className="min-w-0 truncate">
        <span className="font-medium">{primary}</span>
        {secondary && (
          <span className="text-muted-foreground"> — {secondary}</span>
        )}
      </span>
      <span
        className={`shrink-0 font-mono text-xs ${
          urgent ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {detail}
      </span>
    </Link>
  );
}
