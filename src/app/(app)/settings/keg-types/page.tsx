"use client";

/**
 * Keg Settings Page
 *
 * Tabbed view for managing keg-related catalogs with reorder handles:
 * - Keg Types: keg sizes used for packaging and inventory tracking
 * - Keg Owners: fleet providers (e.g., House, Microstar, One-Way)
 */

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReorderableCatalogList } from "@/components/domain/reorderable-catalog-list";

const kegTypeColumns = [
  { key: "name", header: "Name" },
  { key: "code", header: "Code" },
  {
    key: "volume_bbl",
    header: "Volume (BBL)",
    render: (value: unknown) => (value != null ? String(value) : "—"),
  },
  {
    key: "deposit_amount",
    header: "Deposit",
    render: (value: unknown) =>
      value != null ? `$${Number(value).toFixed(2)}` : "—",
  },
  {
    key: "is_active",
    header: "Active",
    render: (value: unknown) => (value ? "Yes" : "No"),
  },
  {
    key: "show_in_pricing",
    header: "In Pricing",
    render: (value: unknown) => (value ? "Yes" : "—"),
  },
];

const kegOwnerColumns = [
  { key: "name", header: "Name" },
  { key: "code", header: "Code" },
  {
    key: "contact_name",
    header: "Contact",
    render: (value: unknown) => (value ? String(value) : "—"),
  },
  {
    key: "is_active",
    header: "Active",
    render: (value: unknown) => (value ? "Yes" : "No"),
  },
];

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
          <ReorderableCatalogList
            table="keg_types"
            columns={kegTypeColumns}
            basePath="/settings/keg-types"
            displayName="Keg Type"
          />
        </TabsContent>
        <TabsContent value="owners">
          <ReorderableCatalogList
            table="keg_owners"
            columns={kegOwnerColumns}
            basePath="/settings/keg-types/owners"
            displayName="Keg Owner"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
