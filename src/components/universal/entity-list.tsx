/**
 * EntityList - re-exports from EntityDataTable (Dice UI implementation)
 *
 * All page files import from this module. Audit F-090: the default
 * `EntityList` export now points to the error-boundary-wrapped variant,
 * so a render-time exception in a custom cell renderer / FK resolution
 * surfaces as an inline error inside the list rather than crashing the
 * whole route.
 */

export {
  EntityDataTableWithErrorBoundary as EntityList,
} from "./entity-data-table";
