"use client";

/**
 * Packaging Session Detail Page
 *
 * Routes to different views based on session status:
 * - planned → EntityDetailUnified (editable)
 * - in_progress → PackagingDayView (custom real-time editor)
 * - completed/revised/cancelled → EntityDetailUnified (read-only)
 */

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntityDetailPage } from "@/components/universal/entity-detail-page";
import { packagingSessionEntity } from "@/entities/packaging-session";
import { PackagingDayView } from "@/components/domain/packaging-day-view";
import { entityKeys } from "@/lib/query-keys";
import { Loader2 } from "lucide-react";

export default function PackagingSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = createClient();

  // Fetch session status to determine which view to render
  const { data: session, isLoading } = useQuery({
    queryKey: entityKeys.detail("packaging_sessions", id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packaging_sessions")
        .select("id, session_date, status, notes")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // In-progress sessions get the custom packaging day view
  if (session?.status === "in_progress") {
    return <PackagingDayView sessionId={id} />;
  }

  return (
    <EntityDetailPage
      entity={packagingSessionEntity}
      id={id}
      basePath="/production/packaging"
    />
  );
}
