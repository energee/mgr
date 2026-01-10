/**
 * Entity Registry
 *
 * Central registry of all entity configurations.
 * Import and register entities here to make them available throughout the app.
 *
 * AI Integration:
 * This registry can be queried to understand what entities exist in the system,
 * their relationships, and available operations.
 */

import { registerEntity, entityRegistry, type EntityConfig } from "@/types/entity";

// Import entity configurations
import { batchEntity } from "./batch";
import { brewLogEntity } from "./brew-log";

// =============================================================================
// Register All Entities
// =============================================================================

// Production domain
registerEntity(batchEntity);
registerEntity(brewLogEntity);

// TODO: Add remaining entities as they're created
// registerEntity(recipeEntity);
// registerEntity(vesselEntity);

// Packaging domain
// registerEntity(packagingSessionEntity);
// registerEntity(packagingFormatEntity);
// registerEntity(finishedGoodEntity);

// Inventory domain
// registerEntity(binEntity);
// registerEntity(locationTransferEntity);

// Purchasing domain
// registerEntity(supplierEntity);
// registerEntity(ingredientEntity);
// registerEntity(purchaseOrderEntity);

// Sales domain
// registerEntity(orderEntity);
// registerEntity(customerEntity);
// registerEntity(priceTierEntity);

// =============================================================================
// Exports
// =============================================================================

export { entityRegistry };

// Re-export individual entities for direct import
export { batchEntity } from "./batch";
export { brewLogEntity, phaseConfig, metricConfig } from "./brew-log";
export type { BrewEvent, BrewMeasurement, BrewLogFormValues } from "./brew-log";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get all registered entities as an array.
 */
export function getAllEntities(): EntityConfig<Record<string, unknown>>[] {
  return Array.from(entityRegistry.values());
}

/**
 * Get entity by name, throwing if not found.
 */
export function getEntityOrThrow(name: string): EntityConfig<Record<string, unknown>> {
  const entity = entityRegistry.get(name);
  if (!entity) {
    throw new Error(`Entity not found: ${name}`);
  }
  return entity;
}

/**
 * Get entities grouped by domain.
 */
export function getEntitiesByDomain(): Record<string, EntityConfig<Record<string, unknown>>[]> {
  const grouped: Record<string, EntityConfig<Record<string, unknown>>[]> = {};

  for (const entity of entityRegistry.values()) {
    if (!grouped[entity.domain]) {
      grouped[entity.domain] = [];
    }
    grouped[entity.domain].push(entity);
  }

  return grouped;
}

/**
 * Generate schema registry data for AI integration.
 * This can be used to seed the _schema_registry table.
 */
export function generateSchemaRegistryData() {
  return getAllEntities().map((entity) => ({
    entity_name: entity.name,
    display_name: entity.displayName,
    description: entity.description,
    domain: entity.domain,
    purpose: entity.description,
    lifecycle: entity.stateMachine
      ? entity.stateMachine.states.join(" → ")
      : null,
    key_relationships: entity.relations?.map((r) => r.entity) || [],
    actions: entity.actions?.map((a) => ({
      name: a.name,
      label: a.label,
      fromStates: a.fromStates,
      toState: a.toState,
    })) || [],
    query_examples: entity.queryExamples || [],
    field_descriptions: Object.fromEntries(
      entity.formFields.map((f) => [f.name, f.description || f.label])
    ),
  }));
}
