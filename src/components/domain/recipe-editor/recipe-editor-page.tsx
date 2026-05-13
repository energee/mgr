/**
 * RecipeEditorPage - Main two-column recipe editor layout.
 *
 * Fetches the recipe from the database, wraps content in RecipeEditorProvider,
 * and renders all section components in the left column with a sticky sidebar
 * on the right showing live estimates.
 *
 * Replaces EntityDetailUnified for the recipe detail view, providing an
 * always-editable, purpose-built editing experience.
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys } from "@/lib/query-keys";
import { RecipeEditorProvider, useRecipeEditor, type RecipeData } from "./recipe-editor-context";
import { RecipeBasicsSection } from "./recipe-basics-section";
import { FermentablesSection } from "./fermentables-section";
import { WaterChemistrySection } from "./water-chemistry-section";
import { MashSection } from "./mash-section";
import { WhirlpoolSection } from "./whirlpool-section";
import { KnockoutSection } from "./knockout-section";
import { FermentationSection } from "./fermentation-section";
import { RecipeSidebar } from "./recipe-sidebar";
import { RecipeCloneDialog } from "@/components/domain/recipe-clone-dialog";
import { StatusBadge } from "@/components/universal/status-badge";
import { recipeEntity } from "@/entities/recipe";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useGravityUnit } from "@/hooks/use-unit-preferences";
import { formatGravityFromSg } from "@/lib/units";

type RecipeEditorPageProps = {
  id: string;
}

function SaveAllButton() {
  const { anyDirty, saveAll, isSaving } = useRecipeEditor();
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    setPending(true);
    try {
      await saveAll();
      toast.success("Recipe saved");
    } catch {
      // Errors are surfaced via per-section handleSaveError already.
    } finally {
      setPending(false);
    }
  };

  if (!anyDirty && !pending) return null;
  return (
    <Button size="sm" onClick={onClick} disabled={pending || isSaving}>
      {pending || isSaving ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : (
        <Save className="h-4 w-4 mr-1" />
      )}
      Save
    </Button>
  );
}

function MobileEstimatesBar() {
  const { estimates } = useRecipeEditor();
  const gravityUnit = useGravityUnit();
  const og = formatGravityFromSg(estimates.og, gravityUnit);
  const fg = formatGravityFromSg(estimates.fg, gravityUnit);
  return (
    <div className="flex gap-4 text-sm">
      <span><span className="text-muted-foreground">OG</span>{" "}<span className="font-mono font-medium">{og}</span></span>
      <span><span className="text-muted-foreground">FG</span>{" "}<span className="font-mono font-medium">{fg}</span></span>
      <span><span className="text-muted-foreground">ABV</span>{" "}<span className="font-mono font-medium">{estimates.abv !== null ? `${estimates.abv}%` : "—"}</span></span>
      <span><span className="text-muted-foreground">IBU</span>{" "}<span className="font-mono font-medium">{estimates.ibu?.toString() ?? "—"}</span></span>
      <span><span className="text-muted-foreground">SRM</span>{" "}<span className="font-mono font-medium">{estimates.srm?.toString() ?? "—"}</span></span>
    </div>
  );
}

function RecipeEditorSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8" />
        <div>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-24 mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
        <div className="hidden lg:block">
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function RecipeEditorPage({ id }: RecipeEditorPageProps) {
  const supabase = createClient();
  const router = useRouter();
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);

  const { data: recipe, isLoading, error, refetch } = useQuery({
    queryKey: recipeKeys.detail(id),
    queryFn: async () => {
      // recipes_with_estimates does not surface `version`, so fetch it
      // alongside the view in parallel and merge.
      const [viewRes, versionRes] = await Promise.all([
        supabase.from("recipes_with_estimates").select("*").eq("id", id).single(),
        supabase.from("recipes").select("version").eq("id", id).single(),
      ]);
      if (viewRes.error) throw viewRes.error;
      if (versionRes.error) throw versionRes.error;
      return { ...viewRes.data, version: versionRes.data.version } as unknown as RecipeData;
    },
  });

  // Intercept Cmd+S to prevent browser save dialog and guide user
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        toast.info("Use the Save button in each section to save changes");
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleCloneSuccess = useCallback(
    (newRecipeId: string) => {
      router.push(`/production/recipes/${newRecipeId}`);
    },
    [router]
  );

  if (isLoading) {
    return <RecipeEditorSkeleton />;
  }

  if (error || !recipe) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-lg font-semibold mb-2">Recipe not found</h2>
        <p className="text-muted-foreground mb-4">
          {error?.message || "The recipe could not be loaded."}
        </p>
        <Button variant="outline" asChild>
          <Link href="/production/recipes">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Recipes
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <RecipeEditorProvider initialRecipe={recipe} onRefresh={refetch}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/production/recipes">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold">{recipe.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <StatusBadge
                  status={recipe.status}
                  config={recipeEntity.stateMachine?.stateDisplay}
                />
                {recipe.style_name && (
                  <span className="text-sm text-muted-foreground">
                    {recipe.style_name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SaveAllButton />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCloneDialogOpen(true)}
            >
              <Copy className="h-4 w-4 mr-1" />
              Clone
            </Button>
          </div>
        </div>

        {/* Mobile sticky estimates bar */}
        <div className="lg:hidden sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur border-b">
          <MobileEstimatesBar />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Left: Sections */}
          <div className="space-y-4 min-w-0">
            <RecipeBasicsSection />
            <FermentablesSection />
            <WaterChemistrySection />
            <MashSection />
            <WhirlpoolSection />
            <KnockoutSection />
            <FermentationSection />
          </div>

          {/* Right: Sticky sidebar */}
          <div className="hidden lg:block">
            <RecipeSidebar />
          </div>
        </div>

        {/* Mobile sidebar (below content) */}
        <div className="lg:hidden">
          <RecipeSidebar />
        </div>
      </div>

      {/* Clone dialog */}
      <RecipeCloneDialog
        recipeId={id}
        recipeName={recipe.name}
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        onSuccess={handleCloneSuccess}
      />
    </RecipeEditorProvider>
  );
}
