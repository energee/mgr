/**
 * Short random identifiers for client-side collection keys (filter rows,
 * attachment entries) — not for anything persisted or security-sensitive.
 *
 * Uses `crypto.getRandomValues` directly; rejection sampling keeps the base62
 * alphabet uniform (a plain `% 62` over 0..255 would favour the first 8
 * characters).
 */

const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Largest multiple of the alphabet size that fits in a byte. */
const UNBIASED_LIMIT = 256 - (256 % ID_ALPHABET.length);

type GenerateIdOptions = {
  length?: number;
};

export function generateId({ length = 12 }: GenerateIdOptions = {}): string {
  let out = "";
  const buf = new Uint8Array(length);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= UNBIASED_LIMIT) continue;
      out += ID_ALPHABET[byte % ID_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}
