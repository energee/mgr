/**
 * Dev-login reachability — the single source of truth for "which database is
 * this server wired to", shared by the route gate and the login page's button.
 *
 * `/api/auth/dev-login` mints a full admin session with no caller credentials,
 * so its gate is a security surface (see that route's docstring for the full
 * rule). The login form's "Dev Login" button is not a security surface — it is
 * an affordance — but the two MUST NOT disagree about whether the route will
 * answer, or the button becomes a link to a raw `{"error":"Not found"}` page
 * whose only explanation is a line in the server terminal. That drift is
 * exactly what happened when #679's gate was tightened and the button was left
 * on `NODE_ENV === "development"` alone, so the shared half lives here and both
 * consumers import it. A contract test in the route suite drives the two
 * against the same matrix and fails if they diverge.
 *
 * Everything here is client-safe: no `@/lib/logger` (pino + Sentry), no
 * server-only env. `getSupabaseUrl()` resolves `clientEnv`, which is the same
 * value `createBrowserClient()` uses in the browser and `createAdminClient()`
 * uses on the server.
 */

import { getSupabaseUrl } from "@/lib/env";

/**
 * Hostnames that can only be reached on the machine serving the request.
 * Mirrors the local target list in `playwright.config.ts`. `new URL()` reports
 * an IPv6 host in brackets, and `[::1]` is the only form it can ever yield —
 * every bare spelling of `::1` throws — so no bare variant is listed.
 * `host.docker.internal` is deliberately absent: nothing in this repo's CI uses
 * it, and it resolves to the Docker host, which is a different machine.
 */
export const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Name of the opt-in that lets the dev-server path run against a non-loopback
 * project, and the single value that counts. Anything else — unset, `"true"`,
 * `"0"`, `" 1"` — denies, matching how `E2E_DEV_LOGIN` is compared.
 *
 * Server-only on purpose (no `NEXT_PUBLIC_` prefix): a browser can never read
 * whether it is set, which is why `devLoginAffordance()` below reports
 * `"needs-opt-in"` rather than pretending to know.
 */
export const ALLOW_REMOTE_DB_VAR = "DEV_LOGIN_ALLOW_REMOTE_DB";
export const ALLOW_REMOTE_DB_VALUE = "1";

/**
 * Where the Supabase project this app's clients are built from lives, as far as
 * we can tell:
 *
 *   - `loopback` — reachable only on the machine serving the request;
 *   - `remote`   — anywhere else, including a hosted `*.supabase.co` project;
 *   - `unknown`  — no URL, or one that does not yield a hostname. Denies
 *                  everything; an unreadable target is not evidence about the
 *                  database behind it, and no opt-in overrides it.
 */
export type SupabaseTarget = "loopback" | "remote" | "unknown";

/**
 * Classify the database `/api/auth/dev-login` would touch.
 *
 * Resolved through `getSupabaseUrl()` on purpose — see the build-time inlining
 * note in the route's docstring. The point is not convenience: it is that the
 * gate and `createAdminClient()` read one value, so they cannot disagree about
 * the target database.
 *
 * Compares the parsed HOSTNAME, never a substring:
 * `https://localhost.evil.example.com` is a remote host that merely starts with
 * the word, and `https://localhost@evil.example.com` puts it in the userinfo.
 * Both must read as `remote`.
 *
 * An EMPTY hostname is `unknown`, not `remote`. `new URL()` accepts plenty of
 * strings that name no host at all — `localhost:54321` (a scheme-less typo, and
 * the one a developer actually makes: it parses as scheme `localhost:` with
 * path `54321`), `file:///x`, `mailto:a@b` — and every one of them yields
 * `hostname === ""`. Classifying those as `remote` would let
 * `DEV_LOGIN_ALLOW_REMOTE_DB=1` admit a target the gate never identified, which
 * is the opposite of what the opt-in means. (The first cut of this classifier
 * did exactly that; the suite now pins each of those inputs.)
 *
 * The annotation on `url` is deliberate: `getSupabaseUrl()` is typed `string`,
 * but under `SKIP_ENV_VALIDATION` it is an unvalidated `process.env` read and
 * can be undefined at runtime.
 */
export function classifySupabaseTarget(): SupabaseTarget {
  const url: string | undefined = getSupabaseUrl();
  if (!url) return "unknown";
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return "unknown";
  }
  if (!hostname) return "unknown";
  return LOOPBACK_HOSTNAMES.has(hostname) ? "loopback" : "remote";
}

/**
 * What the login page should render for the dev-login button:
 *
 *   - `hidden`       — the route cannot answer, whatever the server's env says.
 *                      Either this is not a dev server, or the target database
 *                      is `unknown`, which no opt-in overrides.
 *   - `ready`        — loopback: the route answers with nothing to configure.
 *                      The unchanged, common case (`make db-local`).
 *   - `needs-opt-in` — a non-loopback project. The route answers only if the
 *                      SERVER has `DEV_LOGIN_ALLOW_REMOTE_DB=1`, and a browser
 *                      cannot see that (the variable has no `NEXT_PUBLIC_`
 *                      prefix, by design). So the button is still offered — the
 *                      opted-in workflow is legitimate and must keep working —
 *                      and the page states the precondition next to it, so a
 *                      404 is explained before it happens rather than only in
 *                      the server terminal.
 *
 * `process.env.NODE_ENV` is constant-folded to `"production"` in a client
 * production bundle, so this collapses to `"hidden"` there and the button and
 * its caveat are compiled out entirely.
 */
export type DevLoginAffordance = "hidden" | "ready" | "needs-opt-in";

export function devLoginAffordance(): DevLoginAffordance {
  if (process.env.NODE_ENV !== "development") return "hidden";
  switch (classifySupabaseTarget()) {
    case "loopback":
      return "ready";
    case "remote":
      return "needs-opt-in";
    case "unknown":
      return "hidden";
  }
}
