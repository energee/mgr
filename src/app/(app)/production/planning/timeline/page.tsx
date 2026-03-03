"use client";

/**
 * Production Timeline View
 *
 * Gantt-style visual planning interface showing:
 * - Batches as horizontal bars across time
 * - Vessel utilization lanes
 * - Demand markers from orders
 * - Interactive batch creation and scheduling
 */

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { planningKeys, batchKeys, entityKeys, recipeKeys } from "@/lib/query-keys";
import Link from "next/link";
import {
  addDays,
  startOfWeek,
  eachDayOfInterval,
  format,
  isToday,
  differenceInDays,
  addWeeks,
  parseISO,
} from "date-fns";
import { cn } from "@/lib/utils";
import { batchEntity } from "@/entities/batch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  List,
  AlertTriangle,
  Plus,
  Zap,
  Droplets,
  Package,
  Clock,
} from "lucide-react";
import type { ProductionShortfall } from "@/types/planning";
import { CreateBatchFromShortfall } from "@/components/domain/create-batch-from-shortfall";

// =============================================================================
// Types
// =============================================================================

interface TimelineBatch {
  id: string;
  batch_number: string;
  name: string;
  status: string;
  planned_start_date: string | null;
  volume_bbl: number | null;
  current_vessel_name: string | null;
  recipe_id: string | null;
  recipe_name?: string;
  brand_id?: string;
  brand_name?: string;
  fermentation_days?: number;
  conditioning_days?: number;
  estimated_ready_date?: string;
}

