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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _zodResolver(schema as any) as any;
}
