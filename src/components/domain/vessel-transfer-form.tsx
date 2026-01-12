"use client";

/**
 * VesselTransferForm - Record Batch Movements Between Vessels
 *
 * Tracks transfers:
 * - Kettle to FV (knockout, from_vessel_id = null)
 * - FV to Brite (conditioning transfer)
 * - Brite to Brite (blending)
 */

import { useState, useEffect } from "react";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";

const transferSchema = z.object({
  from_vessel_id: z.string().nullable(),
  to_vessel_id: z.string().min(1, "Destination vessel is required"),
  volume_bbl: z.coerce.number().positive("Volume must be positive"),
  transferred_at: z.string(),
  notes: z.string().optional(),
});

type TransferFormValues = z.infer<typeof transferSchema>;

interface Vessel {
  id: string;
  name: string;
  vessel_type: string;
  capacity_bbl: number;
  status: string;
}

interface VesselTransferFormProps {
  batchId: string;
  currentVesselId?: string;
  onSubmit: (data: TransferFormValues) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function VesselTransferForm({
  currentVesselId,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: VesselTransferFormProps) {
  const [isKnockout, setIsKnockout] = useState(!currentVesselId);
  const supabase = createClient();

  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      from_vessel_id: currentVesselId || null,
      to_vessel_id: "",
      volume_bbl: 0,
      transferred_at: new Date().toISOString().slice(0, 16),
      notes: "",
    },
  });

  // Fetch vessels
  const { data: vessels = [], isLoading: loadingVessels } = useQuery({
    queryKey: ["vessels-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vessels")
        .select("id, name, vessel_type, capacity_bbl, status")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Vessel[];
    },
  });

  // Update from_vessel when knockout toggle changes
  useEffect(() => {
    if (isKnockout) {
      form.setValue("from_vessel_id", null);
    } else {
      form.setValue("from_vessel_id", currentVesselId || "");
    }
  }, [isKnockout, currentVesselId, form]);

  // Filter vessels by type
  const fromVessels = vessels.filter(
    (v) => v.status === "in_use" || v.id === currentVesselId
  );
  const toVessels = vessels.filter(
    (v) => v.status === "ready_for_use" || v.status === "in_use"
  );

  const handleSubmit = async (values: TransferFormValues) => {
    await onSubmit({
      ...values,
      from_vessel_id: isKnockout ? null : values.from_vessel_id,
    });
    form.reset();
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="text-xl">Record Transfer</CardTitle>
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
            {/* Knockout Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <div className="font-medium">Knockout from Kettle</div>
                <div className="text-sm text-muted-foreground">
                  First transfer to fermenter
                </div>
              </div>
              <Switch
                checked={isKnockout}
                onCheckedChange={setIsKnockout}
              />
            </div>

            {/* From Vessel (if not knockout) */}
            {!isKnockout && (
              <FormField
                control={form.control}
                name="from_vessel_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">From Vessel</FormLabel>
                    <Select
                      value={field.value || ""}
                      onValueChange={field.onChange}
                      disabled={loadingVessels}
                    >
                      <SelectTrigger className="h-12">
                        <SelectValue placeholder="Select source vessel..." />
                      </SelectTrigger>
                      <SelectContent>
                        {fromVessels.map((vessel) => (
                          <SelectItem key={vessel.id} value={vessel.id}>
                            {vessel.name} ({vessel.vessel_type}) - {vessel.capacity_bbl} BBL
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* To Vessel */}
            <FormField
              control={form.control}
              name="to_vessel_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">To Vessel</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={loadingVessels}
                  >
                    <SelectTrigger className="h-12">
                      <SelectValue placeholder="Select destination vessel..." />
                    </SelectTrigger>
                    <SelectContent>
                      {toVessels.map((vessel) => (
                        <SelectItem key={vessel.id} value={vessel.id}>
                          {vessel.name} ({vessel.vessel_type}) - {vessel.capacity_bbl} BBL
                          {vessel.status === "ready_for_use" && " - Ready"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Select an available vessel
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Volume */}
            <FormField
              control={form.control}
              name="volume_bbl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-base">Volume (BBL)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="e.g., 10.5"
                      className="h-12 text-lg"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Timestamp */}
            <FormField
              control={form.control}
              name="transferred_at"
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
                      placeholder="e.g., split to two fermenters..."
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
                {isSubmitting ? "Saving..." : "Record Transfer"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
