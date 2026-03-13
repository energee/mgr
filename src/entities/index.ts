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

import { registerEntity, entityRegistry } from "@/types/entity";

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
import { containerEntity } from "./container";
import { sellingFormatEntity } from "./selling-format";
import { yeastStrainEntity } from "./yeast-strain";
import { yeastPitchEntity } from "./yeast-pitch";
import { yeastPitchEventEntity } from "./yeast-pitch-event";
import { salesChannelEntity } from "./sales-channel";
import { pricingTierEntity } from "./pricing-tier";
import { pricingTierPriceEntity } from "./pricing-tier-price";
import { kegOwnerEntity } from "./keg-owner";
import { kegInventoryEntity } from "./keg-inventory";
import { kegTransactionEntity } from "./keg-transaction";
import { locationEntity } from "./location";
import { userProfileEntity } from "./user-profile";
import { enumValueEntity } from "./enum-value";
import { pickListEntity } from "./pick-list";
import { allocationEntity } from "./allocation";
import { beerStyleEntity } from "./beer-style";
import { brandEntity } from "./brand";
import { binEntity } from "./bin";
import { deliveryEntity } from "./delivery";
import { locationTransferEntity } from "./location-transfer";
import { waterProfileEntity } from "./water-profile";

// =============================================================================
// Register All Entities
// =============================================================================

// EntityConfig<T> uses T in invariant positions (ZodSchema<Partial<T>>, keyof T), so heterogeneous
// configs can't unify under a common T. `any` is required to collect them into one array.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allEntities: Array<import("@/types/entity").EntityConfig<any>> = [
  // Production
  batchEntity, brewLogEntity, recipeEntity, vesselEntity,
  vesselTransferEntity, packagingSessionEntity, sessionLineItemEntity,
  yeastStrainEntity, yeastPitchEntity, yeastPitchEventEntity, beerStyleEntity, brandEntity,
  // Inventory
  inventoryItemEntity, inventoryLotEntity, allocationEntity,
  finishedGoodEntity, containerEntity, sellingFormatEntity, kegOwnerEntity,
  kegInventoryEntity, kegTransactionEntity, binEntity, deliveryEntity,
  locationTransferEntity,
  // Sales
  orderEntity, customerEntity, orderItemEntity, salesChannelEntity,
  pricingTierEntity, pricingTierPriceEntity, pickListEntity,
  // Purchasing
  supplierEntity, purchaseOrderEntity, poLineItemEntity, poReceiveEntity,
  // Settings
  locationEntity, userProfileEntity, enumValueEntity,
  waterProfileEntity,
];

for (const entity of allEntities) {
  registerEntity(entity);
}

// =============================================================================
// Exports
// =============================================================================

export { entityRegistry };

// Re-export individual entities for direct import
export { batchEntity } from "./batch";
export { brewLogEntity } from "./brew-log";
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
export { containerEntity } from "./container";
export type { ContainerFormValues } from "./container";
export { sellingFormatEntity } from "./selling-format";
export type { SellingFormatFormValues } from "./selling-format";
export { kegOwnerEntity } from "./keg-owner";
export type { KegOwnerFormValues } from "./keg-owner";
export { kegInventoryEntity, KEG_STATES } from "./keg-inventory";
export type { KegInventoryFormValues, KegState } from "./keg-inventory";
export { kegTransactionEntity } from "./keg-transaction";
export type { KegTransactionType } from "./keg-transaction";
export { yeastStrainEntity } from "./yeast-strain";
export type { YeastStrainFormValues } from "./yeast-strain";
export { yeastPitchEntity } from "./yeast-pitch";
export type { YeastPitchFormValues } from "./yeast-pitch";
export { yeastPitchEventEntity } from "./yeast-pitch-event";
export type { YeastPitchEventFormValues } from "./yeast-pitch-event";
export { salesChannelEntity } from "./sales-channel";
export type { SalesChannelFormValues } from "./sales-channel";
export { pricingTierEntity } from "./pricing-tier";
export type { PricingTierFormValues } from "./pricing-tier";
export { pricingTierPriceEntity } from "./pricing-tier-price";
export type { PricingTierPriceFormValues } from "./pricing-tier-price";
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
export { binEntity, BIN_TYPES } from "./bin";
export type { BinFormValues } from "./bin";
export { deliveryEntity } from "./delivery";
export type { DeliveryFormValues } from "./delivery";
export { locationTransferEntity } from "./location-transfer";
export type { LocationTransferFormValues } from "./location-transfer";
export { waterProfileEntity } from "./water-profile";
export type { WaterProfileFormValues } from "./water-profile";
