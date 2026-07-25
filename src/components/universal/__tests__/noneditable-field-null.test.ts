/**
 * Non-editable fields must not enter the resolver's ""→null pass.
 *
 * `makeFormResolver` (issue #558) rewrites `""`→`null` for every non-required
 * field so untouched optional `.uuid()` selects can submit. But the field list
 * came from `getEditableFieldsFromSections`, which filtered on `type` alone —
 * so `editable: false` fields were included, `buildDefaultValues` seeded them
 * with `""` (text fields default to `""`), and a schema field that is
 * `.optional()` without `.nullable()` rejected the resulting `null`. The user
 * could not clear the error because the field is not editable, so the create
 * form could never submit.
 *
 * Real instance: batch `batch_code` is `editable: false` (entities/batch/
 * presentation.tsx) and `z.string().optional()` (lib/schemas/batch.ts). Same
 * shape for `brew_logs.brew_number` and `yeast_pitch_events.pitched_at`.
 */
import { describe, expect, it, vi } from "vitest";

// entity-detail-unified imports @/lib/supabase/client at module top level,
// which runs env validation on import (see docs/agents/gotchas.md).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({ select: () => ({ data: [], error: null }) }) }),
}));

import { getEditableFieldsFromSections } from "@/components/universal/entity-detail-unified";
import { makeFormResolver } from "@/lib/form-resolver";
import { batchSchema } from "@/lib/schemas/batch";

/** Mirrors the batch Overview section: auto-generated code + editable name. */
const sections = [
  {
    id: "overview",
    title: "Overview",
    fields: [
      { name: "batch_code", label: "Batch Code", type: "text", editable: false },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "notes", label: "Notes", type: "textarea" },
      // Display-only renderer (no `type`) — never a form input.
      { name: "quick_links", label: "Links" },
    ],
  },
] as Parameters<typeof getEditableFieldsFromSections>[0];

const resolverOptions = {
  fields: {},
  shouldUseNativeValidation: false,
} as Parameters<ReturnType<typeof makeFormResolver>>[2];

/** What buildDefaultValues seeds for an untouched batch create form. */
const untouchedCreateValues = {
  batch_code: "",
  name: "Test Batch",
  notes: "",
  status: "planned",
};

describe("getEditableFieldsFromSections", () => {
  it("excludes editable: false fields and display-only renderers", () => {
    expect(getEditableFieldsFromSections(sections).map((f) => f.name)).toEqual([
      "name",
      "notes",
    ]);
  });
});

describe("makeFormResolver with a non-editable field", () => {
  it("accepts an untouched create form whose non-editable text field is ''", async () => {
    // Pre-fix this failed with `batch_code: Invalid input: expected string,
    // received null` — unfixable from the UI, so create was fully blocked.
    const resolver = makeFormResolver(
      batchSchema,
      getEditableFieldsFromSections(sections)
    );
    const result = await resolver(untouchedCreateValues, undefined, resolverOptions);
    expect(result.errors).toEqual({});
  });

  it("leaves fields outside the section list untouched", async () => {
    const resolver = makeFormResolver(
      batchSchema,
      getEditableFieldsFromSections(sections)
    );
    const result = await resolver(
      { ...untouchedCreateValues, recipe_id: "" },
      undefined,
      resolverOptions
    );
    // recipe_id is `.uuid().nullable().optional()`: "" is rejected, null would
    // be accepted. It is not in `sections`, so the pass skips it and the schema
    // rejects it — proving the normalization is field-list driven.
    expect(result.errors).toHaveProperty("recipe_id");
  });

  it("still enforces required fields left empty", async () => {
    const resolver = makeFormResolver(
      batchSchema,
      getEditableFieldsFromSections(sections)
    );
    const result = await resolver(
      { ...untouchedCreateValues, name: "" },
      undefined,
      resolverOptions
    );
    expect(result.errors).toHaveProperty("name");
    expect(result.errors).not.toHaveProperty("batch_code");
  });
});
