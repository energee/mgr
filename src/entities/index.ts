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
import { recipeEntity } from "./recipe";
import { vesselEntity } from "./vessel";
import { vesselTransferEntity } from "./vessel-transfer";
import { finishedGoodEntity } from "./finished-good";
import { packagingSessionEntity } from "./packaging-session";
import { orderEntity } from "./order";
import { customerEntity } from "./customer";
import { inventoryItemEntity } from "./inventory-item";
import { inventoryLotEntity } from "./inventory-lot";
import { supplierEntity } from "./supplier";
import { purchaseOrderEntity } from "./purchase-order";
import { orderItemEntity } from "./order-item";
import { poLineItemEntity } from "./po-line-item";
import { poReceiveEntity } from "./po-receive";
import { sessionLineItemEntity } from "./session-line-item";
import { packageTypeEntity } from "./package-type";
import { yeastStrainEntity } from "./yeast-strain";
import { yeastPitchEntity } from "./yeast-pitch";
import { salesChannelEntity } from "./sales-channel";
import { priceTierEntity } from "./price-tier";
import { tierPriceEntity } from "./tier-price";
import { kegTypeEntity } from "./keg-type";
import { kegInventoryEntity } from "./keg-inventory";
import { kegTransactionEntity } from "./keg-transaction";
import { locationEntity } from "./location";
import { userProfileEntity } from "./user-profile";
import { enumValueEntity } from "./enum-value";
import { pickListEntity } from "./pick-list";
import { allocationEntity } from "./allocation";
import { beerStyleEntity } from "./beer-style";
import { brandEntity } from "./brand";

// =============================================================================
// Register All Entities
// =============================================================================

// Production domain
registerEntity(batchEntity);
registerEntity(brewLogEntity);
registerEntity(recipeEntity);
registerEntity(vesselEntity);
registerEntity(vesselTransferEntity);
registerEntity(packagingSessionEntity);
registerEntity(sessionLineItemEntity);
registerEntity(yeastStrainEntity);
registerEntity(yeastPitchEntity);
registerEntity(beerStyleEntity);
registerEntity(brandEntity);

// Inventory domain
registerEntity(inventoryItemEntity);
registerEntity(inventoryLotEntity);
registerEntity(allocationEntity);
registerEntity(finishedGoodEntity);
registerEntity(packageTypeEntity);
registerEntity(kegTypeEntity);
registerEntity(kegInventoryEntity);
registerEntity(kegTransactionEntity);

// Sales domain
registerEntity(orderEntity);
registerEntity(customerEntity);
registerEntity(orderItemEntity);
registerEntity(salesChannelEntity);
registerEntity(priceTierEntity);
registerEntity(tierPriceEntity);
registerEntity(pickListEntity);

// Purchasing domain
registerEntity(supplierEntity);
registerEntity(purchaseOrderEntity);
registerEntity(poLineItemEntity);
registerEntity(poReceiveEntity);

// Settings domain
registerEntity(locationEntity);
registerEntity(userProfileEntity);
registerEntity(enumValueEntity);

// =============================================================================
// Exports
// =============================================================================

export { entityRegistry };

// Re-export individual entities for direct import
export { batchEntity } from "./batch";
export { brewLogEntity, phaseConfig, metricConfig } from "./brew-log";
export type { BrewEvent, BrewMeasurement, BrewLogFormValues } from "./brew-log";
export { recipeEntity } from "./recipe";
export { vesselEntity, VESSEL_TYPES } from "./vessel";
export type { VesselType, VesselFormValues } from "./vessel";
export { vesselTransferEntity } from "./vessel-transfer";
export type { VesselTransferFormValues } from "./vessel-transfer";
export { packagingSessionEntity } from "./packaging-session";
export type { PackagingSessionFormValues } from "./packaging-session";
export { sessionLineItemEntity } from "./session-line-item";
export type { SessionLineItemFormValues } from "./session-line-item";
export { orderEntity } from "./order";
export { customerEntity } from "./customer";
export { inventoryItemEntity } from "./inventory-item";
export { inventoryLotEntity } from "./inventory-lot";
export type { InventoryLotFormValues } from "./inventory-lot";
export { allocationEntity, SOURCE_TYPES, DESTINATION_TYPES, REASON_CODES } from "./allocation";
export type { AllocationFormValues } from "./allocation";
export { finishedGoodEntity } from "./finished-good";
export type { FinishedGoodFormValues } from "./finished-good";
export { supplierEntity } from "./supplier";
export { purchaseOrderEntity } from "./purchase-order";
export { orderItemEntity } from "./order-item";
export type { OrderItemFormValues } from "./order-item";
export { poLineItemEntity, CATALOG_TYPES } from "./po-line-item";
export type { POLineItemFormValues } from "./po-line-item";
export { poReceiveEntity } from "./po-receive";
export type { POReceiveFormValues } from "./po-receive";
export { packageTypeEntity } from "./package-type";
export type { PackageTypeFormValues } from "./package-type";
export { kegTypeEntity } from "./keg-type";
export type { KegTypeFormValues } from "./keg-type";
export { kegInventoryEntity, KEG_STATES } from "./keg-inventory";
export type { KegInventoryFormValues, KegState } from "./keg-inventory";
export { kegTransactionEntity } from "./keg-transaction";
export type { KegTransactionType } from "./keg-transaction";
export { yeastStrainEntity } from "./yeast-strain";
export type { YeastStrainFormValues } from "./yeast-strain";
export { yeastPitchEntity } from "./yeast-pitch";
export type { YeastPitchFormValues } from "./yeast-pitch";
export { salesChannelEntity } from "./sales-channel";
export type { SalesChannelFormValues } from "./sales-channel";
export { priceTierEntity } from "./price-tier";
export type { PriceTierFormValues } from "./price-tier";
export { tierPriceEntity } from "./tier-price";
export type { TierPriceFormValues } from "./tier-price";
export { locationEntity, LOCATION_TYPES } from "./location";
export type { LocationFormValues } from "./location";
export { userProfileEntity } from "./user-profile";
export type { UserProfileFormValues, UserRole, UserStatus } from "./user-profile";
export { enumValueEntity, ENUM_COLORS, fetchEnumTypes } from "./enum-value";
export type { EnumValueFormValues } from "./enum-value";
export { pickListEntity } from "./pick-list";
export type { PickListFormValues } from "./pick-list";
export { beerStyleEntity } from "./beer-style";
export type { BeerStyleFormValues } from "./beer-style";
export { brandEntity } from "./brand";
export type { BrandFormValues } from "./brand";

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