interface VesselInfo {
  id: string;
  name: string;
  vessel_type: string;
  capacity_bbl: number | null;
  current_batch_id: string | null;
  status: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Map from stateDisplay semantic color names to Tailwind timeline bar classes.
 * DEC-007: derive status styling from entity config rather than hardcoding
 * per-status values. The stateDisplay colors ("default", "info", etc.) are
 * mapped to Tailwind bg/border/text classes appropriate for the timeline bars.
 */
const TIMELINE_COLOR_MAP: Record<string, { bg: string; border: string; text: string }> = {
  default: { bg: "bg-secondary", border: "border-secondary-foreground/30", text: "text-secondary-foreground" },
  info: { bg: "bg-orange-50", border: "border-orange-400", text: "text-orange-800" },
  warning: { bg: "bg-amber-50", border: "border-amber-400", text: "text-amber-800" },
  success: { bg: "bg-emerald-50", border: "border-emerald-400", text: "text-emerald-800" },
  error: { bg: "bg-red-50", border: "border-red-400", text: "text-red-800" },
};

const FALLBACK_TIMELINE_COLORS = TIMELINE_COLOR_MAP.default;

/** Resolve timeline bar colors for a batch status from entity stateDisplay config. */
function getTimelineColors(status: string): { bg: string; border: string; text: string } {
  const stateDisplay = batchEntity.stateMachine?.stateDisplay;
  const semanticColor = stateDisplay?.[status]?.color ?? "default";
  return TIMELINE_COLOR_MAP[semanticColor] ?? FALLBACK_TIMELINE_COLORS;
}

/**
 * Icons for batch statuses on the timeline. These are not available from the
 * entity stateDisplay config (which only provides label and semantic color),
 * so they are defined here as a timeline-specific visual enhancement.
 */
const STATUS_ICONS: Record<string, React.ReactNode> = {
  planned: <Clock className="h-3 w-3" />,
  fermenting: <Zap className="h-3 w-3" />,
  conditioning: <Droplets className="h-3 w-3" />,
  packaging: <Package className="h-3 w-3" />,
};

// =============================================================================
// Component
// =============================================================================

export default function ProductionTimelinePage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // View state
  const [weeksToShow, setWeeksToShow] = useState(6);
  const [startDate, setStartDate] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedShortfall, setSelectedShortfall] = useState<ProductionShortfall | null>(null);

  // Filter state
  const [brandFilter, setBrandFilter] = useState<string>("_all");
  const [recipeFilter, setRecipeFilter] = useState<string>("_all");

  // Calculate date range
  const endDate = addWeeks(startDate, weeksToShow);
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  // Fetch batches with recipe info
  const { data: batches = [] } = useQuery({
    queryKey: entityKeys.timeline("batches_with_brew_info", startDate.toISOString()),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches_with_brew_info")
        .select(`
          id,
          batch_number,
          name,
          status,
          planned_start_date,
          volume_bbl,
          current_vessel_name,
          recipe_id,
          recipes:recipe_id (
            name,
            brand_id,
            fermentation_days,
            conditioning_days,
            brands:brand_id (name)
          )
        `)
        .in("status", ["planned", "fermenting", "conditioning", "packaging"])
        .gte("planned_start_date", addDays(startDate, -30).toISOString())
        .lte("planned_start_date", addDays(endDate, 30).toISOString())
        .order("planned_start_date", { ascending: true });

      if (error) throw error;

      return (data || []).map((b) => {
        const recipe = b.recipes as { name: string; brand_id: string; fermentation_days: number; conditioning_days: number; brands: { name: string } } | null;
        const fermDays = recipe?.fermentation_days || 14;
        const condDays = recipe?.conditioning_days || 7;
        const startDt = b.planned_start_date ? parseISO(b.planned_start_date) : null;

        return {
          ...b,
          recipe_name: recipe?.name,
          brand_id: recipe?.brand_id,
          brand_name: recipe?.brands?.name,
          fermentation_days: fermDays,
          conditioning_days: condDays,
          estimated_ready_date: startDt
            ? format(addDays(startDt, fermDays + condDays), "yyyy-MM-dd")
            : null,
        } as TimelineBatch;
      });
    },
  });

  // Fetch vessels for lane display
  const { data: vessels = [] } = useQuery({
    queryKey: entityKeys.list("vessels"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vessels")
        .select("id, name, vessel_type, capacity_bbl, current_batch_id, status")
        .in("vessel_type", ["fermenter", "unitank", "brite"])
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return (data || []) as VesselInfo[];
    },
  });

  // Fetch brands for filtering
  const { data: brands = [] } = useQuery({
    queryKey: entityKeys.list("brands"),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch recipes for filtering (filtered by brand if selected)
  const { data: recipes = [] } = useQuery({
    queryKey: brandFilter !== "_all" ? recipeKeys.byBrand(brandFilter) : recipeKeys.list(),
    queryFn: async () => {
      let query = supabase
        .from("recipes")
        .select("id, name, brand_id")
        .eq("is_active", true)
        .order("name");

      if (brandFilter !== "_all") {
        query = query.eq("brand_id", brandFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch shortfalls for demand markers
  const { data: shortfalls = [] } = useQuery({
    queryKey: planningKeys.shortfalls({ includeDrafts: true, horizonWeeks: weeksToShow + 2 }),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)("calculate_production_shortfalls", {
        p_include_drafts: true,
        p_horizon_weeks: weeksToShow + 2,
      });
      if (error) throw error;
      return (data || []) as ProductionShortfall[];
    },
  });

  // Filter and group batches by vessel
  const batchesByVessel = useMemo(() => {
    const map = new Map<string, TimelineBatch[]>();
    map.set("unassigned", []);

    vessels.forEach((v) => map.set(v.name, []));

    // Apply filters
    const filteredBatches = batches.filter((b) => {
      // Brand filter - use brand_id from the batch
      if (brandFilter !== "_all" && b.brand_id !== brandFilter) return false;
      // Recipe filter
      if (recipeFilter !== "_all" && b.recipe_id !== recipeFilter) return false;
      return true;
    });

    filteredBatches.forEach((b) => {
      const key = b.current_vessel_name || "unassigned";
      const list = map.get(key) || [];
      list.push(b);
      map.set(key, list);
    });

    return map;
  }, [batches, vessels, brandFilter, recipeFilter]);

  // Navigation
  const goToPrevious = () => setStartDate((d) => addWeeks(d, -weeksToShow));
  const goToNext = () => setStartDate((d) => addWeeks(d, weeksToShow));
  const goToToday = () => setStartDate(startOfWeek(new Date(), { weekStartsOn: 1 }));

  // Scroll to today on mount
  useEffect(() => {
    if (scrollContainerRef.current) {
      const todayIndex = days.findIndex((d) => isToday(d));
      if (todayIndex > 0) {
        const dayWidth = 48; // matches w-12
        scrollContainerRef.current.scrollLeft = Math.max(0, (todayIndex - 3) * dayWidth);
      }
    }
  }, [days]);

  // Calculate batch position and width
  const getBatchStyle = (batch: TimelineBatch) => {
    if (!batch.planned_start_date) return null;

    const batchStart = parseISO(batch.planned_start_date);
    const totalDays = (batch.fermentation_days || 14) + (batch.conditioning_days || 7);

    const startOffset = differenceInDays(batchStart, startDate);
    const duration = totalDays;

    if (startOffset + duration < 0 || startOffset > days.length) return null;

    const left = Math.max(0, startOffset) * 48; // 48px per day (w-12)
    const width = Math.min(duration, days.length - Math.max(0, startOffset)) * 48;

    return { left, width, startOffset, duration };
  };

  // Handle batch creation success
  const handleBatchCreated = () => {
    setSelectedShortfall(null);
    queryClient.invalidateQueries({ queryKey: planningKeys.all() });
    queryClient.invalidateQueries({ queryKey: batchKeys.all() });
  };

  return (
    <TooltipProvider>
      <div className="h-[calc(100vh-120px)] flex flex-col bg-background">
        {/* Header */}
        <div className="flex-none border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Production Timeline
              </h1>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                <Link href="/production/planning">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground">
                    <List className="h-4 w-4 mr-1" />
                    List
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" className="h-7 px-2 bg-background shadow-sm">
                  <Calendar className="h-4 w-4 mr-1" />
                  Timeline
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Brand filter */}
              <Select
                value={brandFilter}
                onValueChange={(v) => {
                  setBrandFilter(v);
                  // Reset recipe filter when brand changes
                  setRecipeFilter("_all");
                }}
              >
                <SelectTrigger className="w-[140px] h-8">
                  <SelectValue placeholder="All Brands" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Brands</SelectItem>
                  {brands.map((brand) => (
                    <SelectItem key={brand.id} value={brand.id}>
                      {brand.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Recipe filter */}
              <Select value={recipeFilter} onValueChange={setRecipeFilter}>
                <SelectTrigger className="w-[160px] h-8">
                  <SelectValue placeholder="All Recipes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Recipes</SelectItem>
                  {recipes.map((recipe) => (
                    <SelectItem key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Time range selector */}
              <Select value={weeksToShow.toString()} onValueChange={(v) => setWeeksToShow(parseInt(v))}>
                <SelectTrigger className="w-[120px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">4 weeks</SelectItem>
                  <SelectItem value="6">6 weeks</SelectItem>
                  <SelectItem value="8">8 weeks</SelectItem>
                  <SelectItem value="12">12 weeks</SelectItem>
                </SelectContent>
              </Select>

              {/* Navigation */}
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToPrevious} aria-label="Previous period">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className="h-8" onClick={goToToday}>
                  Today
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToNext} aria-label="Next period">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Legend — derive statuses from entity config (DEC-007) */}
          <div className="flex items-center gap-4 mt-3 text-xs">
            <span className="text-muted-foreground">Status:</span>
            {Object.keys(batchEntity.stateMachine?.stateDisplay ?? {}).map((status) => {
              const colors = getTimelineColors(status);
              const label = batchEntity.stateMachine?.stateDisplay?.[status]?.label ?? status;
              return (
                <div key={status} className="flex items-center gap-1.5">
                  <div className={cn("w-3 h-3 rounded-sm border", colors.bg, colors.border)} />
                  <span className="text-muted-foreground">{label}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-1.5 ml-4">
              <AlertTriangle className="h-3 w-3 text-destructive" />
              <span className="text-muted-foreground">Shortfall</span>
            </div>
          </div>
        </div>

        {/* Timeline Grid */}
        <div className="flex-1 overflow-hidden flex">
          {/* Vessel Labels (Fixed) */}
          <div className="flex-none w-40 border-r bg-muted/30">
            {/* Header spacer */}
            <div className="h-14 border-b px-3 flex items-end pb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Vessels</span>
            </div>

            {/* Vessel rows */}
            {Array.from(batchesByVessel.keys()).map((vesselName) => (
              <div
                key={vesselName}
                className={cn(
                  "h-16 border-b px-3 flex items-center",
                  vesselName === "unassigned" && "bg-muted/50"
                )}
              >
                <div className="truncate">
                  <div className={cn(
                    "font-medium text-sm",
                    vesselName === "unassigned" ? "text-muted-foreground italic" : "text-foreground"
                  )}>
                    {vesselName === "unassigned" ? "Unassigned" : vesselName}
                  </div>
                  {vesselName !== "unassigned" && (
                    <div className="text-xs text-muted-foreground">
                      {vessels.find((v) => v.name === vesselName)?.capacity_bbl || "—"} BBL
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Demand row label */}
            <div className="h-20 border-b px-3 flex items-center bg-destructive/5">
              <div>
                <div className="font-medium text-sm text-destructive">Demand</div>
                <div className="text-xs text-destructive/70">Shortfalls</div>
              </div>
            </div>
          </div>

          {/* Scrollable Timeline */}
          <div ref={scrollContainerRef} className="flex-1 overflow-x-auto overflow-y-hidden">
            <div style={{ width: days.length * 48 }} className="min-h-full">
              {/* Date Headers */}
              <div className="h-14 border-b flex sticky top-0 bg-background/95 backdrop-blur-sm z-10">
                {days.map((day, i) => {
                  const isWeekStart = day.getDay() === 1;
                  const today = isToday(day);

                  return (
                    <div
                      key={i}
                      className={cn(
                        "w-12 flex-none border-r border-border/30 flex flex-col items-center justify-end pb-1",
                        isWeekStart && "border-l border-border",
                        today && "bg-primary/5"
                      )}
                    >
                      {isWeekStart && (
                        <div className="text-[10px] text-muted-foreground mb-0.5">
                          {format(day, "MMM")}
                        </div>
                      )}
                      <div className={cn(
                        "text-xs font-medium",
                        today ? "text-primary" : "text-muted-foreground"
                      )}>
                        {format(day, "d")}
                      </div>
                      <div className={cn(
                        "text-[10px]",
                        today ? "text-primary" : "text-muted-foreground/60"
                      )}>
                        {format(day, "EEE")}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Vessel Rows */}
              {Array.from(batchesByVessel.entries()).map(([vesselName, vesselBatches]) => (
                <div
                  key={vesselName}
                  className={cn(
                    "h-16 border-b relative",
                    vesselName === "unassigned" && "bg-muted/20"
                  )}
                >
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {days.map((day, i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-12 flex-none border-r border-border/20",
                          day.getDay() === 1 && "border-l border-border/40",
                          isToday(day) && "bg-primary/5"
                        )}
                      />
                    ))}
                  </div>

                  {/* Batch bars */}
                  {vesselBatches.map((batch) => {
                    const style = getBatchStyle(batch);
                    if (!style) return null;

                    const colors = getTimelineColors(batch.status);

                    return (
                      <Tooltip key={batch.id}>
                        <TooltipTrigger asChild>
                          <Link
                            href={`/production/batches/${batch.id}`}
                            className={cn(
                              "absolute top-2 h-12 rounded-md border-2 flex items-center px-2 gap-1.5",
                              "cursor-pointer transition-all hover:scale-[1.02] hover:z-20",
                              "shadow-sm",
                              colors.bg,
                              colors.border,
                              colors.text
                            )}
                            style={{ left: style.left, width: Math.max(style.width - 4, 40) }}
                          >
                            {STATUS_ICONS[batch.status]}
                            <span className="text-xs font-medium truncate">
                              {batch.batch_number}
                            </span>
                            {batch.volume_bbl && (
                              <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1 border-current/30">
                                {batch.volume_bbl} BBL
                              </Badge>
                            )}
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <div className="space-y-1">
                            <div className="font-semibold">{batch.batch_number}</div>
                            <div>{batch.name}</div>
                            {batch.brand_name && (
                              <div className="text-muted-foreground text-xs">{batch.brand_name} • {batch.recipe_name}</div>
                            )}
                            <div className="text-xs text-muted-foreground pt-1 border-t">
                              {batch.fermentation_days}d ferm + {batch.conditioning_days}d cond
                              {batch.estimated_ready_date && (
                                <span className="ml-2">→ Ready {format(parseISO(batch.estimated_ready_date), "MMM d")}</span>
                              )}
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}

              {/* Demand/Shortfall Row */}
              <div className="h-20 border-b relative bg-destructive/5">
                {/* Grid lines */}
                <div className="absolute inset-0 flex pointer-events-none">
                  {days.map((day, i) => (
                    <div
                      key={i}
                      className={cn(
                        "w-12 flex-none border-r border-border/20",
                        day.getDay() === 1 && "border-l border-border/40",
                        isToday(day) && "bg-primary/5"
                      )}
                    />
                  ))}
                </div>

                {/* Shortfall markers */}
                {shortfalls.map((shortfall, idx) => {
                  const demandDate = parseISO(shortfall.demand_week);
                  const brewDate = parseISO(shortfall.recommended_brew_start);
                  const offset = differenceInDays(brewDate, startDate);

                  if (offset < -7 || offset > days.length + 7) return null;

                  const left = offset * 48;

                  return (
                    <Tooltip key={`${shortfall.brand_id}-${shortfall.selling_format_id}-${idx}`}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setSelectedShortfall(shortfall)}
                          className={cn(
                            "absolute top-3 flex flex-col items-center gap-0.5 cursor-pointer",
                            "hover:scale-110 transition-transform z-10"
                          )}
                          style={{ left: left + 8 }}
                        >
                          <AlertTriangle className={cn(
                            "h-5 w-5",
                            shortfall.is_urgent ? "text-destructive" : "text-amber-500"
                          )} />
                          <div className={cn(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded",
                            shortfall.is_urgent ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-700"
                          )}>
                            {shortfall.shortfall_quantity.toLocaleString()}
                          </div>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <div className="space-y-1">
                          <div className="font-semibold flex items-center gap-2">
                            {shortfall.is_urgent && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                            {shortfall.brand_name}
                          </div>
                          <div>{shortfall.selling_format_name}</div>
                          <div className="text-xs text-muted-foreground">
                            Need {shortfall.shortfall_quantity.toLocaleString()} by {format(demandDate, "MMM d")}
                          </div>
                          <div className="text-xs text-muted-foreground pt-1 border-t">
                            Brew by {format(brewDate, "MMM d")} ({shortfall.lead_time_days}d lead)
                          </div>
                          <Button size="sm" className="w-full mt-2 h-7 text-xs" variant={shortfall.is_urgent ? "destructive" : "secondary"}>
                            <Plus className="h-3 w-3 mr-1" />
                            Create Batch
                          </Button>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Today indicator */}
        <div className="absolute bottom-4 right-4 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-xs font-semibold shadow-lg">
          {format(new Date(), "EEEE, MMM d")}
        </div>
      </div>

      {/* Create Batch Dialog */}
      {selectedShortfall && (
        <CreateBatchFromShortfall
          shortfall={selectedShortfall}
          open={!!selectedShortfall}
          onOpenChange={(open) => !open && setSelectedShortfall(null)}
          onSuccess={handleBatchCreated}
        />
      )}
    </TooltipProvider>
  );
}
