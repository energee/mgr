"use client";

/**
 * BatchReadingsChart - Fermentation readings visualization
 *
 * Displays gravity and temperature readings over time using line charts.
 * Features:
 * - Gravity curve with optional target FG line
 * - Temperature profile
 * - Responsive design
 * - Toggle between metric types
 */

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import type { BatchReading } from "@/lib/batch-readings";
import { convertGravity } from "@/lib/batch-readings";
import { useGravityUnit, useTemperatureUnit } from "@/hooks/useUnitPreferences";
import {
  platoToSg,
  convertTemperature,
  UNIT_LABELS,
} from "@/lib/units";

// =============================================================================
// Types
// =============================================================================

type BatchLog = {
  id: string;
  batch_id: string;
  log_type: string;
  data: BatchReading;
  created_at: string;
}

type BatchReadingsChartProps = {
  readings: BatchLog[];
  targetFG?: number | null; // Target FG in Plato
  className?: string;
}

type ChartMetric = "gravity" | "temperature";

// =============================================================================
// Chart Configuration
// =============================================================================

const CHART_PADDING_PERCENT = 0.1;
const CHART_MIN_PADDING = 2;

const chartConfig: ChartConfig = {
  gravity: {
    label: "Gravity",
    color: "hsl(var(--chart-1))",
  },
  temperature: {
    label: "Temperature",
    color: "hsl(var(--chart-2))",
  },
  targetFG: {
    label: "Target FG",
    color: "hsl(var(--muted-foreground))",
  },
};

// =============================================================================
// Component
// =============================================================================

export function BatchReadingsChart({
  readings,
  targetFG,
  className,
}: BatchReadingsChartProps) {
  const [activeMetric, setActiveMetric] = useState<ChartMetric>("gravity");
  const gravityUnit = useGravityUnit();
  const tempUnit = useTemperatureUnit();

  // Filter and transform readings for the chart
  const chartData = useMemo(() => {
    const filteredReadings = readings
      .filter((log) => log.data.reading_type === activeMetric)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

    return filteredReadings.map((log) => {
      let value = typeof log.data.value === "number" ? log.data.value : parseFloat(String(log.data.value));

      if (activeMetric === "gravity") {
        // Normalize to Plato first, then to user's preferred unit.
        const plato = log.data.unit === "sg" ? convertGravity(value, "sg", "plato") : value;
        value = gravityUnit === "sg" ? platoToSg(plato) : plato;
      } else if (activeMetric === "temperature") {
        const f = log.data.unit === "c" ? convertTemperature(value, "c", "f") : value;
        value = convertTemperature(f, "f", tempUnit);
      }

      const decimals = activeMetric === "gravity" && gravityUnit === "sg" ? 3 : 1;
      const factor = Math.pow(10, decimals);

      return {
        timestamp: new Date(log.created_at).getTime(),
        date: format(new Date(log.created_at), "MMM d"),
        time: format(new Date(log.created_at), "h:mm a"),
        fullDate: format(new Date(log.created_at), "MMM d, h:mm a"),
        value: Math.round(value * factor) / factor,
        unit:
          activeMetric === "gravity"
            ? gravityUnit === "sg"
              ? ""
              : UNIT_LABELS.plato
            : UNIT_LABELS[tempUnit],
      };
    });
  }, [readings, activeMetric, gravityUnit, tempUnit]);

  // Count readings by type
  const readingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    readings.forEach((log) => {
      const type = log.data.reading_type;
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [readings]);

  // Calculate Y-axis domain
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 20];

    const values = chartData.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Add some padding
    const padding = (max - min) * CHART_PADDING_PERCENT || CHART_MIN_PADDING;

    if (activeMetric === "gravity") {
      // For gravity, also consider target FG
      const effectiveMin = targetFG ? Math.min(min, targetFG) : min;
      return [
        Math.floor(effectiveMin - padding),
        Math.ceil(max + padding),
      ];
    }

    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData, activeMetric, targetFG]);

  const hasGravityReadings = (readingCounts["gravity"] || 0) > 0;
  const hasTemperatureReadings = (readingCounts["temperature"] || 0) > 0;

  if (!hasGravityReadings && !hasTemperatureReadings) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Fermentation Chart</CardTitle>
          <Tabs
            value={activeMetric}
            onValueChange={(v) => setActiveMetric(v as ChartMetric)}
          >
            <TabsList className="h-8">
              {hasGravityReadings && (
                <TabsTrigger value="gravity" className="text-xs px-3">
                  Gravity ({readingCounts["gravity"]})
                </TabsTrigger>
              )}
              {hasTemperatureReadings && (
                <TabsTrigger value="temperature" className="text-xs px-3">
                  Temp ({readingCounts["temperature"]})
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length < 2 ? (
          <div className="flex h-[200px] items-center justify-center text-muted-foreground">
            Add more readings to see the chart
          </div>
        ) : (
          <figure aria-label={`${chartConfig[activeMetric]?.label ?? activeMetric} readings over time`}>
            <ChartContainer config={chartConfig} className="h-[250px] w-full">
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                />
                <YAxis
                  domain={yDomain}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) =>
                    activeMetric === "gravity"
                      ? gravityUnit === "sg"
                        ? Number(value).toFixed(3)
                        : `${value}${UNIT_LABELS.plato}`
                      : `${value}${UNIT_LABELS[tempUnit]}`
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        if (payload && payload[0]) {
                          return payload[0].payload.fullDate;
                        }
                        return "";
                      }}
                      formatter={(value) => {
                        const unit =
                          activeMetric === "gravity"
                            ? gravityUnit === "sg"
                              ? ""
                              : UNIT_LABELS.plato
                            : UNIT_LABELS[tempUnit];
                        return [`${value}${unit}`, chartConfig[activeMetric].label];
                      }}
                    />
                  }
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={`var(--color-${activeMetric})`}
                  strokeWidth={2}
                  dot={{ fill: `var(--color-${activeMetric})`, r: 4 }}
                  activeDot={{ r: 6 }}
                />
                {activeMetric === "gravity" && targetFG && (
                  <ReferenceLine
                    y={
                      gravityUnit === "sg"
                        ? Number(platoToSg(targetFG).toFixed(3))
                        : Math.round(targetFG * 10) / 10
                    }
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="5 5"
                    label={{
                      value:
                        gravityUnit === "sg"
                          ? `Target FG: ${platoToSg(targetFG).toFixed(3)}`
                          : `Target FG: ${targetFG.toFixed(1)}${UNIT_LABELS.plato}`,
                      position: "right",
                      fill: "hsl(var(--muted-foreground))",
                      fontSize: 12,
                    }}
                  />
                )}
              </LineChart>
            </ChartContainer>
            <table className="sr-only">
              <caption>{chartConfig[activeMetric]?.label ?? activeMetric} readings</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((point) => (
                  <tr key={point.timestamp}>
                    <td>{point.fullDate}</td>
                    <td>{point.value}{point.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        )}
      </CardContent>
    </Card>
  );
}
