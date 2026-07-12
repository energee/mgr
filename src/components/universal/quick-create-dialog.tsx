/**
 * QuickCreateDialog — generic inline "+" create for master-data relation fields.
 *
 * Renders a small "+" button beside a relation combobox that opens a dialog
 * for creating the related record without leaving the half-filled host form.
 * The dialog is driven entirely by the related entity's registry config:
 * it renders the config's required section fields via FieldInput, validates
 * with `config.formSchema`, inserts into `config.table`, invalidates the
 * entity + dynamic-options caches, and calls `onCreated(id)` so the host
 * field auto-selects the new record.
 *
 * Attachment is config-free: field-input.tsx auto-renders QuickCreateButton
 * for any relation field whose target entity is in QUICK_CREATE_ENTITIES
 * (master data only — transactional entities like batch/order are excluded
 * on purpose). An explicit `field.quickCreate` component still wins.
 *
 * The entity registry is resolved via dynamic import (same pattern as
 * use-dynamic-options.ts) to avoid module cycles with entity config files.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { dynamicFrom } from "@/services/types";
import { entityKeys, dynamicOptionsKeys } from "@/lib/query-keys";
import { useDynamicOptions } from "@/hooks/use-dynamic-options";
import { log } from "@/lib/client-logger";
import {
  type EntityConfig,
  type StateMachineConfig,
  type UnifiedFieldDef,
  type UnifiedSectionDef,
  clampCreateStateField,
  createModeStateOptions,
} from "@/types/entity";
import { FieldInput } from "./field-input";

type AnyRecord = Record<string, unknown>;

// =============================================================================
// Master-data allowlist
// =============================================================================

/**
 * Entities eligible for inline quick-create from relation fields.
 * Master data only: quick-creating transactional targets (batch, order,
 * purchase_order, po_receive, finished_good, delivery, pick_list...) from a
 * dropdown is wrong domain-wise — those have their own lifecycles/editors.
 * Names must match entity registry keys; unregistered relation names
 * (e.g. yeast-pitch's "yeast") are simply not in this set.
 */
export const QUICK_CREATE_ENTITIES: ReadonlySet<string> = new Set([
  "customer",
  "supplier",
  "inventory_item",
  "location",
  "brand",
  "beer_style",
  "sales_channel",
  "pricing_tier",
  "container",
  "selling_format",
  "keg_owner",
  "bin",
  "vessel",
  "yeast_strain",
  "water_profile",
]);

/** Whether a relation target entity supports the generic quick-create path. */
export function isQuickCreateEntity(
  entity: string | undefined
): entity is string {
  return !!entity && QUICK_CREATE_ENTITIES.has(entity);
}

// =============================================================================
// Field selection + defaults (pure helpers, exported for tests)
// =============================================================================

/** All create-editable fields across an entity's unified sections. */
export function getEditableFields(
  sections: UnifiedSectionDef<AnyRecord>[] | undefined
): UnifiedFieldDef<AnyRecord>[] {
  if (!sections) return [];
  return sections
    .filter((s) => !s.hideOnCreate)
    .flatMap((s) => s.fields ?? [])
    .filter((f) => !!f.type && f.editable !== false);
}

/**
 * The minimal field set rendered in the quick-create dialog: the config's
 * required editable fields. Falls back to the "name" field (or the first
 * editable field) for configs without any `required: true` field, so the
 * dialog never renders an empty form.
 */
export function getQuickCreateFields(
  sections: UnifiedSectionDef<AnyRecord>[] | undefined
): UnifiedFieldDef<AnyRecord>[] {
  const editable = getEditableFields(sections);
  const required = editable.filter((f) => f.required);
  if (required.length > 0) return required;
  const nameField = editable.find((f) => f.name === "name");
  if (nameField) return [nameField];
  return editable.slice(0, 1);
}

/**
 * Initial form values for every create-editable field (not just the rendered
 * subset) so config `defaultValue`s like `is_active: true` are submitted.
 * Mirrors buildDefaultValues in entity-detail-unified.tsx — including the
 * state-field rule: a stateful entity's state field (e.g. vessel status) is
 * seeded with the machine's initial state instead of "" so quick-created
 * records enter their lifecycle at the start (audit EA-1; also what lets a
 * non-nullable enum status like vessel's parse without the field rendered).
 */
export function buildQuickCreateDefaults(
  sections: UnifiedSectionDef<AnyRecord>[] | undefined,
  stateMachine?: StateMachineConfig<AnyRecord>
): AnyRecord {
  const initial: AnyRecord = {};
  for (const field of getEditableFields(sections)) {
    if (field.defaultValue !== undefined) {
      initial[field.name] =
        typeof field.defaultValue === "function"
          ? (field.defaultValue as () => unknown)()
          : field.defaultValue;
    } else {
      switch (field.type) {
        case "switch":
        case "checkbox":
          initial[field.name] = false;
          break;
        case "number":
        case "unit":
        case "relation":
          initial[field.name] = null;
          break;
        default:
          initial[field.name] = "";
      }
    }
  }
  clampCreateStateField(stateMachine, initial);
  return initial;
}

