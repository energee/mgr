/**
 * EntityList - re-exports from EntityDataTable (Dice UI implementation)
 *
 * All page files import from this module. Audit F-090: the default
 * `EntityList` export now points to the error-boundary-wrapped variant,
 * so a render-time exception in a custom cell renderer / FK resolution
 * surfaces as an inline error inside the list rather than crashing the
 * whole route. The previous "naked" variant remains available as
 * `EntityListUnsafe` for the rare consumer that needs to manage its own
 * boundary.
 */

export {
  EntityDataTableWithErrorBoundary as EntityList,
  EntityDataTable as EntityListUnsafe,
  type EntityDataTableProps as EntityListProps,
} from "./entity-data-table";
