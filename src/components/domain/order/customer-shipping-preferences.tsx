"use client";

/**
 * CustomerShippingPreferences — Customer-specific shipping material overrides.
 *
 * Thin wrapper around ShippingMaterialRolesEditor for the
 * customer_shipping_materials table.
 */

import { materialPlanningKeys } from "@/lib/query-keys";
import { ShippingMaterialRolesEditor } from "@/components/domain/packaging/shipping-material-roles-editor";

type CustomerShippingPreferencesProps = {
  customerId: string;
  disabled?: boolean;
};

export function CustomerShippingPreferences({
  customerId,
  disabled = false,
}: CustomerShippingPreferencesProps) {
  return (
    <ShippingMaterialRolesEditor
      table="customer_shipping_materials"
      queryKey={materialPlanningKeys.customerShippingMaterials(customerId)}
      customerId={customerId}
      emptyLabel="Using brewery default"
      setLabel="Override"
      itemNoun="Preference"
      disabled={disabled}
    />
  );
}
