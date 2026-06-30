"use client";

/**
 * CustomerAddressSection — billing address display/editor for the customer
 * detail page.
 *
 * The customers.address column is JSONB with no fixed schema. This section
 * surfaces it using the exact keys the QuickBooks export reads via
 * mapAddress() (src/integrations/quickbooks/sync-utils.ts): street, line2,
 * city, state, zip, country. Legacy rows may use alternate key spellings
 * (line1/address1, address2, region, postal_code/postalCode) — reads fall
 * back to those (mirroring mapAddress), and any edit rewrites the full
 * object with normalized keys.
 *
 * Wired as a custom section component on the customer entity config
 * (src/entities/customer.tsx). In edit/create mode it writes the merged
 * JSONB object into the entity form's `address` value; the customer zod
 * schema accepts it and EntityDetailUnified persists it with the rest of
 * the form payload. Clearing every field stores null.
 */

import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// =============================================================================
// Address value helpers (exported for tests)
// =============================================================================

/** Normalized address fields; keys match what mapAddress() reads first. */
export type AddressFields = {
  street: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

const EMPTY_FIELDS: AddressFields = {
  street: "",
  line2: "",
  city: "",
  state: "",
  zip: "",
  country: "",
};

/**
 * Read a JSONB address value into normalized fields. Accepts legacy key
 * spellings with the same precedence as mapAddress() so existing rows
 * round-trip without data loss.
 */
export function parseAddress(address: unknown): AddressFields {
  if (!address || typeof address !== "object") return { ...EMPTY_FIELDS };
  const a = address as Record<string, unknown>;
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const v = a[key];
      if (typeof v === "string" && v.trim() !== "") return v;
    }
    return "";
  };
  return {
    street: first("street", "line1", "address1"),
    line2: first("line2", "address2"),
    city: first("city"),
    state: first("state", "region"),
    zip: first("zip", "postal_code", "postalCode"),
    country: first("country"),
  };
}

/**
 * Build the JSONB value to store: an object of the non-blank normalized
 * fields, or null when everything is blank (so empty addresses don't
 * persist as `{}`).
 */
export function buildAddressValue(
  fields: AddressFields
): Record<string, string> | null {
  const entries = Object.entries(fields)
    .map(([key, value]) => [key, value.trim()] as const)
    .filter(([, value]) => value !== "");
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

/** Format an address value as display lines (street / line2 / city, state zip / country). */
export function formatAddressLines(address: unknown): string[] {
  const f = parseAddress(address);
  const stateZip = [f.state, f.zip].filter(Boolean).join(" ");
  const cityLine = [f.city, stateZip].filter(Boolean).join(", ");
  return [f.street, f.line2, cityLine, f.country].filter((line) => line !== "");
}

// =============================================================================
// Section component
// =============================================================================

type CustomerAddressSectionProps = {
  data: { address?: unknown } | null;
  editing?: boolean;
  /** UseFormReturn from EntityDetailUnified (typed unknown in the section contract). */
  form?: unknown;
};

/**
 * Custom section body for the customer "Billing Address" section. View mode
 * renders formatted address lines; edit/create mode renders inputs bound to
 * the entity form's `address` JSONB value.
 */
export function CustomerAddressSection({
  data,
  editing,
  form,
}: CustomerAddressSectionProps) {
  const rhf = form as UseFormReturn<Record<string, unknown>> | undefined;
  if (editing && rhf) {
    // Separate component so it remounts on each edit session and re-seeds
    // its local state from the (possibly reset) form value.
    return <AddressEditor form={rhf} />;
  }
  return <AddressDisplay address={data?.address} />;
}

function AddressDisplay({ address }: { address: unknown }) {
  const lines = formatAddressLines(address);
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No billing address on file.</p>
    );
  }
  return (
    <address className="space-y-0.5 text-sm not-italic">
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </address>
  );
}

function AddressEditor({
  form,
}: {
  form: UseFormReturn<Record<string, unknown>>;
}) {
  // Seed from current form state (reset from the loaded record, or blank in
  // create mode); every change writes the full normalized object back so
  // legacy key spellings are migrated on first edit.
  const [fields, setFields] = useState<AddressFields>(() =>
    parseAddress(form.getValues("address"))
  );

  const update = (key: keyof AddressFields, value: string) => {
    const next = { ...fields, [key]: value };
    setFields(next);
    form.setValue("address", buildAddressValue(next), { shouldDirty: true });
  };

  const input = (
    key: keyof AddressFields,
    label: string,
    placeholder: string,
    className?: string
  ) => (
    <div className={className}>
      <Label htmlFor={`customer-address-${key}`} className="mb-1.5 block">
        {label}
      </Label>
      <Input
        id={`customer-address-${key}`}
        value={fields[key]}
        placeholder={placeholder}
        onChange={(e) => update(key, e.target.value)}
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {input("street", "Street", "e.g., 123 Main St", "sm:col-span-3")}
      {input("line2", "Line 2", "Suite, unit, floor (optional)", "sm:col-span-3")}
      {input("city", "City", "e.g., Portland")}
      {input("state", "State", "e.g., OR")}
      {input("zip", "ZIP", "e.g., 97201")}
      {input("country", "Country", "e.g., USA", "sm:col-span-3")}
    </div>
  );
}
