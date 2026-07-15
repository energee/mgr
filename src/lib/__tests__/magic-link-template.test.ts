/**
 * Reference-template regression coverage for hosted Supabase magic-link mail.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const template = readFileSync(
  join(process.cwd(), "supabase/templates/magic-link.html"),
  "utf8",
);
const subject = readFileSync(
  join(process.cwd(), "supabase/templates/magic-link-subject.txt"),
  "utf8",
).trim();

describe("Supabase magic-link email template", () => {
  it("uses the SSR token-hash confirmation endpoint", () => {
    expect(template).toContain("/api/auth/confirm?token_hash={{ .TokenHash }}");
    expect(template).toContain("redirect_to={{ .RedirectTo }}");
    expect(template).not.toContain('href="{{ .ConfirmationURL }}"');
  });

  it("explains portal access using the configured brewery name", () => {
    expect(template).toContain("{{ .Data.brewery_name }}");
    expect(template).toContain("customer portal");
    expect(template).toContain("View and manage orders");
    expect(subject).toContain("{{ .Data.brewery_name }}");
    expect(subject).toContain("customer portal");
  });
});
