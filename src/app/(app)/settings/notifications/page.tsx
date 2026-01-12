"use client";

/**
 * Notification Settings Page
 *
 * Configure notification preferences and alert thresholds.
 */

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Save, Bell, Package, Beaker, AlertTriangle, Calendar } from "lucide-react";
import Link from "next/link";

const notificationSchema = z.object({
  batch_status_changes: z.boolean().optional(),
  low_inventory_alerts: z.boolean().optional(),
  expiring_lots: z.boolean().optional(),
  order_updates: z.boolean().optional(),
  fermentation_alerts: z.boolean().optional(),
  packaging_reminders: z.boolean().optional(),
  email_digest: z.boolean().optional(),
  email_frequency: z.enum(["daily", "weekly", "never"]).optional(),
});

type NotificationFormValues = z.infer<typeof notificationSchema>;

export default function NotificationSettingsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });

  const { data: preferences, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    enabled: !!currentUser,
    queryFn: async () => {
      // For now, we store notification preferences in localStorage
      // In production, this would be in a database table
      const stored = localStorage.getItem(`notification-prefs-${currentUser?.id}`);
      if (stored) {
        return JSON.parse(stored) as NotificationFormValues;
      }
      return null;
    },
  });

  const form = useForm<NotificationFormValues>({
    resolver: zodResolver(notificationSchema),
    defaultValues: {
      batch_status_changes: true,
      low_inventory_alerts: true,
      expiring_lots: true,
      order_updates: true,
      fermentation_alerts: true,
      packaging_reminders: true,
      email_digest: false,
      email_frequency: "never",
    },
  });

  useEffect(() => {
    if (preferences) {
      form.reset(preferences);
    }
  }, [preferences, form]);

  const mutation = useMutation({
    mutationFn: async (values: NotificationFormValues) => {
      // Store in localStorage for now
      localStorage.setItem(`notification-prefs-${currentUser?.id}`, JSON.stringify(values));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
  });

  const onSubmit = (values: NotificationFormValues) => {
    mutation.mutate(values);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Notification Settings</h1>
          <p className="text-muted-foreground">Configure your alert preferences</p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Production Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Beaker className="h-5 w-5" />
              Production
            </CardTitle>
            <CardDescription>Notifications related to batches and brewing</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="batch_status_changes">Batch Status Changes</Label>
                <p className="text-sm text-muted-foreground">
                  Get notified when batch status changes
                </p>
              </div>
              <Switch
                id="batch_status_changes"
                checked={form.watch("batch_status_changes")}
                onCheckedChange={(checked) => form.setValue("batch_status_changes", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="fermentation_alerts">Fermentation Alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Alerts for temperature or gravity readings outside target range
                </p>
              </div>
              <Switch
                id="fermentation_alerts"
                checked={form.watch("fermentation_alerts")}
                onCheckedChange={(checked) => form.setValue("fermentation_alerts", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="packaging_reminders">Packaging Reminders</Label>
                <p className="text-sm text-muted-foreground">
                  Reminders for scheduled packaging sessions
                </p>
              </div>
              <Switch
                id="packaging_reminders"
                checked={form.watch("packaging_reminders")}
                onCheckedChange={(checked) => form.setValue("packaging_reminders", checked)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Inventory Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Inventory
            </CardTitle>
            <CardDescription>Notifications related to stock levels and expiration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="low_inventory_alerts">Low Inventory Alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Alert when items fall below reorder point
                </p>
              </div>
              <Switch
                id="low_inventory_alerts"
                checked={form.watch("low_inventory_alerts")}
                onCheckedChange={(checked) => form.setValue("low_inventory_alerts", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="expiring_lots">Expiring Lots</Label>
                <p className="text-sm text-muted-foreground">
                  Alert for lots expiring within 30 days
                </p>
              </div>
              <Switch
                id="expiring_lots"
                checked={form.watch("expiring_lots")}
                onCheckedChange={(checked) => form.setValue("expiring_lots", checked)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Sales Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Sales
            </CardTitle>
            <CardDescription>Notifications related to orders and customers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="order_updates">Order Updates</Label>
                <p className="text-sm text-muted-foreground">
                  New orders and status changes
                </p>
              </div>
              <Switch
                id="order_updates"
                checked={form.watch("order_updates")}
                onCheckedChange={(checked) => form.setValue("order_updates", checked)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Email Digest */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Email Digest
            </CardTitle>
            <CardDescription>Receive a summary of notifications via email</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email_digest">Enable Email Digest</Label>
                <p className="text-sm text-muted-foreground">
                  Receive notification summaries via email
                </p>
              </div>
              <Switch
                id="email_digest"
                checked={form.watch("email_digest")}
                onCheckedChange={(checked) => form.setValue("email_digest", checked)}
              />
            </div>
            {form.watch("email_digest") && (
              <div className="space-y-2">
                <Label htmlFor="email_frequency">Frequency</Label>
                <select
                  id="email_frequency"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register("email_frequency")}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            <Save className="h-4 w-4 mr-2" />
            {mutation.isPending ? "Saving..." : "Save Preferences"}
          </Button>
        </div>

        {mutation.isSuccess && (
          <p className="text-sm text-green-600 text-right">Preferences saved successfully!</p>
        )}
      </form>
    </div>
  );
}
