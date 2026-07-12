"use client";

/**
 * System Settings Page
 *
 * Brewery-wide configuration settings including:
 * - Brewery information (name, address, contact)
 * - Tax rates (federal, state, sales)
 * - Fiscal year configuration
 * - Compliance information (TTB, ABC)
 *
 * Fields use the shared Form primitives (FormField/FormControl/FormMessage)
 * so validation errors are announced and associated with their inputs — the
 * hand-rolled register() blocks previously showed an error for brewery_name
 * only and swallowed every other field's error entirely (audit A11Y-3).
 */

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/form-resolver";
import { z } from "zod";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { settingsKeys } from "@/lib/query-keys";
import type { Json } from "@/types/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import { FileUpload, FileUploadDropzone, FileUploadTrigger } from "@/components/ui/file-upload";
import { Loader2, Trash2, Upload } from "lucide-react";
import { useSubmitShortcut } from "@/hooks/use-submit-shortcut";
import { useIsMac } from "@/hooks/use-is-mac";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SafeImage } from "@/components/ui/safe-image";
import { log } from "@/lib/client-logger";

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

function useSystemSettings() {
  const supabase = createClient();

  return useQuery({
    queryKey: settingsKeys.systemSettings(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value");

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
      // Single bulk upsert on the UNIQUE `key` column instead of N sequential
      // per-key updates. Only key/value are sent, so existing description/
      // category values are untouched on conflict; value is JSONB and Supabase
      // handles serialization.
      const rows = Object.entries(updates).map(([key, value]) => ({
        key,
        value: value as Json,
      }));
      if (rows.length === 0) return;

      const { error } = await supabase
        .from("system_settings")
        .upsert(rows, { onConflict: "key" });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.systemSettings() });
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
  const isMac = useIsMac();
  // Logo preview: derived from the saved setting, with a local override after
  // an upload/remove in this session (avoids syncing state in an effect).
  const [logoOverride, setLogoOverride] = useState<string | null | undefined>(
    undefined
  );
  const logoSvg =
    logoOverride !== undefined
      ? logoOverride
      : ((settings?.brewery_logo_svg as string | null) || null);
  const [uploadResetKey, setUploadResetKey] = useState(0);
  const submitRef = useSubmitShortcut();

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

  // Update form when settings load (logoSvg is derived above, not synced here)
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
      log.error("Failed to save settings:", error);
      toast.error("Failed to save settings");
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">System Settings</h1>
        <p className="text-muted-foreground">
          Configure brewery-wide settings
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading settings...
          </CardContent>
        </Card>
      ) : (
        <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="tax">Tax</TabsTrigger>
              <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
              <TabsTrigger value="compliance">Compliance</TabsTrigger>
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
                  <FormField
                    control={form.control}
                    name="brewery_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Brewery Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="My Awesome Brewery" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid gap-2">
                    <Label>Brewery Logo</Label>
                    <div className="flex items-start gap-4">
                      {logoSvg && (
                        <div className="flex flex-shrink-0 flex-col items-center gap-1.5">
                          <div className="h-[120px] w-[120px] rounded-md border bg-white flex items-center justify-center p-3">
                            <SafeImage
                              src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(logoSvg)))}`}
                              alt="Brewery logo"
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={async () => {
                              setLogoOverride(null);
                              setUploadResetKey((k) => k + 1);
                              try {
                                await updateSettings.mutateAsync({ brewery_logo_svg: "" });
                                toast.success("Logo removed");
                              } catch {
                                toast.error("Failed to remove logo");
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Remove
                          </Button>
                        </div>
                      )}
                      <FileUpload
                        key={uploadResetKey}
                        maxFiles={1}
                        accept="image/svg+xml"
                        className="flex-1 min-w-0"
                        onFileAccept={(file) => {
                          const reader = new FileReader();
                          reader.onload = async (ev) => {
                            const svgText = ev.target?.result as string;
                            setLogoOverride(svgText);
                            setUploadResetKey((k) => k + 1);
                            try {
                              await updateSettings.mutateAsync({ brewery_logo_svg: svgText });
                              toast.success("Logo saved");
                            } catch {
                              toast.error("Failed to save logo");
                            }
                          };
                          reader.readAsText(file);
                        }}
                        onFileReject={(_file, message) => {
                          toast.error(message);
                        }}
                      >
                        <FileUploadDropzone className="h-[120px] p-4">
                          <Upload className="size-5 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground text-center">
                            Drag & drop or click to browse
                          </p>
                          <p className="text-xs text-muted-foreground">SVG only</p>
                          <FileUploadTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              Browse files
                            </Button>
                          </FileUploadTrigger>
                        </FileUploadDropzone>
                      </FileUpload>
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="brewery_street"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street Address</FormLabel>
                        <FormControl>
                          <Input placeholder="123 Brewery Lane" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="brewery_city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input placeholder="Portland" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="brewery_state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State</FormLabel>
                          <FormControl>
                            <Input placeholder="OR" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="brewery_zip"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ZIP Code</FormLabel>
                          <FormControl>
                            <Input placeholder="97201" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="brewery_country"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Country</FormLabel>
                          <FormControl>
                            <Input placeholder="USA" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="brewery_phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input placeholder="(503) 555-1234" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="brewery_email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="hello@mybrewery.com"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="brewery_website"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Website</FormLabel>
                        <FormControl>
                          <Input placeholder="https://mybrewery.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="timezone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Timezone</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {TIMEZONE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                  <FormField
                    control={form.control}
                    name="federal_excise_tax_rate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Federal Excise Tax Rate (per BBL, first 60,000)
                        </FormLabel>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">$</span>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                        </div>
                        <FormDescription className="text-xs">
                          Current rate for small brewers (under 60,000 BBL/year)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="federal_excise_tax_rate_full"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Federal Excise Tax Rate (per BBL, over 60,000)
                        </FormLabel>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">$</span>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                        </div>
                        <FormDescription className="text-xs">
                          Standard rate for production over 60,000 BBL/year
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="state_excise_tax_rate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State Excise Tax Rate (per BBL)</FormLabel>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">$</span>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                        </div>
                        <FormDescription className="text-xs">
                          Varies by state
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="sales_tax_rate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default Sales Tax Rate</FormLabel>
                        <div className="flex items-center gap-2">
                          <FormControl>
                            <Input
                              type="number"
                              step="0.001"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <span className="text-muted-foreground">%</span>
                        </div>
                        <FormDescription className="text-xs">
                          Enter as decimal (e.g., 0.06 for 6%)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                    <FormField
                      control={form.control}
                      name="fiscal_year_start_month"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start Month</FormLabel>
                          <Select
                            value={String(field.value)}
                            onValueChange={(value) => field.onChange(Number(value))}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {MONTH_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="fiscal_year_start_day"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start Day</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="1"
                              max="31"
                              {...field}
                              value={field.value ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
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
                  <FormField
                    control={form.control}
                    name="ttb_brewery_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>TTB Brewer&apos;s Notice Number</FormLabel>
                        <FormControl>
                          <Input placeholder="BR-XX-XXXXX" {...field} />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Your federal Brewer&apos;s Notice number issued by TTB
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="ttb_permit_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>TTB Permit Number</FormLabel>
                        <FormControl>
                          <Input placeholder="BWP-XX-XXXXX" {...field} />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Your Basic Permit number (if applicable)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="abc_license_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State ABC License Number</FormLabel>
                        <FormControl>
                          <Input placeholder="ABC-XXXXX" {...field} />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Your state Alcoholic Beverage Control license number
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>

          {/* Submit */}
          <div className="flex justify-end">
            <Button ref={submitRef} type="submit" disabled={updateSettings.isPending}>
              {updateSettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Settings
              <KbdGroup>
                <Kbd>{isMac ? "\u2318" : "Ctrl"}</Kbd>
                <Kbd>{isMac ? "\u21B5" : "Enter"}</Kbd>
              </KbdGroup>
            </Button>
          </div>
        </form>
        </Form>
      )}
    </div>
  );
}
