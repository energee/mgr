"use client";

/**
 * System Settings Page
 *
 * Brewery-wide configuration settings including:
 * - Brewery information (name, address, contact)
 * - Tax rates (federal, state, sales)
 * - Fiscal year configuration
 * - Compliance information (TTB, ABC)
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Building2, Calculator, Calendar, FileText, Save } from "lucide-react";

// =============================================================================
// Schema
// =============================================================================

const systemSettingsSchema = z.object({
  // General
  brewery_name: z.string().min(1, "Brewery name is required"),
  brewery_street: z.string(),
  brewery_city: z.string(),
  brewery_state: z.string(),
  brewery_zip: z.string(),
  brewery_country: z.string(),
  brewery_phone: z.string(),
  brewery_email: z.string().email().or(z.literal("")),
  brewery_website: z.string().url().or(z.literal("")),
  timezone: z.string(),

  // Tax
  federal_excise_tax_rate: z.coerce.number().min(0),
  federal_excise_tax_rate_full: z.coerce.number().min(0),
  state_excise_tax_rate: z.coerce.number().min(0),
  sales_tax_rate: z.coerce.number().min(0).max(1),

  // Fiscal
  fiscal_year_start_month: z.coerce.number().min(1).max(12),
  fiscal_year_start_day: z.coerce.number().min(1).max(31),

  // Compliance
  ttb_brewery_number: z.string(),
  ttb_permit_number: z.string(),
  abc_license_number: z.string(),
});

type SystemSettingsForm = z.infer<typeof systemSettingsSchema>;

// =============================================================================
// Timezone Options
// =============================================================================

const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HT)" },
  { value: "Europe/London", label: "GMT/BST" },
  { value: "Europe/Berlin", label: "Central European Time" },
  { value: "Australia/Sydney", label: "Australian Eastern Time" },
];

const MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

// =============================================================================
// Hooks
// =============================================================================

interface SystemSettingRow {
  key: string;
  value: unknown;
}

function useSystemSettings() {
  const supabase = createClient();

  return useQuery({
    queryKey: ["system-settings"],
    queryFn: async () => {
      // Type assertion for table not yet in generated types
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => Promise<{ data: SystemSettingRow[] | null; error: Error | null }>;
        };
      }).from("system_settings").select("key, value");

      if (error) throw error;

      // Convert array to object
      const settings: Record<string, unknown> = {};
      for (const row of data || []) {
        settings[row.key] = row.value;
      }
      return settings;
    },
  });
}

function useUpdateSystemSettings() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      // Type assertion for table not yet in generated types
      const client = supabase as unknown as {
        from: (table: string) => {
          update: (data: { value: unknown }) => {
            eq: (col: string, val: string) => Promise<{ error: Error | null }>;
          };
        };
      };
      // Update each setting - value column is JSONB, Supabase handles serialization
      for (const [key, value] of Object.entries(updates)) {
        const { error } = await client
          .from("system_settings")
          .update({ value })
          .eq("key", key);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system-settings"] });
    },
  });
}

// =============================================================================
// Component
// =============================================================================

export default function SystemSettingsPage() {
  const { data: settings, isLoading } = useSystemSettings();
  const updateSettings = useUpdateSystemSettings();
  const [activeTab, setActiveTab] = useState("general");

  const form = useForm<SystemSettingsForm>({
    resolver: zodResolver(systemSettingsSchema),
    defaultValues: {
      brewery_name: "",
      brewery_street: "",
      brewery_city: "",
      brewery_state: "",
      brewery_zip: "",
      brewery_country: "USA",
      brewery_phone: "",
      brewery_email: "",
      brewery_website: "",
      timezone: "America/New_York",
      federal_excise_tax_rate: 3.5,
      federal_excise_tax_rate_full: 16.0,
      state_excise_tax_rate: 0,
      sales_tax_rate: 0,
      fiscal_year_start_month: 1,
      fiscal_year_start_day: 1,
      ttb_brewery_number: "",
      ttb_permit_number: "",
      abc_license_number: "",
    },
  });

  // Update form when settings load
  useEffect(() => {
    if (settings) {
      const address = settings.brewery_address as Record<string, string> || {};
      form.reset({
        brewery_name: (settings.brewery_name as string) || "",
        brewery_street: address.street || "",
        brewery_city: address.city || "",
        brewery_state: address.state || "",
        brewery_zip: address.zip || "",
        brewery_country: address.country || "USA",
        brewery_phone: (settings.brewery_phone as string) || "",
        brewery_email: (settings.brewery_email as string) || "",
        brewery_website: (settings.brewery_website as string) || "",
        timezone: (settings.timezone as string) || "America/New_York",
        federal_excise_tax_rate: Number(settings.federal_excise_tax_rate) || 3.5,
        federal_excise_tax_rate_full: Number(settings.federal_excise_tax_rate_full) || 16.0,
        state_excise_tax_rate: Number(settings.state_excise_tax_rate) || 0,
        sales_tax_rate: Number(settings.sales_tax_rate) || 0,
        fiscal_year_start_month: Number(settings.fiscal_year_start_month) || 1,
        fiscal_year_start_day: Number(settings.fiscal_year_start_day) || 1,
        ttb_brewery_number: (settings.ttb_brewery_number as string) || "",
        ttb_permit_number: (settings.ttb_permit_number as string) || "",
        abc_license_number: (settings.abc_license_number as string) || "",
      });
    }
  }, [settings, form]);

  const onSubmit = async (values: SystemSettingsForm) => {
    try {
      await updateSettings.mutateAsync({
        brewery_name: values.brewery_name,
        brewery_address: {
          street: values.brewery_street,
          city: values.brewery_city,
          state: values.brewery_state,
          zip: values.brewery_zip,
          country: values.brewery_country,
        },
        brewery_phone: values.brewery_phone,
        brewery_email: values.brewery_email,
        brewery_website: values.brewery_website,
        timezone: values.timezone,
        federal_excise_tax_rate: values.federal_excise_tax_rate,
        federal_excise_tax_rate_full: values.federal_excise_tax_rate_full,
        state_excise_tax_rate: values.state_excise_tax_rate,
        sales_tax_rate: values.sales_tax_rate,
        fiscal_year_start_month: values.fiscal_year_start_month,
        fiscal_year_start_day: values.fiscal_year_start_day,
        ttb_brewery_number: values.ttb_brewery_number,
        ttb_permit_number: values.ttb_permit_number,
        abc_license_number: values.abc_license_number,
      });
      toast.success("System settings saved");
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings");
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            System Settings
          </h1>
          <p className="text-muted-foreground">
            Configure brewery-wide settings
          </p>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading settings...
          </CardContent>
        </Card>
      ) : (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="general" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span className="hidden sm:inline">General</span>
              </TabsTrigger>
              <TabsTrigger value="tax" className="flex items-center gap-2">
                <Calculator className="h-4 w-4" />
                <span className="hidden sm:inline">Tax</span>
              </TabsTrigger>
              <TabsTrigger value="fiscal" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span className="hidden sm:inline">Fiscal</span>
              </TabsTrigger>
              <TabsTrigger value="compliance" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Compliance</span>
              </TabsTrigger>
            </TabsList>

            {/* General Tab */}
            <TabsContent value="general">
              <Card>
                <CardHeader>
                  <CardTitle>Brewery Information</CardTitle>
                  <CardDescription>
                    Basic information about your brewery
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="brewery_name">Brewery Name *</Label>
                    <Input
                      id="brewery_name"
                      {...form.register("brewery_name")}
                      placeholder="My Awesome Brewery"
                    />
                    {form.formState.errors.brewery_name && (
                      <p className="text-sm text-destructive">
                        {form.formState.errors.brewery_name.message}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="brewery_street">Street Address</Label>
                    <Input
                      id="brewery_street"
                      {...form.register("brewery_street")}
                      placeholder="123 Brewery Lane"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="brewery_city">City</Label>
                      <Input
                        id="brewery_city"
                        {...form.register("brewery_city")}
                        placeholder="Portland"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="brewery_state">State</Label>
                      <Input
                        id="brewery_state"
                        {...form.register("brewery_state")}
                        placeholder="OR"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="brewery_zip">ZIP Code</Label>
                      <Input
                        id="brewery_zip"
                        {...form.register("brewery_zip")}
                        placeholder="97201"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="brewery_country">Country</Label>
                      <Input
                        id="brewery_country"
                        {...form.register("brewery_country")}
                        placeholder="USA"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="brewery_phone">Phone</Label>
                      <Input
                        id="brewery_phone"
                        {...form.register("brewery_phone")}
                        placeholder="(503) 555-1234"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="brewery_email">Email</Label>
                      <Input
                        id="brewery_email"
                        type="email"
                        {...form.register("brewery_email")}
                        placeholder="hello@mybrewery.com"
                      />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="brewery_website">Website</Label>
                    <Input
                      id="brewery_website"
                      {...form.register("brewery_website")}
                      placeholder="https://mybrewery.com"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <Select
                      value={form.watch("timezone")}
                      onValueChange={(value) => form.setValue("timezone", value)}
                    >
                      <SelectTrigger id="timezone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tax Tab */}
            <TabsContent value="tax">
              <Card>
                <CardHeader>
                  <CardTitle>Tax Rates</CardTitle>
                  <CardDescription>
                    Configure excise and sales tax rates
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="federal_excise_tax_rate">
                      Federal Excise Tax Rate (per BBL, first 60,000)
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">$</span>
                      <Input
                        id="federal_excise_tax_rate"
                        type="number"
                        step="0.01"
                        {...form.register("federal_excise_tax_rate")}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Current rate for small brewers (under 60,000 BBL/year)
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="federal_excise_tax_rate_full">
                      Federal Excise Tax Rate (per BBL, over 60,000)
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">$</span>
                      <Input
                        id="federal_excise_tax_rate_full"
                        type="number"
                        step="0.01"
                        {...form.register("federal_excise_tax_rate_full")}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Standard rate for production over 60,000 BBL/year
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="state_excise_tax_rate">
                      State Excise Tax Rate (per BBL)
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">$</span>
                      <Input
                        id="state_excise_tax_rate"
                        type="number"
                        step="0.01"
                        {...form.register("state_excise_tax_rate")}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Varies by state
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="sales_tax_rate">
                      Default Sales Tax Rate
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="sales_tax_rate"
                        type="number"
                        step="0.001"
                        {...form.register("sales_tax_rate")}
                      />
                      <span className="text-muted-foreground">%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter as decimal (e.g., 0.06 for 6%)
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Fiscal Tab */}
            <TabsContent value="fiscal">
              <Card>
                <CardHeader>
                  <CardTitle>Fiscal Year</CardTitle>
                  <CardDescription>
                    Configure your fiscal year start date
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="fiscal_year_start_month">Start Month</Label>
                      <Select
                        value={String(form.watch("fiscal_year_start_month"))}
                        onValueChange={(value) =>
                          form.setValue("fiscal_year_start_month", Number(value))
                        }
                      >
                        <SelectTrigger id="fiscal_year_start_month">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MONTH_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="fiscal_year_start_day">Start Day</Label>
                      <Input
                        id="fiscal_year_start_day"
                        type="number"
                        min="1"
                        max="31"
                        {...form.register("fiscal_year_start_day")}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Most breweries use January 1 (calendar year) or match their TTB reporting period.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Compliance Tab */}
            <TabsContent value="compliance">
              <Card>
                <CardHeader>
                  <CardTitle>Compliance Information</CardTitle>
                  <CardDescription>
                    License and permit numbers for regulatory compliance
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="ttb_brewery_number">TTB Brewer&apos;s Notice Number</Label>
                    <Input
                      id="ttb_brewery_number"
                      {...form.register("ttb_brewery_number")}
                      placeholder="BR-XX-XXXXX"
                    />
                    <p className="text-xs text-muted-foreground">
                      Your federal Brewer&apos;s Notice number issued by TTB
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="ttb_permit_number">TTB Permit Number</Label>
                    <Input
                      id="ttb_permit_number"
                      {...form.register("ttb_permit_number")}
                      placeholder="BWP-XX-XXXXX"
                    />
                    <p className="text-xs text-muted-foreground">
                      Your Basic Permit number (if applicable)
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="abc_license_number">State ABC License Number</Label>
                    <Input
                      id="abc_license_number"
                      {...form.register("abc_license_number")}
                      placeholder="ABC-XXXXX"
                    />
                    <p className="text-xs text-muted-foreground">
                      Your state Alcoholic Beverage Control license number
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Submit */}
          <div className="flex justify-end">
            <Button type="submit" disabled={updateSettings.isPending}>
              <Save className="h-4 w-4 mr-2" />
              {updateSettings.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
