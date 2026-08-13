/**
 * Minimal Mailpit client for Playwright E2E specs.
 *
 * The local Supabase stack ships a Mailpit mail catcher (the container is still
 * named `supabase_inbucket_*` for historical reasons) whose HTTP API is on
 * port 54324. Portal — and staff — sign-in is OTP/magic-link only, so the only
 * way to drive a real login in a browser is to read the emitted code back out
 * of that mailbox.
 *
 * Deliberately dependency-free: `fetch` plus two small regexes. Nothing here
 * warrants an npm package.
 *
 * The code lives in `supabase/templates/magic-link.html`, which
 * `supabase/config.toml` wires into the local GoTrue as the magic-link
 * template — the stock template has no code in it at all.
 */

/** Mailpit's HTTP API root. Override for a stack on a non-default port. */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Digits in a sign-in code — `otp_length` in supabase/config.toml. */
const CODE_LENGTH = 8;

type MailpitSearchResponse = {
  messages: Array<{ ID: string }>;
};

type MailpitMessage = {
  HTML?: string;
  Text?: string;
};

async function mailpit<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`, init);
  if (!response.ok) {
    throw new Error(
      `Mailpit ${init?.method ?? "GET"} ${path} failed: ${response.status} ${response.statusText}. ` +
        "Is the local Supabase stack running (`supabase start`)?",
    );
  }
  return (await response.json()) as T;
}

/**
 * Empties the mailbox so a subsequent read cannot pick up a previous run's
 * code. Local mail catcher only — there is nothing here worth keeping.
 */
export async function clearMailbox(): Promise<void> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(
      `Mailpit DELETE /api/v1/messages failed: ${response.status} ${response.statusText}. ` +
        "Is the local Supabase stack running (`supabase start`)?",
    );
  }
}

/**
 * Extracts the sign-in code from a magic-link email body.
 *
 * Tags are stripped before matching so the only digits left are the visible
 * ones — the `token_hash` in the button's href is inside an attribute and can
 * otherwise contain a run of digits that looks exactly like a code.
 */
function extractCode(body: string): string | null {
  const visibleText = body.replace(/<[^>]*>/g, " ");
  return new RegExp(`\\b\\d{${CODE_LENGTH}}\\b`).exec(visibleText)?.[0] ?? null;
}

/**
 * Polls Mailpit for the newest sign-in email addressed to `recipient` and
 * returns its code. Throws with the elapsed budget rather than hanging, so a
 * misconfigured mailer fails as a readable error instead of a Playwright
 * timeout with no cause attached.
 */
export async function waitForLoginCode(
  recipient: string,
  { timeoutMs = 20_000, pollMs = 500 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:${recipient}`);

  while (Date.now() < deadline) {
    // Mailpit returns search results newest-first.
    const { messages } = await mailpit<MailpitSearchResponse>(
      `/api/v1/search?query=${query}&limit=1`,
    );
    const id = messages[0]?.ID;
    if (id) {
      const message = await mailpit<MailpitMessage>(`/api/v1/message/${id}`);
      const code = extractCode(`${message.HTML ?? ""}\n${message.Text ?? ""}`);
      if (code) return code;
      throw new Error(
        `Mailpit delivered an email to ${recipient} with no ${CODE_LENGTH}-digit code in it. ` +
          "Check [auth.email] otp_length and the magic_link template in supabase/config.toml.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(
    `No sign-in email for ${recipient} arrived in Mailpit within ${timeoutMs}ms (${MAILPIT_URL}).`,
  );
}
