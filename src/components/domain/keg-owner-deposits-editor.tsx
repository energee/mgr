"use client";

/**
 * Keg Owner Deposits Editor
 *
 * Inline editor shown on keg owner detail page.
 * Displays all active keg selling formats with editable deposit amount fields.
 * Saves via upsert to keg_owner_deposits table.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys, packagingFormatKeys, kegKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { UnitDisplay } from "@/components/ui/unit-input";

type KegOwnerDepositsEditorProps = {
  kegOwnerId: string;
}

type KegSellingFormat = {
  id: string;
  name: string;
  volume_bbl: number;
  deposit_amount: number;
}

type OwnerDeposit = {
  id: string;
  keg_owner_id: string;
  selling_format_id: string;
  deposit_amount: number;
}

export function KegOwnerDepositsEditor({
  kegOwnerId,
}: KegOwnerDepositsEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [deposits, setDeposits] = useState<Record<string, string>>({});
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());

  // Fetch active keg selling formats from the packaging_formats view
  const { data: kegFormats, isLoading: loadingTypes } = useQuery({
    queryKey: packagingFormatKeys.kegFormats(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packaging_formats")
        .select("id, name, volume_bbl, deposit_amount")
        .eq("is_active", true)
        .eq("container_type", "keg")
        .order("name");
      if (error) throw error;
      return data as KegSellingFormat[];
    },
  });

  // Fetch existing owner deposits
  const { data: existingDeposits, isLoading: loadingDeposits } = useQuery({
    queryKey: entityKeys.related(
      "keg_owner_deposits",
      "keg_owner_id",
      kegOwnerId
    ),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("keg_owner_deposits")
        .select("*")
        .eq("keg_owner_id", kegOwnerId);
      if (error) throw error;

      // Initialize local state from fetched data
      const depositMap: Record<string, string> = {};
      for (const d of data as OwnerDeposit[]) {
        depositMap[d.selling_format_id] = String(d.deposit_amount);
      }
      setDeposits(depositMap);
      setDirtyKeys(new Set());
      return data as OwnerDeposit[];
    },
  });

  const handleChange = useCallback(
    (kegTypeId: string, value: string) => {
      setDeposits((prev) => ({ ...prev, [kegTypeId]: value }));
      setDirtyKeys((prev) => new Set(prev).add(kegTypeId));
    },
    []
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const upserts: { keg_owner_id: string; selling_format_id: string; deposit_amount: number }[] = [];
      const deletes: string[] = [];

      for (const formatId of dirtyKeys) {
        const value = deposits[formatId];
        const numValue = parseFloat(value || "0");

        if (!value || value === "" || numValue === 0) {
          // Delete the override if it exists
          const existing = existingDeposits?.find(
            (d) => d.selling_format_id === formatId
          );
          if (existing) {
            deletes.push(existing.id);
          }
        } else {
          upserts.push({
            keg_owner_id: kegOwnerId,
            selling_format_id: formatId,
            deposit_amount: numValue,
          });
        }
      }

      // Perform deletes
      if (deletes.length > 0) {
        const { error } = await supabase
          .from("keg_owner_deposits")
          .delete()
          .in("id", deletes);
        if (error) throw error;
      }

      // Perform upserts
      if (upserts.length > 0) {
        const { error } = await supabase
          .from("keg_owner_deposits")
          .upsert(upserts, {
            onConflict: "keg_owner_id,selling_format_id",
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setDirtyKeys(new Set());
      queryClient.invalidateQueries({
        queryKey: entityKeys.related(
          "keg_owner_deposits",
          "keg_owner_id",
          kegOwnerId
        ),
      });
      queryClient.invalidateQueries({
        queryKey: kegKeys.customerBalances(),
      });
      toast.success("Deposits saved");
    },
    onError: (error) => {
      toast.error(`Failed to save deposits: ${error.message}`);
    },
  });

  if (loadingTypes || loadingDeposits) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading deposits...
      </div>
    );
  }

  if (!kegFormats?.length) {
    return (
      <p className="text-muted-foreground py-4">
        No active keg formats found. Add keg containers and selling formats first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Set deposit amounts per keg format. Leave blank to use the default
          deposit from the container.
        </p>
        {dirtyKeys.size > 0 && (
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Keg Format</TableHead>
            <TableHead>Size (BBL)</TableHead>
            <TableHead>Default Deposit</TableHead>
            <TableHead>Owner Deposit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {kegFormats.map((kf) => (
            <TableRow key={kf.id}>
              <TableCell className="font-medium">{kf.name}</TableCell>
              <TableCell><UnitDisplay value={kf.volume_bbl} unitType="volume" /></TableCell>
              <TableCell className="text-muted-foreground">
                ${Number(kf.deposit_amount).toFixed(2)}
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={`$${Number(kf.deposit_amount).toFixed(2)}`}
                  value={deposits[kf.id] ?? ""}
                  onChange={(e) => handleChange(kf.id, e.target.value)}
                  className="w-32"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
