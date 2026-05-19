"use client";

/**
 * BreweryShippingDefaults — Brewery-wide default shipping materials editor.
 *
 * Thin wrapper around ShippingMaterialRolesEditor for the
 * brewery_shipping_defaults table.
 */

import { materialPlanningKeys } from "@/lib/query-keys";
import { ShippingMaterialRolesEditor } from "./shipping-material-roles-editor";

type BreweryShippingDefaultsProps = {
  disabled?: boolean;
};

export function BreweryShippingDefaults({
  disabled = false,
}: BreweryShippingDefaultsProps) {
  return (
    <ShippingMaterialRolesEditor
      table="brewery_shipping_defaults"
      queryKey={materialPlanningKeys.breweryShippingDefaults()}
      emptyLabel="Not set"
      setLabel="Set"
      itemNoun="Default"
      disabled={disabled}
    />
  );
}
