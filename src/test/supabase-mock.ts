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

// Only the methods current consumers chain. Add new ones as services need
// them (a missing method fails loudly with a TypeError). Deliberately NOT
// listing .throwOnError(): the real one changes await semantics to throw,
// which a plain chain no-op would silently misrepresent.
const CHAIN_METHODS = [
  "select",
  "eq",
  "in",
  "gt",
  "single",
  "limit",
  "order",
  "insert",
  "update",
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
 *
 * `rpcResponses` is keyed by function name and behaves the same way: each
 * `.rpc(name, args)` shifts that function's next queued response. Assert the
 * arguments a function was called with via `rpcSpy.mock.calls`. Calling an
 * unqueued function throws, so an unexpected RPC fails loudly.
 */
export function makeSupabase(
  responses: Record<string, QueuedResponse[]>,
  rpcResponses: Record<string, QueuedResponse[]> = {},
) {
  const queues: Record<string, QueuedResponse[]> = {};
  for (const [table, list] of Object.entries(responses)) {
    queues[table] = [...list];
  }
  const rpcQueues: Record<string, QueuedResponse[]> = {};
  for (const [fn, list] of Object.entries(rpcResponses)) {
    rpcQueues[fn] = [...list];
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

  const rpcSpy = vi.fn((fn: string, _args?: unknown) => {
    const queue = rpcQueues[fn];
    if (!queue || queue.length === 0) {
      throw new Error(`fake supabase: no queued response for rpc "${fn}"`);
    }
    return makeQueryBuilder(queue.shift() as QueuedResponse);
  });

  const supabase = { from: fromSpy, rpc: rpcSpy } as unknown as SupabaseClient<Database>;
  return { supabase, fromSpy, rpcSpy, callsByTable };
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
