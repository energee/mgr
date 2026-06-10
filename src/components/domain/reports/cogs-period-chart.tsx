"use client";

/**
 * COGS by Period Chart
 *
 * Stacked bar chart of ingredient cost categories (malts, hops, yeast,
 * adjuncts, other) per time period for the COGS report's By Period tab.
 * Extracted from the report page so the recharts dependency can be
 * lazy-loaded via cogs-period-chart-lazy.tsx.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/lib/format";

/** One bar per period; structurally compatible with the page's CogsPeriodRow */
export type CogsPeriodChartDatum = {
  period: string;
  malt_cost: number;
  hop_cost: number;
  yeast_cost: number;
  adjunct_cost: number;
  other_cost: number;
};

export function CogsPeriodChart({ data }: { data: CogsPeriodChartDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="period" />
        <YAxis
          tickFormatter={(v: number) =>
            `$${(v / 1000).toFixed(0)}k`
          }
        />
        <Tooltip
          formatter={(v) => formatCurrency(v as number)}
        />
        <Legend />
        <Bar
          dataKey="malt_cost"
          name="Malts"
          stackId="a"
          fill="hsl(var(--chart-1))"
        />
        <Bar
          dataKey="hop_cost"
          name="Hops"
          stackId="a"
          fill="hsl(var(--chart-2))"
        />
        <Bar
          dataKey="yeast_cost"
          name="Yeast"
          stackId="a"
          fill="hsl(var(--chart-3))"
        />
        <Bar
          dataKey="adjunct_cost"
          name="Adjuncts"
          stackId="a"
          fill="hsl(var(--chart-4))"
        />
        <Bar
          dataKey="other_cost"
          name="Other"
          stackId="a"
          fill="hsl(var(--chart-5))"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
