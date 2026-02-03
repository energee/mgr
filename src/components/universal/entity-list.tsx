/**
 * EntityList - re-exports from EntityDataTable (Dice UI implementation)
 *
 * All page files import from this module, so this re-export ensures
 * backward compatibility without changing any page files.
 */

export {
  EntityDataTable as EntityList,
  EntityDataTableWithErrorBoundary as EntityListWithErrorBoundary,
  type EntityDataTableProps as EntityListProps,
} from "./entity-data-table";
