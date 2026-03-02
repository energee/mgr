/**
 * Service Layer
 *
 * Shared data access layer consumed by both UI components and AI chat tools.
 * All entity CRUD operations go through these services to ensure consistent
 * validation, error handling, and cache invalidation.
 */

export { entityService } from "./entity-service";
export { recipeService, type RecipeSummary } from "./recipe-service";
export {
  batchService,
  type BatchPerformanceReport,
  type BlendCandidate,
} from "./batch-service";
export {
  inventoryService,
  type InventoryOverview,
  type ExpiringLot,
} from "./inventory-service";
export {
  type ServiceResult,
  type ServiceError,
  type ListOptions,
  type TableName,
  type ViewName,
  type TableOrViewName,
  type TableRow,
  type TableInsert,
  type TableUpdate,
  ok,
  err,
  parseSupabaseError,
  formatServiceError,
} from "./types";
