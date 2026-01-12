"use client";

/**
 * BatchAdditionForm - Fermentation Addition Entry
 *
 * Form for recording additions during fermentation:
 * - Dry hops (with contact time)
 * - Fruit additions
 * - Adjuncts
 * - Finings/clarifiers
 * - Spices
 */

import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ADDITION_TYPES,
  UNIT_OPTIONS,
  type AdditionType,
  type BatchAddition,
} from "@/lib/batch-additions";

const additionSchema = z.object({
  addition_type: z.enum(["dry_hop", "fruit", "adjunct", "fining", "spice", "other"]),
  ingredient_id: z.string().optional(),
  ingredient_name: z.string().min(1, "Ingredient name is required"),
  quantity: z.coerce.number().positive("Quantity must be positive"),
  unit: z.string().min(1),
  timestamp: z.string(),
  contact_time_hours: z.coerce.number().optional(),
  notes: z.string().optional(),
});

type AdditionFormValues = z.infer<typeof additionSchema>;

interface CatalogItem {
  id: string;
  name: string;
  type?: string;
}

interface BatchAdditionFormProps {
  batchId: string;
  onSubmit: (data: BatchAddition) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function BatchAdditionForm({
  onSubmit,
  onCancel,
  isSubmitting = false,
}: BatchAdditionFormProps) {
  const [selectedType, setSelectedType] = useState<AdditionType>("dry_hop");
  const [ingredientOpen, setIngredientOpen] = useState(false);
  const supabase = createClient();

  const config = ADDITION_TYPES[selectedType];

  const form = useForm<AdditionFormValues>({
    resolver: zodResolver(additionSchema),
    defaultValues: {
      addition_type: "dry_hop",
      ingredient_id: "",
      ingredient_name: "",
      quantity: 0,
      unit: config?.defaultUnit || "oz",
      timestamp: new Date().toISOString().slice(0, 16),
      contact_time_hours: undefined,
      notes: "",
    },
  });

  // Fetch catalog items based on selected type
  const { data: catalogItems = [], isLoading: loadingCatalog } = useQuery({
    queryKey: ["catalog", config.catalogTable],
    queryFn: async () => {
      if (!config.catalogTable) return [];
      // Use type assertion for dynamic table access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from(config.catalogTable)
        .select("id, name, type")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as CatalogItem[];
    },
    enabled: !!config.catalogTable,
  });

  // Update defaults when type changes
  useEffect(() => {
    const newConfig = ADDITION_TYPES[selectedType];
    form.setValue("unit", newConfig.defaultUnit);
    form.setValue("ingredient_id", "");
    form.setValue("ingredient_name", "");
    form.setValue("contact_time_hours", undefined);
  }, [selectedType, form]);

  // Handle ingredient selection from catalog
  const handleIngredientSelect = (item: CatalogItem) => {
    form.setValue("ingredient_id", item.id);
    form.setValue("ingredient_name", item.name);
    setIngredientOpen(false);
  };

  const handleSubmit = async (values: AdditionFormValues) => {
    await onSubmit({
      addition_type: values.addition_type,
      ingredient_id: values.ingredient_id || undefined,
      ingredient_name: values.ingredient_name,
      quantity: values.quantity,
      unit: values.unit,
      timestamp: values.timestamp,
      contact_time_hours: values.contact_time_hours,
      notes: values.notes,
    });

    form.reset();
    setSelectedType("dry_hop");
  };

  // Group catalog items by type
  const groupedItems = useMemo(() => {
    const groups: Record<string, CatalogItem[]> = {};
    catalogItems.forEach((item) => {
      const type = item.type || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    });
    return groups;
  }, [catalogItems]);

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-xl">Add Addition</CardTitle>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="h-10 w-10"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            {/* Addition Type */}
            <FormField
              control={form.control}
              name="addition_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Type</FormLabel>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {(Object.keys(ADDITION_TYPES) as AdditionType[]).map((type) => (
                      <Button
                        key={type}
                        type="button"
                        variant={selectedType === type ? "default" : "outline"}
                        className="h-12"
                        onClick={() => {
                          setSelectedType(type);
                          field.onChange(type);
                        }}
                      >
                        {ADDITION_TYPES[type].label}
                      </Button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Ingredient Selector */}
            <FormField
              control={form.control}
              name="ingredient_name"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel className="text-base">Ingredient</FormLabel>
                  {config.catalogTable ? (
                    <Popover open={ingredientOpen} onOpenChange={setIngredientOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={ingredientOpen}
                            className={cn(
                              "h-12 justify-between text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                            disabled={loadingCatalog}
                          >
                            {field.value || "Select or type ingredient..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command>
                          <CommandInput
                            placeholder={`Search ${config.label.toLowerCase()}s...`}
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value);
                              form.setValue("ingredient_id", "");
                            }}
                          />
                          <CommandList>
                            <CommandEmpty>
                              <p className="p-2 text-sm text-muted-foreground">
                                No items found. Type to use custom name.
                              </p>
                            </CommandEmpty>
                            {Object.entries(groupedItems).map(([type, items]) => (
                              <CommandGroup key={type} heading={type}>
                                {items.map((item) => (
                                  <CommandItem
                                    key={item.id}
                                    value={item.name}
                                    onSelect={() => handleIngredientSelect(item)}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        form.getValues("ingredient_id") === item.id
                                          ? "opacity-100"
                                          : "opacity-0"
                                      )}
                                    />
                                    {item.name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            ))}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <FormControl>
                      <Input
                        className="h-12"
                        placeholder="Enter ingredient name..."
                        {...field}
                      />
                    </FormControl>
                  )}
                  <FormDescription>
                    Select from catalog or type a custom name
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Quantity and Unit */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base">Quantity</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="h-12 text-lg"
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
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Unit</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="h-12">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIT_OPTIONS.map((unit) => (
                          <SelectItem key={unit.value} value={unit.value}>
                            {unit.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Contact Time (for dry hops) */}
            {config.showContactTime && (
              <FormField
                control={form.control}
                name="contact_time_hours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Contact Time (hours)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        placeholder="e.g., 72 for 3 days"
                        className="h-12"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      How long the hops will be in contact with beer
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Timestamp */}
            <FormField
              control={form.control}
              name="timestamp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Date/Time</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" className="h-12" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Any observations..."
                      className="min-h-[80px] text-base"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Submit */}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              {onCancel && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  className="h-12"
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" className="h-12" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Addition"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
