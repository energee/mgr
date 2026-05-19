/**
 * Server-safe entity core registry.
 *
 * Companion to `src/entities/index.ts`: that module imports every per-entity
 * `index.ts` (which pulls `presentation.tsx`, which pulls React) to build the
 * full `EntityConfig` registry. This module imports only the per-entity
 * `core.ts` modules — strictly React-free — so it can be loaded from server
 * route handlers (`src/app/api/chat/*`) and any future server consumer.
 *
 * Replaces the hand-maintained `src/app/api/chat/entity-map.ts`. Each entry is
 * passed through `resolveServerCore` to fill the one required `EntityCore`
 * default (`displayNamePlural`); all other fields pass through from `core.ts`.
 */

import { resolveServerCore, type EntityCore } from "@/types/entity";

import { allocationCore } from "./allocation/core";
import { batchCore } from "./batch/core";
import { beerStyleCore } from "./beer-style/core";
import { binCore } from "./bin/core";
import { brandCore } from "./brand/core";
import { brewLogCore } from "./brew-log/core";
import { containerCore } from "./container/core";
import { customerCore } from "./customer/core";
import { deliveryCore } from "./delivery/core";
import { enumValueCore } from "./enum-value/core";
import { finishedGoodCore } from "./finished-good/core";
import { inventoryItemCore } from "./inventory-item/core";
import { inventoryLotCore } from "./inventory-lot/core";
import { kegInventoryCore } from "./keg-inventory/core";
import { kegOwnerCore } from "./keg-owner/core";
import { kegTransactionCore } from "./keg-transaction/core";
import { locationCore } from "./location/core";
import { locationTransferCore } from "./location-transfer/core";
import { orderCore } from "./order/core";
import { orderItemCore } from "./order-item/core";
import { packagingSessionCore } from "./packaging-session/core";
import { pickListCore } from "./pick-list/core";
import { poLineItemCore } from "./po-line-item/core";
import { poReceiveCore } from "./po-receive/core";
import { pricingTierCore } from "./pricing-tier/core";
import { pricingTierPriceCore } from "./pricing-tier-price/core";
import { purchaseOrderCore } from "./purchase-order/core";
import { recipeCore } from "./recipe/core";
import { salesChannelCore } from "./sales-channel/core";
import { sellingFormatCore } from "./selling-format/core";
import { sessionLineItemCore } from "./session-line-item/core";
import { supplierCore } from "./supplier/core";
import { userProfileCore } from "./user-profile/core";
import { vesselCore } from "./vessel/core";
import { vesselTransferCore } from "./vessel-transfer/core";
import { waterProfileCore } from "./water-profile/core";
import { yeastPitchCore } from "./yeast-pitch/core";
import { yeastPitchEventCore } from "./yeast-pitch-event/core";
import { yeastStrainCore } from "./yeast-strain/core";

// EntityCore<T> uses T in invariant positions, so heterogeneous cores can't
// unify under a common T. `any` is required to collect them into one array —
// the same trade-off `src/entities/index.ts` makes for the full configs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allCores: Array<import("@/types/entity").EntityCoreInput<any>> = [
  allocationCore, batchCore, beerStyleCore, binCore, brandCore, brewLogCore,
  containerCore, customerCore, deliveryCore, enumValueCore, finishedGoodCore,
  inventoryItemCore, inventoryLotCore, kegInventoryCore, kegOwnerCore,
  kegTransactionCore, locationCore, locationTransferCore, orderCore,
  orderItemCore, packagingSessionCore, pickListCore, poLineItemCore,
  poReceiveCore, pricingTierCore, pricingTierPriceCore, purchaseOrderCore,
  recipeCore, salesChannelCore, sellingFormatCore, sessionLineItemCore,
  supplierCore, userProfileCore, vesselCore, vesselTransferCore,
  waterProfileCore, yeastPitchCore, yeastPitchEventCore, yeastStrainCore,
];

/**
 * Server-safe registry: entity name → resolved `EntityCore`. Built from the
 * 39 `core.ts` modules, with `displayNamePlural` defaults filled in.
 *
 * Consumed by `src/app/api/chat/route.ts` and `src/app/api/chat/tools.ts`
 * (`searchEntity`, `getEntityDetail`, `fetchEntityContext`).
 */
export const coreRegistry: Map<string, EntityCore<Record<string, unknown>>> =
  new Map(
    allCores.map((core) => [core.name, resolveServerCore(core)] as const),
  );
