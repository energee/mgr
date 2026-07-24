/**
 * Typed zodResolver wrapper for Zod v4 compatibility.
 *
 * Zod v4's `z.coerce` changes input types to `unknown`, which breaks
 * type inference with @hookform/resolvers. This wrapper applies a
 * type-level cast so callers don't need `as any` everywhere.
 *
 * @see https://github.com/react-hook-form/resolvers/issues/799
 */
import { zodResolver as _zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import type { ZodSchema } from "zod";

export function zodResolver<T extends FieldValues>(
  schema: ZodSchema,
): Resolver<T> {
  // Zod v4's z.coerce widens input types to `unknown`, breaking zodResolver's
  // generic inference. These casts bridge the Zod v4 ↔ react-hook-form gap.
  // See: https://github.com/react-hook-form/resolvers/issues/799
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod v4 compatibility workaround
  return _zodResolver(schema as any) as Resolver<T>;
}

/**
 * zodResolver that maps `""` → `null` on non-required fields before
 * validation (issue #558): the unified form initializes untouched optional
 * selects to `""`, which optional `.uuid()` schema fields reject as
 * "Invalid UUID" — blocking submit even though the save path would have
 * nulled them. Normalizing inside the resolver keeps `form.trigger()` and
 * the save-time `""→null` pass in agreement.
 *
 * `fields` only needs `name`/`required` from the entity's editable field
 * defs; fields not listed (or marked required) pass through untouched.
 */
export function makeFormResolver<T extends FieldValues>(
  schema: ZodSchema,
  fields: ReadonlyArray<{ name: string; required?: boolean }>,
): Resolver<T> {
  const base = zodResolver<T>(schema);
  const optionalNames = fields.filter((f) => !f.required).map((f) => f.name);
  return (values, context, options) => {
    const normalized = { ...values };
    for (const name of optionalNames) {
      if (normalized[name] === "") {
        (normalized as Record<string, unknown>)[name] = null;
      }
    }
    return base(normalized, context, options);
  };
}
