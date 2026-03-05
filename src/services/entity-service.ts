/**
 * Generic Entity Service
 *
 * Shared data access layer for all entity CRUD operations. Consolidates
 * the query/mutation logic previously duplicated across EntityDetailUnified,
 * EntityDataTable, and AI chat tools into a single, testable module.
 *
 * Key design properties:
 * - Supabase client is always the first argument (works with browser or server client)
 * - Entity config provides table name, view table, Zod schema, state machine
 * - Returns ServiceResult<T> with typed errors and invalidation hints
 * - No React dependencies — callable from hooks, route handlers, or AI tools
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type { EntityConfig } from "@/types/entity";
import { entityKeys } from "@/lib/query-keys";
import {
  type ServiceResult,
  type ListOptions,
  ok,
  err,
  parseSupabaseError,
  dynamicFrom,
} from "./types";

// =============================================================================
// Escape Helpers
// =============================================================================

/**
 * Escape a search value for use inside a PostgREST .or() filter string.
 * PostgREST uses commas and parens as delimiters inside .or(); the correct
 * way to embed these in a value is to double-quote the entire filter token.
 * We also escape `%` and `_` which are LIKE/ILIKE wildcards.
 */
function escapePostgrestValue(value: string): string {
  // Escape LIKE wildcards (these are interpreted inside ilike patterns)
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Determine which table to read from: viewTable (if available) for computed
 * fields, or the base table.
 */
function readTable<T>(entity: EntityConfig<T>): string {
  return entity.viewTable ?? entity.table;
}

/**
 * Build invalidation key arrays for an entity mutation.
 * Invalidates the base table, view table (if different), and the specific record.
 */
function invalidationKeys<T>(entity: EntityConfig<T>, id?: string): readonly (readonly string[])[] {
  const keys: (readonly string[])[] = [entityKeys.all(entity.table)];

  if (entity.viewTable) {
    keys.push(entityKeys.all(entity.viewTable));
  }

  if (id) {
    keys.push(entityKeys.detail(entity.table, id));
    if (entity.viewTable) {
      keys.push(entityKeys.detail(entity.viewTable, id));
    }
  }

  return keys;
}

// =============================================================================
// Entity Service
// =============================================================================

export const entityService = {
  /**
   * List records for any entity, with filters, search, and sort.
   * Uses viewTable when available for computed fields.
   */
  async list<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    options?: ListOptions
  ): Promise<ServiceResult<T[]>> {
    try {
      const table = readTable(entity);
      let query = dynamicFrom(supabase, table).select("*");

      // Apply exact-match filters
      if (options?.filters) {
        for (const [key, value] of Object.entries(options.filters)) {
          if (value !== undefined && value !== null) {
            query = query.eq(key, value);
          }
        }
      }

      // Apply free-text search across searchableFields.
      // Values containing commas/parens must be double-quoted for PostgREST .or().
      if (options?.search && entity.searchableFields?.length) {
        const escaped = escapePostgrestValue(options.search);
        const needsQuoting = /[,().]/.test(escaped);
        const pattern = needsQuoting ? `"%${escaped}%"` : `%${escaped}%`;
        const searchCondition = entity.searchableFields
          .map((field) => `${field}.ilike.${pattern}`)
          .join(",");
        query = query.or(searchCondition);
      }

      // Apply sorting
      if (options?.sort) {
        query = query.order(options.sort.column, {
          ascending: options.sort.direction === "asc",
        });
      } else if (entity.defaultSort) {
        query = query.order(entity.defaultSort.column, {
          ascending: entity.defaultSort.direction === "asc",
        });
      }

      // Apply limit
      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;
      if (error) {
        return err(parseSupabaseError(error, { table }));
      }

      return ok(data as T[]);
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to list ${entity.displayNamePlural}: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },

  /**
   * Get a single record by ID.
   * Uses viewTable when available for computed fields.
   */
  async getById<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    id: string
  ): Promise<ServiceResult<T>> {
    try {
      const table = readTable(entity);
      const { data, error } = await dynamicFrom(supabase, table)
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        return err(parseSupabaseError(error, { table, id }));
      }

      return ok(data as T);
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to get ${entity.displayName}: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },

  /**
   * Create a new record. Validates against entity.formSchema.
   * Always writes to the base table (not viewTable).
   */
  async create<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    data: unknown
  ): Promise<ServiceResult<T>> {
    try {
      // Validate input
      const parsed = entity.formSchema.safeParse(data);
      if (!parsed.success) {
        return err({ code: "VALIDATION", issues: parsed.error.issues });
      }

      const { data: created, error } = await dynamicFrom(supabase, entity.table)
        .insert(parsed.data)
        .select()
        .single();

      if (error) {
        return err(parseSupabaseError(error, { table: entity.table }));
      }

      const newId = (created as Record<string, unknown>).id as string;
      return ok(created as T, invalidationKeys(entity, newId));
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to create ${entity.displayName}: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },

  /**
   * Update an existing record. Validates against entity.formSchema.
   * Supports optimistic locking when currentVersion is provided.
   * Always writes to the base table (not viewTable).
   */
  async update<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    id: string,
    data: unknown,
    currentVersion?: number
  ): Promise<ServiceResult<T>> {
    try {
      // Validate input
      const parsed = entity.formSchema.safeParse(data);
      if (!parsed.success) {
        return err({ code: "VALIDATION", issues: parsed.error.issues });
      }

      if (currentVersion !== undefined) {
        // Optimistic locking: include version check
        const updateData = {
          ...parsed.data,
          version: currentVersion + 1,
          updated_at: new Date().toISOString(),
        };

        const { data: updated, error } = await dynamicFrom(supabase, entity.table)
          .update(updateData)
          .eq("id", id)
          .eq("version", currentVersion)
          .select()
          .single();

        if (error) {
          // PostgREST returns PGRST116 when .single() matches no rows
          if (error.code === "PGRST116") {
            return err({
              code: "CONFLICT",
              currentVersion,
              message: "Record was modified by another user. Please refresh and try again.",
            });
          }
          return err(parseSupabaseError(error, { table: entity.table, id }));
        }

        return ok(updated as T, invalidationKeys(entity, id));
      }

      // Standard update (no version check)
      const { data: updated, error } = await dynamicFrom(supabase, entity.table)
        .update({ ...parsed.data, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return err(parseSupabaseError(error, { table: entity.table, id }));
      }

      return ok(updated as T, invalidationKeys(entity, id));
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to update ${entity.displayName}: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },

  /**
   * Transition entity state. Validates against entity.stateMachine.
   * Fetches current state to validate the transition is allowed.
   */
  async transition<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    id: string,
    targetState: string
  ): Promise<ServiceResult<T>> {
    try {
      const sm = entity.stateMachine;
      if (!sm) {
        return err({
          code: "UNKNOWN",
          message: `${entity.displayName} does not have a state machine`,
        });
      }

      // Fetch current state
      const { data: current, error: fetchError } = await dynamicFrom(supabase, entity.table)
        .select(sm.stateField)
        .eq("id", id)
        .single();

      if (fetchError) {
        return err(parseSupabaseError(fetchError, { table: entity.table, id }));
      }

      const currentState = current[sm.stateField] as string;
      const allowedTransitions = sm.transitions[currentState] || [];

      if (!allowedTransitions.includes(targetState)) {
        return err({
          code: "INVALID_TRANSITION",
          from: currentState,
          to: targetState,
          message: `Cannot transition ${entity.displayName} from "${currentState}" to "${targetState}"`,
        });
      }

      // Run validation hook if defined
      if (sm.hooks?.validate?.[targetState]) {
        const validationError = await sm.hooks.validate[targetState](current as T);
        if (validationError) {
          return err({
            code: "INVALID_TRANSITION",
            from: currentState,
            to: targetState,
            message: validationError,
          });
        }
      }

      // Perform the transition atomically — include current state in the WHERE
      // clause to prevent race conditions where another process changes the
      // state between our SELECT and UPDATE.
      const { data: updated, error: updateError } = await dynamicFrom(supabase, entity.table)
        .update({ [sm.stateField]: targetState })
        .eq("id", id)
        .eq(sm.stateField, currentState)
        .select()
        .single();

      if (updateError) {
        // PGRST116 = .single() matched no rows → state changed between read and write
        if (updateError.code === "PGRST116") {
          return err({
            code: "INVALID_TRANSITION",
            from: currentState,
            to: targetState,
            message: `State changed concurrently. Please refresh and try again.`,
          });
        }
        return err(parseSupabaseError(updateError, { table: entity.table, id }));
      }

      return ok(updated as T, invalidationKeys(entity, id));
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to transition ${entity.displayName}: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },

  /**
   * Delete (hard) or deactivate (soft) a record.
   * Always operates on the base table.
   */
  async remove<T>(
    supabase: SupabaseClient<Database>,
    entity: EntityConfig<T>,
    id: string,
    mode: "hard" | "soft"
  ): Promise<ServiceResult<void>> {
    try {
      if (mode === "soft") {
        const { error } = await dynamicFrom(supabase, entity.table)
          .update({ is_active: false })
          .eq("id", id);

        if (error) {
          return err(parseSupabaseError(error, { table: entity.table, id }));
        }
      } else {
        const { error } = await dynamicFrom(supabase, entity.table)
          .delete()
          .eq("id", id);

        if (error) {
          return err(parseSupabaseError(error, { table: entity.table, id }));
        }
      }

      return ok(undefined, invalidationKeys(entity, id));
    } catch (e) {
      return err({
        code: "UNKNOWN",
        message: `Failed to delete ${entity.displayName}: ${e instanceof Error ? e.message : String(e)}`,
        cause: e,
      });
    }
  },

};
