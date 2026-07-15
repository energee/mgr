// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { replaceRecipeAdditions } from "../recipe-additions-service";

const RECIPE_ID = "00000000-0000-0000-0480-000000000001";
const ADDITION_ID = "00000000-0000-0000-0480-000000000002";
const ADDITIVE_ID = "00000000-0000-0000-0480-000000000003";

function makeClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
  };
}

describe("replaceRecipeAdditions", () => {
  it("sends the versioned category replacement through the shared RPC", async () => {
    const { client, rpc } = makeClient({ data: { version: 8 }, error: null });
    const items = [{
      id: ADDITION_ID,
      additive_id: ADDITIVE_ID,
      amount: 4.25,
      unit: "g",
      timing: "mash",
      target: "mash",
    }];

    await expect(replaceRecipeAdditions(client, {
      recipeId: RECIPE_ID,
      expectedVersion: 7,
      scope: "water_chemistry",
      items,
    })).resolves.toEqual({ version: 8 });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("replace_recipe_additions_atomic", {
      p_recipe_id: RECIPE_ID,
      p_expected_version: 7,
      p_scope: "water_chemistry",
      p_items: items,
    });
  });

  it("preserves the database error so callers cannot report false success", async () => {
    const conflict = {
      code: "PT409",
      message: "Recipe version conflict: expected 7, found 8",
    };
    const { client } = makeClient({ data: null, error: conflict });

    await expect(replaceRecipeAdditions(client, {
      recipeId: RECIPE_ID,
      expectedVersion: 7,
      scope: "other",
      items: [],
    })).rejects.toMatchObject(conflict);
  });

  it("rejects a malformed success response", async () => {
    const { client } = makeClient({ data: {}, error: null });

    await expect(replaceRecipeAdditions(client, {
      recipeId: RECIPE_ID,
      expectedVersion: 7,
      scope: "other",
      items: [],
    })).rejects.toThrow("returned no committed version");
  });
});
