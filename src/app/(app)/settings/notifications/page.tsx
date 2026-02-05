"use client";

/**
 * Notification Preferences Page
 *
 * Allows users to configure their notification preferences:
 * - Enable/disable notification types
 * - Email digest settings
 * - Quiet hours configuration
 */

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { settingsKeys } from "@/lib/query-keys";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimePicker } from "@/components/ui/time-picker";
import { Loader2 } from "lucide-react";
import { useSubmitShortcut } from "@/hooks/use-submit-shortcut";
import { Kbd, KbdGroup } from "@/components/ui/kbd";


// =============================================================================
// Types & Schema
// =============================================================================

const preferencesSchema = z.object({
  // Type preferences
  batch_status_enabled: z.boolean(),
  inventory_low_enabled: z.boolean(),
  order_received_enabled: z.boolean(),
  system_enabled: z.boolean(),
  // Delivery preferences
  in_app_enabled: z.boolean(),
  email_enabled: z.boolean(),
  email_digest_frequency: z.enum(["never", "daily", "weekly"]),
  // Quiet hours
  quiet_hours_enabled: z.boolean(),
  quiet_hours_start: z.string().nullable().optional(),
  quiet_hours_end: z.string().nullable().optional(),
});

type PreferencesFormValues = z.infer<typeof preferencesSchema>;

const defaultPreferences: PreferencesFormValues = {
  batch_status_enabled: true,
  inventory_low_enabled: true,
  order_received_enabled: true,
  system_enabled: true,
  in_app_enabled: true,
  email_enabled: false,
  email_digest_frequency: "never",
  quiet_hours_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
};

// =============================================================================
// Component
// =============================================================================

export default function NotificationPreferencesPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [isMac, setIsMac] = useState(false);
  const submitRef = useSubmitShortcut();

  useEffect(() => {
    setIsMac(navigator.userAgent.includes("Mac"));
  }, []);

  // Fetch preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: settingsKeys.notificationPreferences(),
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data, error } = await db
        .from("notification_preferences")
        .select("*")
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows returned
        throw error;
      }

      return data || null;
    },
  });

  // Form setup
  const form = useForm<PreferencesFormValues>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: defaultPreferences,
  });

  // Reset form when preferences load
  useEffect(() => {
    if (preferences) {
      form.reset({
        batch_status_enabled: preferences.batch_status_enabled ?? true,
        inventory_low_enabled: preferences.inventory_low_enabled ?? true,
        order_received_enabled: preferences.order_received_enabled ?? true,
        system_enabled: preferences.system_enabled ?? true,
        in_app_enabled: preferences.in_app_enabled ?? true,
        email_enabled: preferences.email_enabled ?? false,
        email_digest_frequency: preferences.email_digest_frequency ?? "never",
        quiet_hours_enabled: preferences.quiet_hours_enabled ?? false,
        quiet_hours_start: preferences.quiet_hours_start ?? null,
        quiet_hours_end: preferences.quiet_hours_end ?? null,
      });
    }
  }, [preferences, form]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (values: PreferencesFormValues) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Upsert preferences
      const { error } = await db
        .from("notification_preferences")
        .upsert(
          {
            user_id: user.id,
            ...values,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.notificationPreferences() });
      toast.success("Preferences saved");
    },
    onError: (error) => {
      console.error("Failed to save preferences:", error);
      toast.error("Failed to save preferences");
    },
  });

  const onSubmit = (values: PreferencesFormValues) => {
    saveMutation.mutate(values);
  };

  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch() incompatible with React Compiler
  const watchQuietHours = form.watch("quiet_hours_enabled");
  const watchEmailEnabled = form.watch("email_enabled");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading preferences...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Notification Preferences</h1>
        <p className="text-muted-foreground">
          Configure how and when you receive notifications
        </p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Notification Types */}
        <Card>
          <CardHeader>
            <CardTitle>Notification Types</CardTitle>
            <CardDescription>
              Choose which types of notifications you want to receive
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Batch Status Updates</Label>
                <p className="text-sm text-muted-foreground">
                  Notifications when batches change status
                </p>
              </div>
              <Switch
                checked={form.watch("batch_status_enabled")}
                onCheckedChange={(checked) =>
                  form.setValue("batch_status_enabled", checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Inventory Alerts</Label>
                <p className="text-sm text-muted-foreground">
                  Notifications for low inventory levels
                </p>
              </div>
              <Switch
                checked={form.watch("inventory_low_enabled")}
                onCheckedChange={(checked) =>
                  form.setValue("inventory_low_enabled", checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Order Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Notifications for new orders received
                </p>
              </div>
              <Switch
                checked={form.watch("order_received_enabled")}
                onCheckedChange={(checked) =>
                  form.setValue("order_received_enabled", checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>System Announcements</Label>
                <p className="text-sm text-muted-foreground">
                  Important system updates and announcements
                </p>
              </div>
              <Switch
                checked={form.watch("system_enabled")}
                onCheckedChange={(checked) =>
                  form.setValue("system_enabled", checked)
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Delivery Preferences */}
        <Card>
          <CardHeader>
            <CardTitle>Delivery Preferences</CardTitle>
            <CardDescription>
              Configure how notifications are delivered to you
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>In-App Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Show notifications in the app
                </p>
              </div>
              <Switch
                checked={form.watch("in_app_enabled")}
                onCheckedChange={(checked) =>
                  form.setValue("in_app_enabled", checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Email Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Receive notifications via email
                </p>
              </div>
              <Switch
                checked={form.watch("email_enabled")}
                onCheckedChange={(checked) =>
                  form.setValue("email_enabled", checked)
                }
              />
            </div>

            {watchEmailEnabled && (
              <div className="flex items-center justify-between pl-6 border-l-2 border-muted">
                <div className="space-y-0.5">
                  <Label>Email Digest Frequency</Label>
                  <p className="text-sm text-muted-foreground">
                    How often to send email digests
                  </p>
                </div>
                <Select
                  value={form.watch("email_digest_frequency")}
                  onValueChange={(value) =>
                    form.setValue(
                      "email_digest_frequency",
                      value as "never" | "daily" | "weekly"
                    )
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quiet Hours */}
        <Card>
          <CardHeader>
            <CardTitle>Quiet Hours</CardTitle>
            <CardDescription>
              Pause notifications during specific hours
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Quiet Hours</Label>
                <p className="text-sm text-muted-foreground">
                  Don&apos;t send notifications during quiet hours
                </p>
              </div>
              <Switch
                checked={form.watch("quiet_hours_enabled")}
                onCheckedChange={(checked) =>
                  form.setValue("quiet_hours_enabled", checked)
                }
              />
            </div>

            {watchQuietHours && (
              <div className="flex items-center gap-4 pl-6 border-l-2 border-muted">
                <div className="space-y-1">
                  <Label>Start Time</Label>
                  <TimePicker
                    value={form.watch("quiet_hours_start") || "22:00"}
                    onChange={(value) =>
                      form.setValue("quiet_hours_start", value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>End Time</Label>
                  <TimePicker
                    value={form.watch("quiet_hours_end") || "08:00"}
                    onChange={(value) =>
                      form.setValue("quiet_hours_end", value)
                    }
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end">
          <Button ref={submitRef} type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Preferences
            <KbdGroup>
              <Kbd>{isMac ? "\u2318" : "Ctrl"}</Kbd>
              <Kbd>{isMac ? "\u21B5" : "Enter"}</Kbd>
            </KbdGroup>
          </Button>
        </div>
      </form>
    </div>
  );
}
