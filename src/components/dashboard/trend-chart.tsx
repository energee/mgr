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

type TrendSeries = {
  /** Data key in the data array */
  key: string;
  /** Display label in tooltip/legend */
  label: string;
  /** CSS color or chart variable (e.g., "hsl(var(--chart-1))") */
  color?: string;
}

type TrendChartProps = {
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
  /** Custom formatter for the tooltip's date label. Receives the ISO date string. */
  formatTooltipDate?: (isoDate: string) => string;
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
  formatTooltipDate,
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

  // SR-only table date formatter: prefer the explicit tooltip date formatter
  // (richer label like "Mon, May 14") so screen-reader users hear the full
  // date, falling back to the x-axis short format.
  const tableDateFormatter = formatTooltipDate || formatDate;

  // Shared tooltip label formatter (used by both chart types)
  const tooltipLabelFormatter = (_: ReactNode, payload: ReadonlyArray<TooltipPayload<ValueType, NameType>>) => {
    const firstPayload = payload?.[0]?.payload;
    if (firstPayload?.[xKey]) {
      const iso = String(firstPayload[xKey]);
      if (formatTooltipDate) return formatTooltipDate(iso);
      try {
        return format(parseISO(iso), "EEE, MMM d");
      } catch {
        return iso;
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
        <ChartDataTableFallback
          data={data}
          xKey={xKey}
          series={series}
          formatValue={yAxisFormatter}
          formatDate={tableDateFormatter}
        />
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
      <ChartDataTableFallback
        data={data}
        xKey={xKey}
        series={series}
        formatValue={yAxisFormatter}
        formatDate={tableDateFormatter}
      />
    </figure>
  );
}

/**
 * Visually-hidden data-table mirror of the chart data so screen-reader users
 * get the same information as sighted users. Lives inside the same <figure>
 * as the chart (audit F-101). Rendered with `sr-only` so it never affects
 * layout but shows up for assistive tech and "select all + copy" workflows.
 *
 * The date column is rendered through the same `formatDate` helper used by
 * the x-axis/tooltip so SR users hear "May 14" instead of a raw ISO string.
 */
function ChartDataTableFallback({
  data,
  xKey,
  series,
  formatValue,
  formatDate,
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: TrendSeries[];
  formatValue: (value: number) => string;
  formatDate: (isoDate: string) => string;
}) {
  return (
    <table className="sr-only">
      <caption>Chart data ({series.map((s) => s.label).join(", ")})</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          {series.map((s) => (
            <th key={s.key} scope="col">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => {
          const raw = row[xKey];
          const iso = raw == null ? "" : String(raw);
          return (
            <tr key={iso}>
              <th scope="row">{iso ? formatDate(iso) : ""}</th>
              {series.map((s) => {
                const v = row[s.key];
                return (
                  <td key={s.key}>
                    {typeof v === "number" ? formatValue(v) : String(v ?? "")}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
