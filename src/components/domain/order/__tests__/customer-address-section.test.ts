/**
 * Customer billing address section tests
 *
 * Covers the S7 customer.address fix
 * (src/components/domain/order/customer-address-section.tsx):
 * - parseAddress: normalized reads with legacy key fallbacks mirroring
 *   mapAddress() precedence (line1/address1, region, postal_code/postalCode)
 * - buildAddressValue: trimmed normalized-key object, null when blank
 * - formatAddressLines: display-line formatting
 * - key compatibility: values written by the editor round-trip through the
 *   real QuickBooks mapAddress() into BillAddr fields
 * - entity wiring: customer config exposes the section and its schema
 *   accepts the JSONB address payload
 */

import { describe, it, expect, vi } from "vitest";

// sync-utils imports the server Supabase client (next/headers + env at
// module scope) — mock it; mapAddress itself is pure.
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
}));

// Entity configs transitively import components that call createClient()
// at module scope — mock to avoid env var requirements during import.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ data: [], error: null }),
    }),
  }),
}));

import {
  parseAddress,
  buildAddressValue,
  formatAddressLines,
  CustomerAddressSection,
} from "@/components/domain/order/customer-address-section";
import { mapAddress } from "@/integrations/quickbooks/sync-utils";
import { customerEntity, customerSchema } from "@/entities/customer";

describe("parseAddress", () => {
  it("returns blank fields for null/non-object values", () => {
    for (const value of [null, undefined, "123 Main St", 42]) {
      expect(parseAddress(value)).toEqual({
        street: "",
        line2: "",
        city: "",
        state: "",
        zip: "",
        country: "",
      });
    }
  });

  it("reads normalized keys directly", () => {
    expect(
      parseAddress({
        street: "123 Main St",
        line2: "Suite 4",
        city: "Portland",
        state: "OR",
        zip: "97201",
        country: "USA",
      })
    ).toEqual({
      street: "123 Main St",
      line2: "Suite 4",
      city: "Portland",
      state: "OR",
      zip: "97201",
      country: "USA",
    });
  });

  it("falls back to legacy key spellings with mapAddress precedence", () => {
    expect(
      parseAddress({
        line1: "5 Oak Ave",
        address2: "Floor 2",
        city: "Bend",
        region: "OR",
        postal_code: "97701",
      })
    ).toEqual({
      street: "5 Oak Ave",
      line2: "Floor 2",
      city: "Bend",
      state: "OR",
      zip: "97701",
      country: "",
    });
    // address1 and postalCode are last in their fallback chains
    expect(parseAddress({ address1: "9 Elm St", postalCode: "97005" })).toMatchObject({
      street: "9 Elm St",
      zip: "97005",
    });
  });

  it("ignores blank and non-string values when falling back", () => {
    expect(parseAddress({ street: "  ", line1: "Real St", zip: 97201 })).toMatchObject(
      { street: "Real St", zip: "" }
    );
  });
});

describe("buildAddressValue", () => {
  it("returns null when every field is blank", () => {
    expect(
      buildAddressValue({
        street: "",
        line2: "  ",
        city: "",
        state: "",
        zip: "",
        country: "",
      })
    ).toBeNull();
  });

  it("returns only non-blank trimmed fields under normalized keys", () => {
    expect(
      buildAddressValue({
        street: " 123 Main St ",
        line2: "",
        city: "Portland",
        state: "OR",
        zip: "97201",
        country: "",
      })
    ).toEqual({
      street: "123 Main St",
      city: "Portland",
      state: "OR",
      zip: "97201",
    });
  });
});

describe("formatAddressLines", () => {
  it("formats street / line2 / city-state-zip / country lines", () => {
    expect(
      formatAddressLines({
        street: "123 Main St",
        line2: "Suite 4",
        city: "Portland",
        state: "OR",
        zip: "97201",
        country: "USA",
      })
    ).toEqual(["123 Main St", "Suite 4", "Portland, OR 97201", "USA"]);
  });

  it("omits empty parts and returns [] for empty addresses", () => {
    expect(formatAddressLines({ city: "Bend", state: "OR" })).toEqual(["Bend, OR"]);
    expect(formatAddressLines(null)).toEqual([]);
    expect(formatAddressLines({})).toEqual([]);
  });
});

describe("QuickBooks mapAddress compatibility", () => {
  it("editor-written values map onto every BillAddr field", () => {
    const stored = buildAddressValue({
      street: "123 Main St",
      line2: "Suite 4",
      city: "Portland",
      state: "OR",
      zip: "97201",
      country: "USA",
    });
    expect(mapAddress(stored)).toEqual({
      Line1: "123 Main St",
      Line2: "Suite 4",
      City: "Portland",
      CountrySubDivisionCode: "OR",
      PostalCode: "97201",
      Country: "USA",
    });
  });

  it("legacy rows re-saved through the editor still map correctly", () => {
    // Simulate the editor's first-edit normalization of a legacy row
    const normalized = buildAddressValue(
      parseAddress({ line1: "5 Oak Ave", region: "OR", postal_code: "97701" })
    );
    expect(mapAddress(normalized)).toMatchObject({
      Line1: "5 Oak Ave",
      CountrySubDivisionCode: "OR",
      PostalCode: "97701",
    });
  });
});

describe("customer entity wiring", () => {
  it("exposes a billing-address section backed by CustomerAddressSection", () => {
    const section = customerEntity.sections?.find((s) => s.id === "billing-address");
    expect(section).toBeDefined();
    expect(section?.component).toBe(CustomerAddressSection);
  });

  it("schema accepts the JSONB address object and null", () => {
    expect(
      customerSchema.safeParse({
        name: "Acme",
        customer_type: "distributor",
        address: { street: "123 Main St", city: "Portland" },
      }).success
    ).toBe(true);
    expect(
      customerSchema.safeParse({
        name: "Acme",
        customer_type: "distributor",
        address: null,
      }).success
    ).toBe(true);
  });
});
