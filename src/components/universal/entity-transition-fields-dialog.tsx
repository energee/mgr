"use client";

/**
 * EntityTransitionFieldsDialog — small pre-transition dialog for entity
 * actions declared with `transitionFields` (EntityActionDef.transitionFields).
 *
 * Collects the listed field values (e.g. orders.schedule → scheduled_date,
 * pick_lists.assign → assigned_to) and hands them to the caller, which merges
 * them into the same UPDATE payload as the status flip — so a transition
 * never lands without the data that gives it meaning.
 *
 * Rendered by every transition surface:
 * - entity-detail-unified.tsx (header buttons + Actions dropdown, including
 *   raw "Move to {state}" items whose target matches a transition-fields
 *   action)
 * - entity-data-table.tsx (desktop row menu, mobile card menu, and kanban
 *   drag via requestTransition)
 *
 * Mirrors the callback-to-dialog plumbing of EntityActionConfirmDialog: the
 * caller owns open state and runs the transition only on submit. Callers
 * conditionally render this component per pending action (`{target && ...}`)
 * so defaults are computed on a fresh mount each time it opens.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDynamicOptions } from "@/hooks/use-dynamic-options";
import type { TransitionFieldDef } from "@/types/entity";

export type EntityTransitionFieldsDialogProps<T> = {
  /** Display label of the transition action (e.g. "Schedule Delivery") */
  actionLabel: string;
  /** Title of the record the action applies to (e.g. order number) */
  recordTitle: string;
  /** Fields to collect (EntityActionDef.transitionFields) */
  fields: TransitionFieldDef<T>[];
  /** Record being transitioned — source for per-field defaultValue */
  record: T;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Run the transition with the collected values merged into the UPDATE */
  onSubmit: (values: Record<string, unknown>) => void;
};

/** Normalize a collected value for the UPDATE payload: empty string → null
 *  so clearing an optional field writes NULL instead of "". */
function normalizeValue(value: unknown): unknown {
  return value === "" ? null : value;
}

export function EntityTransitionFieldsDialog<T>({
  actionLabel,
  recordTitle,
  fields,
  record,
  open,
  onOpenChange,
  onSubmit,
}: EntityTransitionFieldsDialogProps<T>) {
  // Initial values from each field's defaultValue(record). Lazy init is safe
  // because callers mount this component fresh per pending action.
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      initial[field.name] = field.defaultValue?.(record) ?? "";
    }
    return initial;
  });

  // Options for relation/dynamicOptions fields (same hook the unified
  // detail/edit form uses, so option sourcing can't diverge)
  const { optionsMap } = useDynamicOptions(fields);

  const missingRequired = useMemo(
    () =>
      fields.some(
        (f) =>
          f.required &&
          (values[f.name] === "" ||
            values[f.name] === null ||
            values[f.name] === undefined)
      ),
    [fields, values]
  );

  const setValue = (name: string, value: unknown) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = () => {
    if (missingRequired) return;
    const collected: Record<string, unknown> = {};
    for (const field of fields) {
      collected[field.name] = normalizeValue(values[field.name]);
    }
    onSubmit(collected);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{actionLabel}</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{recordTitle}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {fields.map((field) => {
            const value = values[field.name];
            const inputId = `transition-field-${field.name}`;
            const options =
              field.options ?? optionsMap[field.name] ?? [];

            return (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={inputId}>
                  {field.label}
                  {field.required && (
                    <span className="text-destructive"> *</span>
                  )}
                </Label>
                {field.type === "select" ||
                field.type === "relation" ||
                field.dynamicOptions ? (
                  <Select
                    value={(value as string) || undefined}
                    onValueChange={(v) => setValue(field.name, v)}
                  >
                    <SelectTrigger id={inputId} className="w-full">
                      <SelectValue placeholder={`Select ${field.label.toLowerCase()}...`} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={inputId}
                    type={field.type === "date" ? "date" : "text"}
                    value={(value as string) ?? ""}
                    onChange={(e) => setValue(field.name, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={missingRequired}>
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
