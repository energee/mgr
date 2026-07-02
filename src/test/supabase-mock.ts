/**
 * Shared fake Supabase query-builder client for unit tests.
 *
 * `makeSupabase` is table-keyed: each `.from(table)` call shifts the next
 * queued { data, error } response for that table (in call order — safe under
 * Promise.all concurrency since queues are per-table) and returns a chainable
 * builder. Every chain method is a vi.fn returning the builder, and the
 * builder itself is thenable, so `await supabase.from(t).select().eq(...)`
 * resolves the queued response regardless of the exact chain shape the module
 * under test uses. Calling `.from()` for a table with an empty or missing
 * queue throws, surfacing unexpected queries loudly rather than passing
 * vacuously on recycled/empty data.
 *
 * Asserting query predicates: chain methods record their calls, e.g.
 * `callsByTable.allocations[0].eq.mock.calls` — use this to pin filters
 * (a test that only checks which tables were queried does not protect the
 * WHERE clause).
 *
 * Failure modes: queue `{ rejectWith: err }` to model the realistic
 * supabase-js failure (the awaited builder rejects); `throwingSupabase`
 * models a synchronous `.from()` throw for catch-all coverage.
 */
import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

export type FakeResponse = { data: unknown; error: unknown };
export type QueuedResponse = FakeResponse | { rejectWith: unknown };

const CHAIN_METHODS = [
  "select",
  "eq",
  "neq",
  "in",
  "is",
  "not",
  "or",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "contains",
  "order",
  "limit",
  "range",
  "single",
  "maybeSingle",
  "insert",
  "update",
  "upsert",
  "delete",
  "throwOnError",
] as const;

/** Chainable, thenable fake query builder resolving (or rejecting) `response`. */
export function makeQueryBuilder(response: QueuedResponse) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn((..._args: unknown[]) => builder);
  }
  builder.then = (
    resolve?: (v: FakeResponse) => unknown,
    reject?: (e: unknown) => unknown,
  ) =>
    ("rejectWith" in response
      ? Promise.reject(response.rejectWith)
      : Promise.resolve(response)
    ).then(resolve, reject);
  return builder;
}

/**
 * Builds a fake SupabaseClient from table-keyed response queues.
 * Returns the client plus `fromSpy` (assert which tables were queried) and
 * `callsByTable` (the builders created per table, in call order — assert
 * chain-method args on them).
 */
export function makeSupabase(responses: Record<string, QueuedResponse[]>) {
  const queues: Record<string, QueuedResponse[]> = {};
  for (const [table, list] of Object.entries(responses)) {
    queues[table] = [...list];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callsByTable: Record<string, any[]> = {};

  const fromSpy = vi.fn((table: string) => {
    const queue = queues[table];
    if (!queue || queue.length === 0) {
      throw new Error(`fake supabase: no queued response for table "${table}"`);
    }
    const response = queue.shift() as QueuedResponse;
    const builder = makeQueryBuilder(response);
    (callsByTable[table] ??= []).push(builder);
    return builder;
  });

  const supabase = { from: fromSpy } as unknown as SupabaseClient<Database>;
  return { supabase, fromSpy, callsByTable };
}

/** A client whose every `.from()` call throws synchronously (catch-block tests). */
export function throwingSupabase(message = "boom") {
  const fromSpy = vi.fn(() => {
    throw new Error(message);
  });
  return {
    supabase: { from: fromSpy } as unknown as SupabaseClient<Database>,
    fromSpy,
  };
}
