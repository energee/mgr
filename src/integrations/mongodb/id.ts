/**
 * Deterministic UUID Generation
 *
 * Converts MongoDB ObjectIDs to deterministic UUID v5 values.
 * Uses the same namespace as PR #161's Python migration scripts
 * so IDs are consistent across sync runs.
 */

import { v5 as uuidv5 } from "uuid";

/** Fixed namespace for all MongoDB-to-PostgreSQL ID mappings. */
const MIGRATION_NAMESPACE = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

/** Convert a MongoDB ObjectID string to a deterministic UUID v5. */
export function objectIdToUuid(objectId: string): string {
  return uuidv5(objectId, MIGRATION_NAMESPACE);
}
