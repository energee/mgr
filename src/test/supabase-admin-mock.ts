/**
 * Shared in-memory Supabase ADMIN-client fake for route-handler and
 * server-component tests (originally built for the Square integration suites).
 *
 * Sibling of `supabase-mock.ts`, deliberately a DIFFERENT contract — pick by
 * what the module under test needs:
 *
 *   supabase-mock.ts   one QUEUED response per `.from(table)` call, throws when
 *                      the queue runs dry. Records chain-method calls per table.
 *                      Good for read paths where each query is distinct.
 *
 *   this file          one response per TABLE, reused for every `.from()` of it,
 *                      defaulting to `{ data: [], error: null }`. Records every
 *                      WRITE (insert/upsert/update/delete) and every `.rpc()` in
 *                      call order. Good for route handlers, which write as much
 *                      as they read and hit the same table repeatedly.
 *
 * A table's response may be a plain `{ data, error }` or a function of the chain
 * calls made on that particular builder. The function form is what keeps the
 * mock faithful instead of a pass-through:
 *
 *   // honor a filter, so channel parameterization is genuinely exercised
 *   pricing_tier_prices: ({ calls }) => {
 *     const chans = calls.find((c) => c.method === "in" && c.args[0] === "sales_channel_id");
 *     return { data: rows.filter((r) => !chans || chans.args[1].includes(r.sales_channel_id)), error: null };
 *   }
 *
 *   // simulate UNIQUE(square_payment_id): the first upsert claims, the retry dups
 *   const claims = [CLAIM_OK, CLAIM_DUP];
 *   square_sync_log: ({ ops }) => (ops.includes("upsert") ? claims.shift()! : CLAIM_OK)
 *
 * Responses resolve lazily, at await time, so a response function sees the whole
 * chain (`calls`) and every write op (`ops`) recorded on its builder.
 *
 * `onUnknownTable: "throw"` makes an unconfigured table fail loudly rather than
 * resolve empty — use it where a silently-empty result would let a newly-added
 * query pass vacuously.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

export type QueryResult = { data: unknown; error: unknown };

export type WriteOp = "insert" | "upsert" | "update" | "delete";

/** One recorded write. For `op: "delete"`, `row` is the filter value removed by. */
export type Write = { table: string; op: WriteOp; row: unknown; options?: unknown };

export type ChainCall = { method: string; args: unknown[] };

/** What a response function sees: the chain built on its own builder. */
export type ResponseContext = { table: string; calls: ChainCall[]; ops: WriteOp[] };

export type TableResponse = QueryResult | ((ctx: ResponseContext) => QueryResult);

export type TableData = Record<string, TableResponse>;

export type AdminMockOptions = {
  /** Result of every `.rpc()`, or a function of (fn, args). */
  rpc?: QueryResult | ((fn: string, args: unknown) => QueryResult);
  /** Unconfigured table: resolve `{ data: [], error: null }` (default) or throw. */
  onUnknownTable?: "empty" | "throw";
};

const EMPTY: QueryResult = { data: [], error: null };

/** Pass-through filter/modifier methods. Every one returns the builder. */
const FILTER_METHODS = ["select", "eq", "ilike", "in", "gt", "lt", "is", "not", "order", "limit"] as const;

/**
 * Builds a fake admin client from table-keyed responses.
 *
 * Returns the client plus `writes` and `rpcCalls` — both in call order, both
 * live arrays shared across every `.from()`. Mock `createAdminClient` with
 * `mockResolvedValue(admin)` rather than `mockImplementation`, so repeated
 * handler invocations share one recorder.
 */
export function makeAdminMock(tables: TableData = {}, options: AdminMockOptions = {}) {
  const writes: Write[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];

  function from(table: string) {
    if (!(table in tables) && options.onUnknownTable === "throw") {
      throw new Error(`unexpected table in admin mock: ${table}`);
    }

    const calls: ChainCall[] = [];
    const ops: WriteOp[] = [];
    // The in-flight delete, so `.delete().eq("id", x)` records what it removed.
    let pendingDelete: Write | undefined;

    const resolve = (): QueryResult => {
      const response = tables[table] ?? EMPTY;
      return typeof response === "function" ? response({ table, calls, ops }) : response;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};

    for (const method of FILTER_METHODS) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        // `.delete().eq(col, val)` / `.delete().in(col, vals)` — capture the value.
        if (pendingDelete && (method === "eq" || method === "in")) {
          pendingDelete.row = args[1];
        }
        return builder;
      };
    }

    for (const op of ["insert", "upsert", "update"] as const) {
      builder[op] = (row: unknown, opts?: unknown) => {
        ops.push(op);
        writes.push({ table, op, row, options: opts });
        return builder;
      };
    }

    builder.delete = () => {
      ops.push("delete");
      pendingDelete = { table, op: "delete", row: undefined };
      writes.push(pendingDelete);
      return builder;
    };

    builder.single = () => Promise.resolve(resolve());
    builder.maybeSingle = () => Promise.resolve(resolve());
    builder.then = (onF?: (v: QueryResult) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR);

    return builder;
  }

  const rpc = (fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    const response = options.rpc ?? EMPTY;
    return Promise.resolve(typeof response === "function" ? response(fn, args) : response);
  };

  const admin = { from, rpc } as unknown as SupabaseClient<Database>;
  return { admin, writes, rpcCalls };
}

/**
 * Emulates Postgres ILIKE matching for a PostgREST `.ilike()` pattern, so a
 * table-response function can honor the filter with REAL semantics instead of
 * recording-only pass-through (a revert from `.ilike` to `.eq`, or dropped
 * pattern escaping, then fails the test rather than just changing call logs).
 *
 * Mirrors the server pipeline: PostgREST first translates `*` to `%` (it has
 * no escape syntax for `*`), then SQL ILIKE interprets `%`/`_` wildcards with
 * backslash as the escape character. Case-insensitive, whole-value anchored.
 */
export function ilikePatternToRegex(pattern: string): RegExp {
  const escapeRegExp = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const translated = pattern.replace(/\*/g, "%");
  let source = "";
  for (let i = 0; i < translated.length; i++) {
    const ch = translated[i];
    if (ch === "\\" && i + 1 < translated.length) {
      source += escapeRegExp(translated[++i]); // escaped literal
    } else if (ch === "%") {
      source += ".*";
    } else if (ch === "_") {
      source += ".";
    } else {
      source += escapeRegExp(ch);
    }
  }
  return new RegExp(`^${source}$`, "i");
}
