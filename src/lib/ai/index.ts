/**
 * AI Integration Utilities
 *
 * This module exports utilities for AI agents to interact with the MGR
 * brewery management system. It provides:
 *
 * - Recipe analysis and style compliance checking
 * - Schema introspection for understanding the data model
 * - Brewing calculations and formulas
 * - Query templates for common operations
 *
 * @example
 * ```typescript
 * import {
 *   analyzeStyleCompliance,
 *   getRecipeSummary,
 *   getSchemaContext
 * } from '@/lib/ai';
 *
 * // Analyze a recipe
 * const compliance = await analyzeStyleCompliance(recipeId);
 * const summary = await getRecipeSummary(recipeId);
 *
 * // Get schema information
 * const schema = await getSchemaContext('production');
 * ```
 */

// Recipe analysis
export {
  analyzeStyleCompliance,
  getRecipeSummary,
  getRecipeSuggestions,
  BrewingCalculations,
  WaterChemistry,
  FermentationAnalysis,
  type StyleComplianceResult,
  type RecipeSummary,
  type RecipeSuggestion,
  type RecipeSuggestionsResult,
  type ParameterAnalysis,
} from "./recipe-analyzer";

// Schema context
export {
  getSchemaContext,
  getSchemaRegistry,
  getDomainSummary,
  getTableInfo,
  getRelatedTables,
  getStateMachine,
  getValidTransitions,
  generateAIContextPrompt,
  STATE_MACHINES,
  QUERY_TEMPLATES,
  DOMAIN_DESCRIPTIONS,
  type SchemaTable,
  type SchemaContext,
  type DomainSummary,
} from "./schema-context";

// Query helpers
export { AIQueryHelpers } from "./query-helpers";
