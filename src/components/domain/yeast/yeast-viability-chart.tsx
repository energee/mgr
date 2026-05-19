"use client";

/**
 * Yeast Viability Decay Chart
 *
 * Renders a Recharts LineChart showing viability decay over time.
 * Includes reference lines at key thresholds (75%, 50%, 25%)
 * and a vertical marker for the current day. Optionally shows
 * pitch event markers on the curve.
 */

import { useMemo } from "react";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ComposedChart,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculateViabilityDecay, type YeastForm } from "@/domain/yeast-calculations";
import { differenceInDays, addDays, format } from "date-fns";

// =============================================================================
// Types
// =============================================================================

type PitchEvent = {
  date: string;
  quantity: number;
}

type YeastViabilityChartProps = {
  /** Initial viability percentage (0-100) */
  initialViability: number;
  /** Date yeast was received or harvested (ISO string) */
  receivedDate: string;
  /** Yeast form — affects decay rate */
  form: YeastForm;
  /** Optional pitch events to mark on the chart */
  pitchEvents?: PitchEvent[];
  /** Optional CSS class */
  className?: string;
}

// =============================================================================
// Chart Configuration
// =============================================================================

const chartConfig: ChartConfig = {
  viability: {
    label: "Viability",
    color: "hsl(var(--chart-1))",
  },
  pitchEvent: {
    label: "Pitch Event",
    color: "hsl(var(--chart-3))",
  },
};

// =============================================================================
// Component
// =============================================================================

export function YeastViabilityChart({
  initialViability,
  receivedDate,
  form,
  pitchEvents,
  className,
}: YeastViabilityChartProps) {
  const today = new Date();
  const startDate = new Date(receivedDate);
  const daysOldToday = differenceInDays(today, startDate);

  // Build daily viability data points
  const chartData = useMemo(() => {
    const points: Array<{
      day: number;
      date: string;
      viability: number;
      pitchEvent?: number;
    }> = [];

    // Calculate up to 90 days or until viability < 10%
    for (let day = 0; day <= 90; day++) {
      const result = calculateViabilityDecay(initialViability, day, form);
      const dateAtDay = addDays(startDate, day);

      points.push({
        day,
        date: format(dateAtDay, "MMM d"),
        viability: Math.round(result.viability * 10) / 10,
      });

      if (result.viability < 10) break;
    }

    // Overlay pitch events if provided
    if (pitchEvents) {
      for (const event of pitchEvents) {
        const eventDay = differenceInDays(new Date(event.date), startDate);
        const existing = points.find((p) => p.day === eventDay);
        if (existing) {
          existing.pitchEvent = existing.viability;
        }
      }
    }

    return points;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialViability, receivedDate, form, pitchEvents]);

  if (chartData.length < 2) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Viability Decay</CardTitle>
      </CardHeader>
      <CardContent>
        <figure aria-label="Viability decay curve over time">
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={40}
                tickFormatter={(day: number) => {
                  const d = addDays(startDate, day);
                  return format(d, "MMM d");
                }}
                label={{
                  value: "Days",
                  position: "insideBottomRight",
                  offset: -5,
                }}
              />
              <YAxis
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value: number) => `${value}%`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      if (payload?.[0]) {
                        return `Day ${payload[0].payload.day} \u2014 ${payload[0].payload.date}`;
                      }
                      return "";
                    }}
                    formatter={(value) => [`${value}%`, "Viability"]}
                  />
                }
              />

              {/* Threshold reference lines */}
              <ReferenceLine
                y={75}
                stroke="hsl(var(--chart-2))"
                strokeDasharray="5 5"
                label={{
                  value: "75% Good",
                  position: "right",
                  fill: "hsl(var(--muted-foreground))",
                  fontSize: 11,
                }}
              />
              <ReferenceLine
                y={50}
                stroke="hsl(var(--chart-4))"
                strokeDasharray="5 5"
                label={{
                  value: "50% Marginal",
                  position: "right",
                  fill: "hsl(var(--muted-foreground))",
                  fontSize: 11,
                }}
              />
              <ReferenceLine
                y={25}
                stroke="hsl(var(--destructive))"
                strokeDasharray="5 5"
                label={{
                  value: "25% Low",
                  position: "right",
                  fill: "hsl(var(--muted-foreground))",
                  fontSize: 11,
                }}
              />

              {/* Today marker */}
              {daysOldToday >= 0 && daysOldToday <= 90 && (
                <ReferenceLine
                  x={daysOldToday}
                  stroke="hsl(var(--foreground))"
                  strokeDasharray="3 3"
                  label={{
                    value: "Today",
                    position: "top",
                    fill: "hsl(var(--foreground))",
                    fontSize: 12,
                  }}
                />
              )}

              {/* Main viability line */}
              <Line
                type="monotone"
                dataKey="viability"
                stroke="var(--color-viability)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />

              {/* Pitch event markers */}
              {pitchEvents && pitchEvents.length > 0 && (
                <Scatter
                  dataKey="pitchEvent"
                  fill="var(--color-pitchEvent)"
                  shape="diamond"
                />
              )}
            </ComposedChart>
          </ChartContainer>

          {/* Accessible data table */}
          <table className="sr-only">
            <caption>Viability decay data</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Viability</th>
              </tr>
            </thead>
            <tbody>
              {chartData
                .filter((_, i) => i % 7 === 0)
                .map((point) => (
                  <tr key={point.day}>
                    <td>Day {point.day}</td>
                    <td>{point.viability}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </figure>
      </CardContent>
    </Card>
  );
}
