"use client";

/**
 * Water Settings Page
 *
 * Tabbed view for managing both source water chemistry profiles
 * and reusable water addition (salt/acid) profiles.
 */

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EntityList } from "@/components/universal/entity-list";
import { waterProfileEntity } from "@/entities/water-profile";
import { waterAdditionProfileEntity } from "@/entities/water-addition-profile";

export default function WaterSettingsPage() {
  return (
    <Tabs defaultValue="source">
      <TabsList>
        <TabsTrigger value="source">Source Water</TabsTrigger>
        <TabsTrigger value="additions">Addition Profiles</TabsTrigger>
      </TabsList>
      <TabsContent value="source" className="mt-4">
        <EntityList
          entity={waterProfileEntity}
          basePath="/settings/water-profiles"
        />
      </TabsContent>
      <TabsContent value="additions" className="mt-4">
        <EntityList
          entity={waterAdditionProfileEntity}
          basePath="/settings/water-profiles/additions"
        />
      </TabsContent>
    </Tabs>
  );
}
