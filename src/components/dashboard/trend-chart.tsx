"use client";

/**
 * Trend Chart
 *
 * Reusable Recharts wrapper for time-series data on dashboards.
 * Renders area or bar charts with consistent styling:
 * - Monospace numbers on axes
 * - Muted grid lines
 * - Tooltip on hover
 * - Responsive width
 */

import { useMemo, type ReactNode } from "react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type {
  Payload as TooltipPayload,
  ValueType,
  NameType,
} from "recharts/types/component/DefaultTooltipContent";
import { format, parseISO } from "date-fns";

// =============================================================================
// Types
// =============================================================================

interface TrendSeries {
  /** Data key in the data array */
  key: string;
  /** Display label in tooltip/legend */
  label: string;
  /** CSS color or chart variable (e.g., "hsl(var(--chart-1))") */
  color?: string;
}

interface TrendChartProps {
  /** Array of data points, each with a date field and metric fields */
  data: Array<Record<string, unknown>>;
  /** Key in data for the x-axis date values (ISO date string) */
  xKey: string;
  /** Series definitions */
  series: TrendSeries[];
  /** Chart type: area (default) or bar. Applies to all series. */
  type?: "area" | "bar";
  /** Chart height in pixels (default: 200) */
  height?: number;
  /** Custom value formatter for tooltip and y-axis */
  formatValue?: (value: number) => string;
  /** Additional className for the container */
  className?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
];

// =============================================================================
// Component
// =============================================================================

export function TrendChart({
  data,
  xKey,
  series,
  type: chartType = "area",
  height = 200,
  formatValue,
  className,
}: TrendChartProps) {
  // Build ChartConfig from series
  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      config[s.key] = {
        label: s.label,
        color: s.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      };
    }
    return config;
  }, [series]);

  // Format date labels for x-axis
  const formatDate = (value: string) => {
    try {
      return format(parseISO(value), "MMM d");
    } catch {
      return value;
    }
  };

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        No data for this period
      </div>
    );
  }

  const yAxisFormatter = formatValue || ((v: number) => v.toLocaleString());

  // Shared tooltip label formatter (used by both chart types)
  const tooltipLabelFormatter = (_: ReactNode, payload: ReadonlyArray<TooltipPayload<ValueType, NameType>>) => {
    const firstPayload = payload?.[0]?.payload;
    if (firstPayload?.[xKey]) {
      try {
        return format(parseISO(String(firstPayload[xKey])), "EEE, MMM d");
      } catch {
        return String(firstPayload[xKey]);
      }
    }
    return "";
  };

  if (chartType === "bar") {
    return (
      <figure className={className} aria-label={series.map((s) => s.label).join(", ")}>
        <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey={xKey}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={formatDate}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={yAxisFormatter}
              width={48}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent labelFormatter={tooltipLabelFormatter} />
              }
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={`var(--color-${s.key})`}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </figure>
    );
  }

  // Area chart (default)
  return (
    <figure className={className} aria-label={series.map((s) => s.label).join(", ")}>
      <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatDate}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={yAxisFormatter}
            width={48}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent labelFormatter={tooltipLabelFormatter} />
            }
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={`var(--color-${s.key})`}
              fill={`var(--color-${s.key})`}
              fillOpacity={0.1}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ChartContainer>
    </figure>
  );
}
