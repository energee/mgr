/**
 * Issue #558: the create form initializes optional select fields to "", but
 * schemas with optional `.uuid()` fields reject "" as "Invalid UUID" during
 * resolver validation (form.trigger runs BEFORE handleSave's ""→null pass),
 * so an untouched form can never submit. makeFormResolver normalizes ""→null
 * for non-required fields before the zod schema sees the values.
 */
import { describe, expect, it } from "vitest";

import { makeFormResolver } from "@/lib/form-resolver";
import { recipeSchema } from "@/lib/schemas/recipe";

// Mirrors the recipe create form's editable fields: name required, the
// optional uuid selects initialized to "" by buildDefaultValues.
const fields = [
  { name: "name", required: true },
  { name: "brand_id" },
  { name: "style_id" },
  { name: "yeast_id" },
  { name: "water_profile_id" },
  { name: "pricing_tier_id" },
  { name: "description" },
];

const resolverOptions = {
  fields: {},
  shouldUseNativeValidation: false,
} as Parameters<ReturnType<typeof makeFormResolver>>[2];

const untouchedCreateValues = {
  name: "Test IPA",
  brand_id: "",
  style_id: "",
  yeast_id: "",
  water_profile_id: "",
  pricing_tier_id: "",
  description: "",
  is_active: true,
  status: "draft",
};

describe("makeFormResolver (issue #558)", () => {
  it("accepts an untouched create form whose optional selects are ''", async () => {
    const resolver = makeFormResolver(recipeSchema, fields);
    const result = await resolver(untouchedCreateValues, undefined, resolverOptions);
    expect(result.errors).toEqual({});
  });

  it("still enforces required fields left empty", async () => {
    const resolver = makeFormResolver(recipeSchema, fields);
    const result = await resolver(
      { ...untouchedCreateValues, name: "" },
      undefined,
      resolverOptions
    );
    expect(result.errors).toHaveProperty("name");
    expect(result.errors).not.toHaveProperty("brand_id");
  });

  it("passes real selections through unchanged", async () => {
    const resolver = makeFormResolver(recipeSchema, fields);
    const uuid = "6a1f0e5e-0000-4000-8000-000000000000";
    const result = await resolver(
      { ...untouchedCreateValues, brand_id: uuid },
      undefined,
      resolverOptions
    );
    expect(result.errors).toEqual({});
  });
});
