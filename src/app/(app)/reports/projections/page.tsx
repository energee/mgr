"use client";

/**
 * Projections & COGS Report Page
 *
 * Tabbed report combining COGS analysis, weekly forecasting, and monthly outlook.
 * Shared controls: date range picker and sales channel filter.
 */

import React, { useState } from "react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { entityKeys } from "@/lib/query-keys";
import { COGSTab } from "./cogs-tab";
import { WeeklyTab } from "./weekly-tab";
import { MonthlyTab } from "./monthly-tab";

export default function ProjectionsPage() {
  const defaultFrom = format(
    startOfMonth(subMonths(new Date(), 1)),
    "yyyy-MM-dd"
  );
  const defaultTo = format(endOfMonth(new Date()), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [channelFilter, setChannelFilter] = useState<string | null>(null);

  const supabase = createClient();
  const { data: channels } = useQuery({
    queryKey: entityKeys.list("sales_channels", { is_active: true }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_channels")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const dateRange = { from: fromDate, to: toDate };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/reports">
          <Button variant="ghost" size="icon" aria-label="Back to reports">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            Projections & COGS
          </h1>
          <p className="text-muted-foreground">
            Cost analysis, margin tracking, and production forecasting
          </p>
        </div>
      </div>

      {/* Shared Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
          <CardDescription>
            Date range applies to COGS; projections use forward-looking horizon
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-2">
              <Label>From</Label>
              <DatePicker
                value={fromDate}
                onChange={(v) => v && setFromDate(v)}
              />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <DatePicker
                value={toDate}
                onChange={(v) => v && setToDate(v)}
              />
            </div>
            <div className="space-y-2">
              <Label>Sales Channel</Label>
              <Select
                value={channelFilter ?? "_all"}
                onValueChange={(v) =>
                  setChannelFilter(v === "_all" ? null : v)
                }
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All Channels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Channels</SelectItem>
                  {channels?.map((ch) => (
                    <SelectItem key={ch.id} value={ch.id}>
                      {ch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="cogs">
        <TabsList>
          <TabsTrigger value="cogs">COGS & Margins</TabsTrigger>
          <TabsTrigger value="weekly">Weekly Forecast</TabsTrigger>
          <TabsTrigger value="monthly">Monthly Outlook</TabsTrigger>
        </TabsList>
        <TabsContent value="cogs" className="mt-4">
          <COGSTab dateRange={dateRange} channelFilter={channelFilter} />
        </TabsContent>
        <TabsContent value="weekly" className="mt-4">
          <WeeklyTab channelFilter={channelFilter} />
        </TabsContent>
        <TabsContent value="monthly" className="mt-4">
          <MonthlyTab channelFilter={channelFilter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
