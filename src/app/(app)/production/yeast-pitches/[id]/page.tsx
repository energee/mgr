"use client";

/**
 * Yeast Pitch Detail Page
 *
 * View yeast pitch details including strain, viability, lineage, and usage.
 * Handles custom actions like "harvest" which opens a dialog.
 */

import { useState, use } from "react";
import { useQuery } from "@tanstack/react-query";
import { EntityDetail } from "@/components/universal/entity-detail";
import { yeastPitchEntity } from "@/entities/yeast-pitch";
import { YeastHarvestDialog } from "@/components/domain/yeast-harvest-dialog";
import { YeastLineageDisplay } from "@/components/domain/yeast-lineage-display";
import { createClient } from "@/lib/supabase/client";

interface YeastPitchDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function YeastPitchDetailPage({ params }: YeastPitchDetailPageProps) {
  const { id } = use(params);
  const [harvestDialogOpen, setHarvestDialogOpen] = useState(false);
  const [pitchData, setPitchData] = useState<{
    id: string;
    strain_id: string;
    strain_name?: string;
    generation: number;
    batch_id?: string | null;
    batch_name?: string | null;
  } | null>(null);

  // Fetch locations for the harvest dialog
  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("locations")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Handle custom actions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleAction = (actionName: string, data: any): boolean => {
    if (actionName === "harvest") {
      setPitchData({
        id: data.id as string,
        strain_id: data.strain_id as string,
        strain_name: data.strain_name as string | undefined,
        generation: data.generation as number,
        batch_id: data.batch_id as string | null | undefined,
        batch_name: data.batch_name as string | null | undefined,
      });
      setHarvestDialogOpen(true);
      return true; // Action handled
    }
    return false; // Use default handling
  };

  return (
    <>
      <EntityDetail
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entity={yeastPitchEntity as any}
        id={id}
        basePath="/production/yeast-pitches"
        onAction={handleAction}
      />

      {/* Lineage display */}
      <div className="mt-6">
        <YeastLineageDisplay pitchId={id} />
      </div>

      {pitchData && (
        <YeastHarvestDialog
          open={harvestDialogOpen}
          onOpenChange={setHarvestDialogOpen}
          sourcePitch={pitchData}
          locations={locations}
        />
      )}
    </>
  );
}
