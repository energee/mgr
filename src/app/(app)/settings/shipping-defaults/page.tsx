"use client";

/**
 * Shipping Defaults Settings Page
 *
 * Configure brewery-wide default shipping materials per role (pallet, wrap,
 * other). These defaults are applied to orders when no customer-specific
 * override is set.
 */

import { BreweryShippingDefaults } from "@/components/domain/brewery-shipping-defaults";

export default function ShippingDefaultsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Shipping Defaults</h1>
        <p className="text-muted-foreground">
          Set the default inventory items used for each shipping material role.
          Customer-specific overrides can be configured on each customer&apos;s profile.
        </p>
      </div>

      <BreweryShippingDefaults />
    </div>
  );
}
