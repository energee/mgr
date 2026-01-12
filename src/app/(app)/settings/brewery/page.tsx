"use client";

/**
 * Brewery Settings Page
 *
 * Configure brewery info, TTB information, and business defaults.
 */

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

const settingsSchema = z.object({
  brewery_name: z.string().min(1, "Brewery name is required"),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  website: z.string().url().nullable().optional().or(z.literal("")),
  timezone: z.string().optional(),
  ttb_permit_number: z.string().nullable().optional(),
  ttb_registry_number: z.string().nullable().optional(),
  default_batch_size_gallons: z.coerce.number().positive().nullable().optional(),
  fiscal_year_start_month: z.coerce.number().min(1).max(12).optional(),
  address_street: z.string().nullable().optional(),
  address_city: z.string().nullable().optional(),
  address_state: z.string().nullable().optional(),
  address_zip: z.string().nullable().optional(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function BrewerySettingsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("*")
        .eq("id", SETTINGS_ID)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      brewery_name: "",
      phone: "",
      email: "",
      website: "",
      timezone: "America/New_York",
      ttb_permit_number: "",
      ttb_registry_number: "",
      default_batch_size_gallons: 7,
      fiscal_year_start_month: 1,
      address_street: "",
      address_city: "",
      address_state: "",
      address_zip: "",
    },
  });

  useEffect(() => {
    if (settings) {
      const address = settings.address as { street?: string; city?: string; state?: string; zip?: string } | null;
      form.reset({
        brewery_name: settings.brewery_name || "",
        phone: settings.phone || "",
        email: settings.email || "",
        website: settings.website || "",
        timezone: settings.timezone || "America/New_York",
        ttb_permit_number: settings.ttb_permit_number || "",
        ttb_registry_number: settings.ttb_registry_number || "",
        default_batch_size_gallons: settings.default_batch_size_gallons || 7,
        fiscal_year_start_month: settings.fiscal_year_start_month || 1,
        address_street: address?.street || "",
        address_city: address?.city || "",
        address_state: address?.state || "",
        address_zip: address?.zip || "",
      });
    }
  }, [settings, form]);

  const mutation = useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      const { error } = await supabase
        .from("settings")
        .update({
          brewery_name: values.brewery_name,
          phone: values.phone || null,
          email: values.email || null,
          website: values.website || null,
          timezone: values.timezone,
          ttb_permit_number: values.ttb_permit_number || null,
          ttb_registry_number: values.ttb_registry_number || null,
          default_batch_size_gallons: values.default_batch_size_gallons || null,
          fiscal_year_start_month: values.fiscal_year_start_month,
          address: {
            street: values.address_street || null,
            city: values.address_city || null,
            state: values.address_state || null,
            zip: values.address_zip || null,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", SETTINGS_ID);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const onSubmit = (values: SettingsFormValues) => {
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
          <h1 className="text-2xl font-bold">Brewery Settings</h1>
          <p className="text-muted-foreground">Configure your brewery information</p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>Your brewery name and contact details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="brewery_name">Brewery Name *</Label>
                <Input id="brewery_name" {...form.register("brewery_name")} />
                {form.formState.errors.brewery_name && (
                  <p className="text-sm text-destructive">{form.formState.errors.brewery_name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" {...form.register("phone")} placeholder="(555) 123-4567" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...form.register("email")} placeholder="info@brewery.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input id="website" {...form.register("website")} placeholder="https://brewery.com" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
            <CardDescription>Physical location of your brewery</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="address_street">Street Address</Label>
              <Input id="address_street" {...form.register("address_street")} placeholder="123 Brewery Lane" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="address_city">City</Label>
                <Input id="address_city" {...form.register("address_city")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address_state">State</Label>
                <Input id="address_state" {...form.register("address_state")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address_zip">ZIP Code</Label>
                <Input id="address_zip" {...form.register("address_zip")} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* TTB Information */}
        <Card>
          <CardHeader>
            <CardTitle>TTB Information</CardTitle>
            <CardDescription>Federal permits for tax reporting</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ttb_permit_number">TTB Permit Number</Label>
                <Input id="ttb_permit_number" {...form.register("ttb_permit_number")} placeholder="e.g., BR-NY-12345" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ttb_registry_number">TTB Registry Number</Label>
                <Input id="ttb_registry_number" {...form.register("ttb_registry_number")} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Business Defaults */}
        <Card>
          <CardHeader>
            <CardTitle>Business Defaults</CardTitle>
            <CardDescription>Default values for new batches and reporting</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="default_batch_size_gallons">Default Batch Size (Gallons)</Label>
                <Input
                  id="default_batch_size_gallons"
                  type="number"
                  step="0.01"
                  {...form.register("default_batch_size_gallons")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fiscal_year_start_month">Fiscal Year Start Month</Label>
                <select
                  id="fiscal_year_start_month"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register("fiscal_year_start_month")}
                >
                  {[
                    "January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December"
                  ].map((month, index) => (
                    <option key={month} value={index + 1}>{month}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <select
                  id="timezone"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  {...form.register("timezone")}
                >
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending}>
            <Save className="h-4 w-4 mr-2" />
            {mutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        {mutation.isSuccess && (
          <p className="text-sm text-green-600 text-right">Settings saved successfully!</p>
        )}
        {mutation.isError && (
          <p className="text-sm text-destructive text-right">Failed to save settings. Please try again.</p>
        )}
      </form>
    </div>
  );
}
