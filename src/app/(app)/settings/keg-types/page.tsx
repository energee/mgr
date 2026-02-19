"use client";

/**
 * Keg Settings Page
 *
 * Tabbed view for managing keg-related catalogs:
 * - Keg Types: keg sizes used for packaging and inventory tracking
 * - Keg Owners: fleet providers (e.g., House, Microstar, One-Way)
 */

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EntityList } from "@/components/universal/entity-list";
import { kegTypeEntity } from "@/entities/keg-type";
import { kegOwnerEntity } from "@/entities/keg-owner";

export default function KegTypesPage() {
  const [tab, setTab] = useState("types");

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="types">Keg Types</TabsTrigger>
          <TabsTrigger value="owners">Keg Owners</TabsTrigger>
        </TabsList>
        <TabsContent value="types">
          <EntityList
            entity={kegTypeEntity}
            basePath="/settings/keg-types"
          />
        </TabsContent>
        <TabsContent value="owners">
          <EntityList
            entity={kegOwnerEntity}
            basePath="/inventory/kegs/owners"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
