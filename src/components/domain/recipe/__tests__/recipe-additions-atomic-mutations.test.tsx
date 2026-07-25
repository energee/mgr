// @vitest-environment jsdom

import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupRenderHarness } from "@/test/react-harness";
import { makeSupabase } from "@/test/supabase-mock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  replaceRecipeAdditions: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/services/recipe-additions-service", () => ({
  replaceRecipeAdditions: mocks.replaceRecipeAdditions,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock("@/hooks/use-unit-preferences", () => ({
  useVolumeUnit: () => "bbl",
}));

vi.mock("@/hooks/use-catalog", () => ({
  useCatalog: () => ({
    data: [{ id: "additive-gypsum", name: "Gypsum", type: "water_salt" }],
    isLoading: false,
  }),
}));

vi.mock("@/components/domain/batch/additions-editor", () => ({
  AdditionsEditor: ({
    onChange,
    disabled,
  }: {
    onChange: (items: Array<Record<string, unknown>>) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="edit-additions"
      disabled={disabled}
      onClick={() => onChange([{
        additive_id: "additive-whirlfloc",
        amount: 1,
        unit: "tablets",
        timing: "boil",
        position: 0,
      }])}
    >
      Edit fixture
    </button>
  ),
}));

import { RecipeAdditionsDisplay } from "../recipe-additions-display";
import { RecipeAdditionsPageContent } from "@/app/(app)/production/recipes/[id]/additions/page";

const RECIPE_ID = "00000000-0000-0000-0480-000000000001";
const SOURCE_PROFILE_ID = "00000000-0000-0000-0480-000000000002";
const TARGET_PROFILE_ID = "00000000-0000-0000-0480-000000000003";

const { render } = setupRenderHarness();

async function flushUpdates() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function queryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

beforeEach(() => {
  mocks.createClient.mockReset();
  mocks.replaceRecipeAdditions.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

describe("atomic recipe-additions mutation call sites", () => {
  it("does not report or cache water-addition success when the RPC rejects", async () => {
    const { supabase, callsByTable } = makeSupabase({
      recipes: [
        { data: { version: 7 }, error: null },
        { data: { version: 7 }, error: null },
      ],
      recipe_additions: [{ data: [], error: null }],
      water_profiles: [
        {
          data: {
            name: "Source",
            calcium_ppm: 0,
            magnesium_ppm: 0,
            sodium_ppm: 0,
            sulfate_ppm: 0,
            chloride_ppm: 0,
            bicarbonate_ppm: 0,
            ph: 7,
          },
          error: null,
        },
        {
          data: {
            name: "Target",
            calcium_ppm: 50,
            magnesium_ppm: 0,
            sodium_ppm: 0,
            sulfate_ppm: 100,
            chloride_ppm: 0,
            bicarbonate_ppm: 0,
            ph: 5.4,
          },
          error: null,
        },
      ],
    });
    mocks.createClient.mockReturnValue(supabase);
    mocks.replaceRecipeAdditions.mockRejectedValue(
      Object.assign(new Error("Recipe version conflict"), { code: "PT409" }),
    );
    const client = queryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const container = render(
      <QueryClientProvider client={client}>
        <RecipeAdditionsDisplay data={{
          id: RECIPE_ID,
          water_profile_id: SOURCE_PROFILE_ID,
          target_water_profile_id: TARGET_PROFILE_ID,
          mash_water_volume_gal: 100,
        }} />
      </QueryClientProvider>,
    );
    await flushUpdates();

    const apply = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Apply to Recipe"),
    );
    expect(apply).toBeDefined();
    await act(async () => apply!.click());
    await flushUpdates();

    expect(mocks.replaceRecipeAdditions).toHaveBeenCalledWith(supabase, {
      recipeId: RECIPE_ID,
      expectedVersion: 7,
      scope: "water_chemistry",
      items: [expect.objectContaining({
        additive_id: "additive-gypsum",
        unit: "g",
        timing: "mash",
      })],
    });
    expect(callsByTable.recipes).toHaveLength(2);
    for (const versionRead of callsByTable.recipes) {
      expect(versionRead.eq).toHaveBeenCalledWith("id", RECIPE_ID);
    }
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to apply: Recipe version conflict",
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Applied");
  });

  it("keeps the non-water editor dirty and uncached when the shared RPC rejects", async () => {
    const { supabase } = makeSupabase({
      recipes: [{
        data: {
          id: RECIPE_ID,
          name: "Atomic IPA",
          target_water_profile_id: null,
          version: 7,
        },
        error: null,
      }],
      recipe_additions: [{ data: [], error: null }],
    });
    mocks.createClient.mockReturnValue(supabase);
    mocks.replaceRecipeAdditions.mockRejectedValue(
      Object.assign(new Error("Recipe version conflict"), { code: "PT409" }),
    );
    const client = queryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const container = render(
      <QueryClientProvider client={client}>
        <RecipeAdditionsPageContent id={RECIPE_ID} />
      </QueryClientProvider>,
    );
    await flushUpdates();

    const edit = container.querySelector<HTMLButtonElement>('[data-testid="edit-additions"]');
    expect(edit).not.toBeNull();
    await act(async () => edit!.click());

    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Save Changes"),
    );
    expect(save).toBeDefined();
    expect(save?.disabled).toBe(false);
    await act(async () => save!.click());
    await flushUpdates();

    expect(mocks.replaceRecipeAdditions).toHaveBeenCalledWith(supabase, {
      recipeId: RECIPE_ID,
      expectedVersion: 7,
      scope: "other",
      items: [{
        id: undefined,
        additive_id: "additive-whirlfloc",
        amount: 1,
        unit: "tablets",
        timing: "boil",
        target: null,
      }],
    });
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Failed to save: Recipe version conflict",
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(save?.disabled).toBe(false);
  });
});
