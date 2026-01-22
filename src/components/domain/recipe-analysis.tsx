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
  Target,
  Lightbulb,
  RefreshCw,
} from "lucide-react";
import {
  analyzeStyleCompliance,
  getRecipeSuggestions,
  type StyleComplianceResult,
  type RecipeSuggestionsResult,
  type ParameterAnalysis,
} from "@/lib/ai/recipe-analyzer";

// =============================================================================
// Types
// =============================================================================

interface RecipeAnalysisProps {
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

function ParameterRow({
  label,
  analysis,
}: {
  label: string;
  analysis: ParameterAnalysis;
}) {
  const getStatusIcon = () => {
    switch (analysis.status) {
      case "in_range":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "below_range":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "above_range":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <XCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    switch (analysis.status) {
      case "in_range":
        return "In range";
      case "below_range":
        return "Below range";
      case "above_range":
        return "Above range";
      default:
        return "Unknown";
    }
  };

  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0">
      <div className="flex items-center gap-2">
        {getStatusIcon()}
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm">
          {analysis.value?.toFixed(label === "OG" || label === "FG" ? 3 : 1) ?? "—"}
        </div>
        <div className="text-xs text-muted-foreground">
          Range: {analysis.min.toFixed(label === "OG" || label === "FG" ? 3 : 1)} - {analysis.max.toFixed(label === "OG" || label === "FG" ? 3 : 1)}
        </div>
      </div>
    </div>
  );
}

function SuggestionItem({
  suggestion,
}: {
  suggestion: { category: string; severity: string; message: string };
}) {
  const getIcon = () => {
    switch (suggestion.severity) {
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Lightbulb className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0">
      <div className="mt-0.5">{getIcon()}</div>
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
  // Support both direct props and entity data prop
  const recipeId = propRecipeId || data?.id;
  const recipeName = propRecipeName || data?.name;

  const [isOpen, setIsOpen] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  // Fetch style compliance
  // Note: Hooks must be called before any early returns (Rules of Hooks)
  const {
    data: complianceData,
    isLoading: complianceLoading,
    error: complianceError,
    refetch: refetchCompliance,
  } = useQuery({
    queryKey: ["recipe-style-compliance", recipeId],
    queryFn: () => {
      if (!recipeId) return null;
      return analyzeStyleCompliance(recipeId);
    },
    enabled: hasAnalyzed && !!recipeId,
    retry: false,
  });

  // Fetch suggestions
  const {
    data: suggestionsData,
    isLoading: suggestionsLoading,
    error: suggestionsError,
    refetch: refetchSuggestions,
  } = useQuery({
    queryKey: ["recipe-suggestions", recipeId],
    queryFn: () => {
      if (!recipeId) return null;
      return getRecipeSuggestions(recipeId);
    },
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

  // Calculate overall compliance
  const compliance = complianceData as StyleComplianceResult | undefined;
  const suggestions = suggestionsData as RecipeSuggestionsResult | undefined;

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
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Recipe Analysis</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {hasAnalyzed && !isLoading && compliance && (
                <Badge
                  variant={compliancePercent === 100 ? "default" : "secondary"}
                  className="gap-1"
                >
                  <Target className="h-3 w-3" />
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
                  <Button variant="ghost" size="icon">
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
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Style Compliance
                    </h4>
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
