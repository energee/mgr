/**
 * QuickCreateDialog tests (U2 audit finding): the master-data allowlist
 * gates which relation targets get an auto-attached "+" quick-create button,
 * the dialog's field selection renders only required/create-editable fields,
 * and FieldInput's relation case wires explicit vs. auto vs. suppressed
 * quick-create correctly.
 */

import { describe, it, expect, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Prevents env-var validation in @/lib/env from throwing at import time
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

// Prevents @sentry/nextjs initialisation errors in jsdom
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  QUICK_CREATE_ENTITIES,
  isQuickCreateEntity,
  getQuickCreateFields,
  getEditableFields,
  buildQuickCreateDefaults,
} from "@/components/universal/quick-create-dialog";
import { FieldInput } from "@/components/universal/field-input";
import type { UnifiedSectionDef } from "@/types/entity";

type AnyRecord = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("isQuickCreateEntity", () => {
  it("accepts master-data entities and rejects transactional ones", () => {
    expect(isQuickCreateEntity("customer")).toBe(true);
    expect(isQuickCreateEntity("supplier")).toBe(true);
    expect(isQuickCreateEntity("inventory_item")).toBe(true);
    expect(isQuickCreateEntity("water_profile")).toBe(true);
    // Transactional targets must never get an inline create button
    expect(isQuickCreateEntity("batch")).toBe(false);
    expect(isQuickCreateEntity("order")).toBe(false);
    expect(isQuickCreateEntity("purchase_order")).toBe(false);
    expect(isQuickCreateEntity("po_receive")).toBe(false);
    // Unregistered relation names (yeast-pitch's "yeast") are skipped
    expect(isQuickCreateEntity("yeast")).toBe(false);
    expect(isQuickCreateEntity(undefined)).toBe(false);
  });

  it("recipe is deliberately excluded (deep entity with its own editor)", () => {
    expect(QUICK_CREATE_ENTITIES.has("recipe")).toBe(false);
  });
});

describe("getQuickCreateFields / getEditableFields", () => {
  const sections: UnifiedSectionDef<AnyRecord>[] = [
    {
      id: "basic",
      title: "Basic",
      fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "kind", label: "Kind", type: "select", required: true },
        { name: "notes", label: "Notes", type: "textarea" },
        { name: "computed", label: "Computed", type: "text", editable: false },
        { name: "display_only", label: "Display only" }, // no type
      ],
    },
    {
      id: "later",
      title: "Hidden on create",
      hideOnCreate: true,
      fields: [
        { name: "secret", label: "Secret", type: "text", required: true },
      ],
    },
  ];

  it("returns only required, create-editable fields", () => {
    expect(getQuickCreateFields(sections).map((f) => f.name)).toEqual([
      "name",
      "kind",
    ]);
  });

  it("excludes hideOnCreate sections, editable:false and untyped fields", () => {
    expect(getEditableFields(sections).map((f) => f.name)).toEqual([
      "name",
      "kind",
      "notes",
    ]);
  });

  it("falls back to the name field when nothing is required", () => {
    const optional: UnifiedSectionDef<AnyRecord>[] = [
      {
        id: "s",
        title: "S",
        fields: [
          { name: "code", label: "Code", type: "text" },
          { name: "name", label: "Name", type: "text" },
        ],
      },
    ];
    expect(getQuickCreateFields(optional).map((f) => f.name)).toEqual(["name"]);
  });

  it("handles missing sections", () => {
    expect(getQuickCreateFields(undefined)).toEqual([]);
    expect(buildQuickCreateDefaults(undefined)).toEqual({});
  });
});

describe("buildQuickCreateDefaults", () => {
  it("uses config defaultValue and type-based fallbacks", () => {
    const sections: UnifiedSectionDef<AnyRecord>[] = [
      {
        id: "s",
        title: "S",
        fields: [
          { name: "name", label: "Name", type: "text" },
          { name: "qty", label: "Qty", type: "number" },
          { name: "parent_id", label: "Parent", type: "relation" },
          { name: "is_active", label: "Active", type: "switch", defaultValue: true },
          { name: "kind", label: "Kind", type: "select", defaultValue: () => "a" },
        ],
      },
    ];
    expect(buildQuickCreateDefaults(sections)).toEqual({
      name: "",
      qty: null,
      parent_id: null,
      is_active: true,
      kind: "a",
    });
  });
});

// ---------------------------------------------------------------------------
// FieldInput relation-case wiring
// ---------------------------------------------------------------------------

const { render: mount } = setupRenderHarness();

async function renderRelationField(
  field: AnyRecord,
  opts?: { disableQuickCreate?: boolean }
) {
  return mount(
    <FieldInput
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      field={field as any}
      value={null}
      onChange={() => {}}
      disableQuickCreate={opts?.disableQuickCreate}
    />
  );
}

describe("FieldInput relation quick-create attachment", () => {
  it("auto-attaches the '+' button for master-data target entities", async () => {
    const el = await renderRelationField({
      name: "customer_id",
      label: "Customer",
      type: "relation",
      relation: { entity: "customer", displayField: "name" },
    });
    expect(
      el.querySelector('button[aria-label="Create new customer"]')
    ).not.toBeNull();
  });

  it("does not attach for transactional target entities", async () => {
    const el = await renderRelationField({
      name: "batch_id",
      label: "Batch",
      type: "relation",
      relation: { entity: "batch", displayField: "batch_number" },
    });
    expect(el.querySelector('button[aria-label^="Create new"]')).toBeNull();
  });

  it("explicit field.quickCreate takes precedence over the generic button", async () => {
    const Explicit = ({ onCreated }: { onCreated: (id: string) => void }) => (
      <button
        type="button"
        aria-label="explicit-quick-create"
        onClick={() => onCreated("x")}
      />
    );
    const el = await renderRelationField({
      name: "water_profile_id",
      label: "Water Profile",
      type: "relation",
      relation: { entity: "water_profile", displayField: "name" },
      quickCreate: Explicit,
    });
    expect(
      el.querySelector('button[aria-label="explicit-quick-create"]')
    ).not.toBeNull();
    expect(
      el.querySelector('button[aria-label="Create new water profile"]')
    ).toBeNull();
  });

  it("disableQuickCreate suppresses the button (nested dialogs)", async () => {
    const el = await renderRelationField(
      {
        name: "customer_id",
        label: "Customer",
        type: "relation",
        relation: { entity: "customer", displayField: "name" },
      },
      { disableQuickCreate: true }
    );
    expect(el.querySelector('button[aria-label^="Create new"]')).toBeNull();
  });
});
