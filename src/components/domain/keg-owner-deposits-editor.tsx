"use client";

/**
 * Keg Owner Deposits Editor
 *
 * Inline editor shown on keg owner detail page.
 * Displays all active keg types with editable deposit amount fields.
 * Saves via upsert to keg_owner_deposits table.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { entityKeys } from "@/lib/query-keys";
import { kegKeys } from "@/lib/query-keys";
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

interface KegOwnerDepositsEditorProps {
  kegOwnerId: string;
}

interface KegType {
  id: string;
  name: string;
  code: string;
  volume_bbl: number;
  deposit_amount: number;
}

interface OwnerDeposit {
  id: string;
  keg_owner_id: string;
  keg_type_id: string;
  deposit_amount: number;
}

export function KegOwnerDepositsEditor({
  kegOwnerId,
}: KegOwnerDepositsEditorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [deposits, setDeposits] = useState<Record<string, string>>({});
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());

  // Fetch all active keg types
  const { data: kegTypes, isLoading: loadingTypes } = useQuery({
    queryKey: entityKeys.list("keg_types", { is_active: true }),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("keg_types")
        .select("id, name, code, volume_bbl, deposit_amount")
        .eq("is_active", true)
        .order("position", { ascending: true });
      if (error) throw error;
      return data as KegType[];
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
        depositMap[d.keg_type_id] = String(d.deposit_amount);
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
      const upserts: { keg_owner_id: string; keg_type_id: string; deposit_amount: number }[] = [];
      const deletes: string[] = [];

      for (const kegTypeId of dirtyKeys) {
        const value = deposits[kegTypeId];
        const numValue = parseFloat(value || "0");

        if (!value || value === "" || numValue === 0) {
          // Delete the override if it exists
          const existing = existingDeposits?.find(
            (d) => d.keg_type_id === kegTypeId
          );
          if (existing) {
            deletes.push(existing.id);
          }
        } else {
          upserts.push({
            keg_owner_id: kegOwnerId,
            keg_type_id: kegTypeId,
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
            onConflict: "keg_owner_id,keg_type_id",
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

  if (!kegTypes?.length) {
    return (
      <p className="text-muted-foreground py-4">
        No active keg types found. Add keg types first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Set deposit amounts per keg type. Leave blank to use the default
          deposit from the keg type.
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
            <TableHead>Keg Type</TableHead>
            <TableHead>Size (BBL)</TableHead>
            <TableHead>Default Deposit</TableHead>
            <TableHead>Owner Deposit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {kegTypes.map((kt) => (
            <TableRow key={kt.id}>
              <TableCell className="font-medium">{kt.name}</TableCell>
              <TableCell>{kt.volume_bbl}</TableCell>
              <TableCell className="text-muted-foreground">
                ${Number(kt.deposit_amount).toFixed(2)}
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={`$${Number(kt.deposit_amount).toFixed(2)}`}
                  value={deposits[kt.id] ?? ""}
                  onChange={(e) => handleChange(kt.id, e.target.value)}
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
