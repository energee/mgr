"use client";

/**
 * Brew Logs List Page
 *
 * Displays all brew logs using the universal EntityList component.
 * Includes a "Start Brew Day" button that opens the multi-step dialog
 * without a pre-selected recipe.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EntityList } from "@/components/universal/entity-list";
import { brewLogEntity } from "@/entities/brew-log";
import { StartBrewDayDialog } from "@/components/domain/start-brew-day-dialog";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

export default function BrewLogsPage() {
  const router = useRouter();
  const [showStartBrewDay, setShowStartBrewDay] = useState(false);

  return (
    <>
      <div className="space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setShowStartBrewDay(true)}>
            <Play className="h-4 w-4 mr-2" />
            Start Brew Day
          </Button>
        </div>
        <EntityList
          entity={brewLogEntity}
          basePath="/production/brew-logs"
        />
      </div>

      <StartBrewDayDialog
        open={showStartBrewDay}
        onOpenChange={setShowStartBrewDay}
        onSuccess={(brewLogId) => {
          setShowStartBrewDay(false);
          router.push(`/production/brew-logs/${brewLogId}`);
        }}
      />
    </>
  );
}
