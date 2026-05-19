"use client";

/**
 * Recipe Analysis Component
 *
 * Displays AI-powered style compliance analysis and improvement suggestions
 * for a recipe. Uses database functions for analysis calculations.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  Sparkles,
  Lightbulb,
  RefreshCw,
} from "lucide-react";
import {
  analyzeStyleCompliance,
  getRecipeSuggestions,
  type ParameterAnalysis,
} from "@/domain/ai/recipe-analyzer";
import { createClient } from "@/lib/supabase/client";
import { recipeKeys } from "@/lib/query-keys";

// =============================================================================
// Types
// =============================================================================

type RecipeAnalysisProps = {
  /** Direct recipe ID (for standalone usage) */
  recipeId?: string;
  recipeName?: string;
  /** Entity data prop (for EntityDetail integration) */
  data?: {
    id: string | null;
    name: string | null;
    [key: string]: unknown;
  };
}

// =============================================================================
// Helper Components
// =============================================================================

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "in_range":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "below_range":
    case "above_range":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    default:
      return <XCircle className="h-4 w-4 text-muted-foreground" />;
  }
}

function ParameterRow({
  label,
  analysis,
}: {
  label: string;
  analysis: ParameterAnalysis;
}) {
  const decimals = label === "OG" || label === "FG" ? 3 : 1;

  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0">
      <div className="flex items-center gap-2">
        <StatusIcon status={analysis.status} />
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm">
          {analysis.value?.toFixed(decimals) ?? "—"}
        </div>
        <div className="text-xs text-muted-foreground">
          {analysis.min != null && analysis.max != null
            ? `Range: ${analysis.min.toFixed(decimals)} - ${analysis.max.toFixed(decimals)}`
            : "Range: —"}
        </div>
      </div>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    default:
      return <Lightbulb className="h-4 w-4 text-blue-500" />;
  }
}

function SuggestionItem({
  suggestion,
}: {
  suggestion: { category: string; severity: string; message: string };
}) {
  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0">
      <div className="mt-0.5">
        <SeverityIcon severity={suggestion.severity} />
      </div>
      <div className="flex-1">
        <Badge variant="outline" className="mb-1">
          {suggestion.category}
        </Badge>
        <p className="text-sm">{suggestion.message}</p>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function RecipeAnalysis({ recipeId: propRecipeId, recipeName: propRecipeName, data }: RecipeAnalysisProps) {
  const supabase = createClient();
  // Support both direct props and entity data prop
  const recipeId = propRecipeId || data?.id;
  const recipeName = propRecipeName || data?.name;

  const [isOpen, setIsOpen] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  const {
    data: compliance,
    isLoading: complianceLoading,
    error: complianceError,
    refetch: refetchCompliance,
  } = useQuery({
    queryKey: recipeKeys.styleCompliance(recipeId!),
    queryFn: () => analyzeStyleCompliance(supabase, recipeId!),
    enabled: hasAnalyzed && !!recipeId,
    retry: false,
  });

  const {
    data: suggestions,
    isLoading: suggestionsLoading,
    error: suggestionsError,
    refetch: refetchSuggestions,
  } = useQuery({
    queryKey: recipeKeys.suggestions(recipeId!),
    queryFn: () => getRecipeSuggestions(supabase, recipeId!),
    enabled: hasAnalyzed && !!recipeId,
    retry: false,
  });

  // Don't render if no recipe ID available
  if (!recipeId) {
    return null;
  }

  const handleAnalyze = () => {
    setHasAnalyzed(true);
    setIsOpen(true);
    refetchCompliance();
    refetchSuggestions();
  };

  const isLoading = complianceLoading || suggestionsLoading;
  const hasError = complianceError || suggestionsError;

  const complianceCount = compliance
    ? Object.values(compliance.analysis).filter((a) => a.status === "in_range").length
    : 0;
  const totalParams = 5;
  const compliancePercent = Math.round((complianceCount / totalParams) * 100);

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Recipe Analysis</CardTitle>
            <div className="flex items-center gap-2">
              {hasAnalyzed && !isLoading && compliance && (
                <Badge
                  variant={compliancePercent === 100 ? "default" : "secondary"}
                  className="gap-1"
                >
                  {compliancePercent}% on target
                </Badge>
              )}
              {!hasAnalyzed ? (
                <Button size="sm" onClick={handleAnalyze}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Analyze Recipe
                </Button>
              ) : (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={isOpen ? "Collapse analysis" : "Expand analysis"}>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>
          {hasAnalyzed && (
            <CardDescription>
              {recipeName || compliance?.recipe_name || "Recipe"} &bull;{" "}
              {compliance?.style_name || "No style set"}
            </CardDescription>
          )}
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : hasError ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <AlertTriangle className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">
                  Unable to analyze recipe. Make sure the recipe has a style and estimates configured.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    refetchCompliance();
                    refetchSuggestions();
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
              </div>
            ) : (
              <>
                {/* Style Compliance */}
                {compliance && (
                  <div>
                    <h4 className="font-medium mb-3">Style Compliance</h4>
                    <div className="border rounded-lg p-3">
                      <ParameterRow label="OG" analysis={compliance.analysis.og} />
                      <ParameterRow label="FG" analysis={compliance.analysis.fg} />
                      <ParameterRow label="ABV" analysis={compliance.analysis.abv} />
                      <ParameterRow label="IBU" analysis={compliance.analysis.ibu} />
                      <ParameterRow label="SRM" analysis={compliance.analysis.srm} />
                    </div>
                  </div>
                )}

                {/* Suggestions */}
                {suggestions && suggestions.suggestions.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <Lightbulb className="h-4 w-4" />
                      Suggestions ({suggestions.suggestion_count})
                    </h4>
                    <div className="border rounded-lg p-3">
                      {suggestions.suggestions.map((suggestion, index) => (
                        <SuggestionItem key={index} suggestion={suggestion} />
                      ))}
                    </div>
                  </div>
                )}

                {suggestions && suggestions.suggestions.length === 0 && (
                  <div className="flex items-center gap-2 text-green-600 py-4">
                    <CheckCircle2 className="h-5 w-5" />
                    <span>No suggestions - recipe looks great!</span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