// =============================================================================
// QuickCreateButton — "+" trigger + dialog shell
// =============================================================================

export function QuickCreateButton({
  entityName,
  onCreated,
}: {
  /** Entity registry key of the record type to create (e.g. "customer"). */
  entityName: string;
  /** Called with the new record's id so the host field can select it. */
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<EntityConfig<AnyRecord> | null>(null);

  // Resolve the registry lazily (mirrors use-dynamic-options.ts) to avoid
  // circular module dependencies between entity configs and field components.
  useEffect(() => {
    if (!open || config) return;
    let cancelled = false;
    import("@/entities").then(({ entityRegistry }) => {
      if (cancelled) return;
      const resolved = entityRegistry.get(entityName);
      if (resolved) {
        setConfig(resolved);
      } else {
        log.warn(`QuickCreateButton: entity "${entityName}" is not registered`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, config, entityName]);

  const readableName = entityName.replace(/_/g, " ");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          aria-label={`Create new ${readableName}`}
        >
          <Plus className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New {config?.displayName ?? readableName}</DialogTitle>
          <DialogDescription>
            Create a new {config?.displayName.toLowerCase() ?? readableName}{" "}
            without leaving this form.
          </DialogDescription>
        </DialogHeader>
        {config && (
          <QuickCreateForm
            config={config}
            onCreated={(id) => {
              onCreated(id);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// QuickCreateForm — config-driven minimal create form
// =============================================================================

function QuickCreateForm({
  config,
  onCreated,
  onCancel,
}: {
  config: EntityConfig<AnyRecord>;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();

  const editableFields = useMemo(
    () => getEditableFields(config.sections),
    [config]
  );
  const quickFields = useMemo(
    () => getQuickCreateFields(config.sections),
    [config]
  );

  const [values, setValues] = useState<AnyRecord>(() =>
    buildQuickCreateDefaults(config.sections, config.stateMachine)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Options for nested select/relation fields (e.g. bin_type, container_id)
  const { optionsMap } = useDynamicOptions(quickFields);

  const visibleFields = quickFields.filter(
    (f) => !f.showWhen || f.showWhen(values)
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The dialog is portaled, but stop propagation defensively so submit
    // events can never bubble into the host page's form tree.
    e.stopPropagation();

    // Pre-process: empty strings -> null for optional fields (mirrors the
    // create path in entity-detail-unified.tsx).
    const candidate: AnyRecord = { ...values };
    for (const field of editableFields) {
      if (candidate[field.name] === "" && !field.required) {
        candidate[field.name] = null;
      }
    }

    // Quick-create is always create mode: the state field (if any) can only
    // hold the machine's initial state (audit EA-1; mirrors the create path
    // in entity-detail-unified.tsx).
    clampCreateStateField(config.stateMachine, candidate);

    const result = config.formSchema.safeParse(candidate);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      const hiddenErrors: string[] = [];
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        if (quickFields.some((f) => f.name === path)) {
          fieldErrors[path] = issue.message;
        } else {
          hiddenErrors.push(`${path}: ${issue.message}`);
        }
      }
      setErrors(fieldErrors);
      if (hiddenErrors.length > 0) {
        // Schema demands fields the quick form doesn't render — surface
        // instead of failing silently.
        toast.error(`Cannot quick-create: ${hiddenErrors.join("; ")}`);
      }
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const { data, error } = await dynamicFrom(supabase, config.table)
        .insert(result.data as AnyRecord)
        .select("id")
        .single();
      if (error) throw error;

      // Refresh entity lists AND the relation/dynamic option caches so the
      // host combobox can resolve the new record's label immediately.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: entityKeys.all(config.table) }),
        queryClient.invalidateQueries({ queryKey: dynamicOptionsKeys.all() }),
      ]);

      toast.success(`${config.displayName} created`);
      onCreated((data as { id: string }).id);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : `Failed to create ${config.displayName.toLowerCase()}`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid grid-cols-12 gap-3">
        {visibleFields.map((field) => (
          <FieldInput
            key={field.name}
            // Strip any explicit quickCreate component on nested fields.
            // State fields only offer the machine's initial state — a
            // quick-create is always create mode (audit EA-1; mirrors
            // UnifiedField's create-mode clamp).
            field={{
              ...field,
              quickCreate: undefined,
              ...(config.stateMachine &&
              field.name === config.stateMachine.stateField
                ? {
                    options: createModeStateOptions(
                      config.stateMachine,
                      field.options
                    ),
                  }
                : null),
            }}
            value={values[field.name]}
            error={errors[field.name]}
            onChange={(v) => {
              setValues((prev) => ({ ...prev, [field.name]: v }));
              setErrors((prev) => {
                if (!(field.name in prev)) return prev;
                const next = { ...prev };
                delete next[field.name];
                return next;
              });
            }}
            dynamicOptions={optionsMap[field.name]}
            // No nested "+" buttons — one level of quick-create only
            disableQuickCreate
          />
        ))}
      </div>

      <DialogFooter className="mt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
