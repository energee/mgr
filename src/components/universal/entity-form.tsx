"use client";

/**
 * EntityForm - Universal Form Component
 *
 * Renders a create/edit form for any entity based on its configuration.
 * Handles: validation via Zod, field rendering, submit, conditional fields.
 * Supports dynamicOptions for select fields that fetch from database tables.
 */

import { useState, useMemo, useRef, useEffect, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useSubmitShortcut } from "@/hooks/use-submit-shortcut";
import { entityKeys, dynamicOptionsKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import type { EntityConfig, EntityFieldDef } from "@/types/entity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { DatePicker, DateTimePicker } from "@/components/ui/date-picker";
import { UnitInput } from "@/components/ui/unit-input";
import { ConflictDialog, useConflictDialog } from "@/components/ui/conflict-dialog";
import { updateWithOptimisticLock } from "@/lib/optimistic-lock";
import { toast } from "sonner";
import { ArrowLeft, Loader2, X } from "lucide-react";

// Hook to fetch dynamic options for fields (handles both dynamicOptions and relation types)
function useDynamicOptions<T>(fields: EntityFieldDef<T>[]) {
  const supabase = createClient();

  // Get all fields that have dynamicOptions
  const dynamicFields = fields.filter((f) => f.dynamicOptions);

  // Get all relation fields (type: "relation" with field.relation config)
  const relationFields = fields.filter((f) => f.type === "relation" && f.relation);

  // Create queries for each dynamic field
  const dynamicQueries = useQueries({
    queries: dynamicFields.map((field) => ({
      queryKey: dynamicOptionsKeys.field(field.dynamicOptions!.table, field.name as string),
      queryFn: async () => {
        const { table, valueField, labelField, filter, orderBy } = field.dynamicOptions!;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query = supabase.from(table as any).select(`${valueField}, ${labelField}`);

        // Apply filters
        if (filter) {
          Object.entries(filter).forEach(([key, val]) => {
            query = query.eq(key, val);
          });
        }

        // Apply ordering
        if (orderBy) {
          query = query.order(orderBy);
        }

        const { data, error } = await query;
        if (error) throw error;

        const rows = data as unknown as Record<string, unknown>[] | null;
        return {
          fieldName: field.name,
          options: (rows || []).map((row) => ({
            value: String(row[valueField]),
            label: String(row[labelField]),
          })),
        };
      },
      staleTime: CACHE_DURATIONS.STATIC_DATA,
    })),
  });

  // Create queries for relation fields
  // Import entityRegistry lazily to avoid circular dependency issues at module load time
  const relationQueries = useQueries({
    queries: relationFields.map((field) => {
      const relation = field.relation!;

      return {
        queryKey: dynamicOptionsKeys.field(relation.entity, field.name as string),
        queryFn: async () => {
          // Dynamically import to avoid circular dependency
          const { entityRegistry } = await import("@/entities");
          const relatedEntity = entityRegistry.get(relation.entity);
          const tableName = relatedEntity?.table || `${relation.entity}s`;

          const { data, error } = await supabase
            // @ts-expect-error -- dynamic table name from entity registry
            .from(tableName)
            .select(`id, ${relation.displayField}`)
            .order(relation.displayField);

          if (error) {
            console.error(`Failed to fetch options for ${field.name}:`, error);
            return { fieldName: field.name, options: [] };
          }

          const rows = data as unknown as Record<string, unknown>[] | null;
          return {
            fieldName: field.name,
            options: (rows || []).map((row) => ({
              value: String(row.id),
              label: String(row[relation.displayField]),
            })),
          };
        },
        staleTime: CACHE_DURATIONS.STATIC_DATA,
      };
    }),
  });

  const queries = [...dynamicQueries, ...relationQueries];

  // Combine results into a map of fieldName -> options
  const optionsMap: Record<string, { value: string; label: string }[]> = {};
  for (const query of queries) {
    if (query.data) {
      optionsMap[query.data.fieldName as string] = query.data.options;
    }
  }

  return {
    optionsMap,
    isLoading: queries.some((q) => q.isLoading),
  };
}

interface EntityFormProps<T = Record<string, unknown>> {
  /** Entity configuration */
  entity: EntityConfig<T>;
  /** Record ID (undefined for create mode) */
  id?: string;
  /** Base path for navigation */
  basePath?: string;
  /** Custom cancel URL */
  cancelUrl?: string;
  /** Additional default values */
  defaultValues?: Partial<T>;
  /** Callback on successful save */
  onSuccess?: (data: T) => void;
}

export function EntityForm<T = Record<string, unknown>>({
  entity,
  id,
  basePath,
  cancelUrl,
  defaultValues,
  onSuccess,
}: EntityFormProps<T>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = createClient();
  // Cast to any for dynamic table access - universal components work with any entity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const path = basePath || `/${entity.domain}/${entity.name}s`;
  const isEdit = Boolean(id);

  const submitRef = useSubmitShortcut();

  // Conflict dialog for optimistic locking
  const conflictDialog = useConflictDialog();
  // Track the loaded version for optimistic locking
  const loadedVersionRef = useRef<number | null>(null);

  // Form state
  const [values, setValues] = useState<Partial<T>>(() => {
    // Initialize all fields with appropriate empty values to avoid controlled/uncontrolled issues
    const initial: Partial<T> = {};
    entity.formFields.forEach((field) => {
      const rec = initial as Record<string, unknown>;
      if (field.defaultValue !== undefined) {
        // Support function defaults for dynamic values like "now"
        rec[field.name] = typeof field.defaultValue === "function"
          ? field.defaultValue()
          : field.defaultValue;
      } else {
        // Initialize based on field type to avoid undefined -> value transitions
        switch (field.type) {
          case "switch":
          case "checkbox":
            rec[field.name] = false;
            break;
          case "number":
          case "unit":
          case "relation":
            // Nullable fields use null
            rec[field.name] = null;
            break;
          default:
            // Text, select, date, etc. use empty string
            rec[field.name] = "";
        }
      }
    });
    return { ...initial, ...defaultValues };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMac, setIsMac] = useState(true); // Default to Mac, update on mount

  // Detect platform for keyboard shortcut display
  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes("mac"));
  }, []);

  // Fetch existing record for edit mode
  const { data: existingData, isLoading } = useQuery({
    queryKey: entityKeys.detail(entity.table, id || ""),
    staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await db
        .from(entity.table)
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as T;
    },
    enabled: isEdit && !!id,
  });

  // Merge existing data into form values once loaded
  useMemo(() => {
    if (existingData && isEdit) {
      setValues((prev) => ({ ...prev, ...existingData }));
      // Store the loaded version for optimistic locking
      const record = existingData as Record<string, unknown>;
      if (typeof record.version === "number") {
        loadedVersionRef.current = record.version;
      }
    }
  }, [existingData, isEdit]);

  // Fetch dynamic options for select fields
  const { optionsMap: dynamicOptionsMap } = useDynamicOptions(entity.formFields);

  // Get visible fields based on mode
  const visibleFields = useMemo(() => {
    const allowedFields = isEdit ? entity.editFields : entity.createFields;
    return entity.formFields.filter((field) => {
      // Filter by create/edit allowed fields
      if (allowedFields && !allowedFields.includes(field.name)) return false;
      // Check conditional visibility
      if (field.showWhen && !field.showWhen(values as Partial<T>)) return false;
      return true;
    });
  }, [entity.formFields, entity.createFields, entity.editFields, isEdit, values]);

  // Handle field value change
  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    // Clear error when user types
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  // Handle form submission
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Pre-process values: convert empty strings to null for optional/nullable fields
    const processedValues = { ...values };
    entity.formFields.forEach((field) => {
      const key = field.name as string;
      const val = (processedValues as Record<string, unknown>)[key];
      // Convert empty strings to null for non-required fields (likely nullable in DB)
      if (val === "" && !field.required) {
        (processedValues as Record<string, unknown>)[key] = null;
      }
    });

    // Validate with Zod schema
    const result = entity.formSchema.safeParse(processedValues);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        const path = err.path.join(".");
        fieldErrors[path] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit && id) {
        // Check if we have a loaded version (record supports optimistic locking)
        if (loadedVersionRef.current !== null) {
          // Use optimistic locking for versioned records
          const lockResult = await updateWithOptimisticLock(
            supabase,
            entity.table,
            id,
            result.data,
            loadedVersionRef.current
          );

          if (!lockResult.success) {
            if (lockResult.conflicted) {
              // Show conflict dialog instead of error toast
              conflictDialog.showConflict();
              setIsSubmitting(false);
              return;
            }
            throw new Error(lockResult.error);
          }

          toast.success(`${entity.displayName} updated successfully`);
          queryClient.invalidateQueries({ queryKey: entityKeys.detail(entity.table, id) });
          queryClient.invalidateQueries({ queryKey: entityKeys.all(entity.table) });
          onSuccess?.(lockResult.data as T);
          router.push(`${path}/${id}`);
        } else {
          // Standard update for records without version
          const { data, error } = await db
            .from(entity.table)
            .update(result.data)
            .eq("id", id)
            .select()
            .single();
          if (error) throw error;
          toast.success(`${entity.displayName} updated successfully`);
          queryClient.invalidateQueries({ queryKey: entityKeys.detail(entity.table, id) });
          queryClient.invalidateQueries({ queryKey: entityKeys.all(entity.table) });
          onSuccess?.(data as T);
          router.push(`${path}/${id}`);
        }
      } else {
        // Create new record
        const { data, error } = await db
          .from(entity.table)
          .insert(result.data)
          .select()
          .single();
        if (error) throw error;
        toast.success(`${entity.displayName} created successfully`);
        queryClient.invalidateQueries({ queryKey: entityKeys.all(entity.table) });
        onSuccess?.(data as T);
        router.push(`${path}/${(data as Record<string, unknown>).id}`);
      }
    } catch (err) {
      // Extract message from various error formats (Supabase PostgrestError, Error, etc.)
      let message = "An unexpected error occurred";
      if (err && typeof err === "object") {
        if ("message" in err && typeof err.message === "string") {
          message = err.message;
        }
      }
      toast.error(message);
      console.error("Form submission error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle conflict refresh - reload data and reset form
  const handleConflictRefresh = async () => {
    conflictDialog.setIsRefreshing(true);
    try {
      // Refetch the data
      await queryClient.invalidateQueries({ queryKey: entityKeys.detail(entity.table, id || "") });
      const { data } = await db.from(entity.table).select("*").eq("id", id).single();
      if (data) {
        setValues(data);
        const record = data as Record<string, unknown>;
        if (typeof record.version === "number") {
          loadedVersionRef.current = record.version;
        }
        toast.info("Data refreshed. Please re-apply your changes.");
      }
    } catch {
      toast.error("Failed to refresh data");
    } finally {
      conflictDialog.hideConflict();
    }
  };

  // Handle conflict discard - go back to detail page
  const handleConflictDiscard = () => {
    conflictDialog.hideConflict();
    router.push(`${path}/${id}`);
  };

  if (isEdit && isLoading) {
    return <EntityFormSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href={cancelUrl || (isEdit && id ? `${path}/${id}` : path)}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Cancel
            </Link>
          </Button>
        </div>
        <h1 className="text-2xl font-bold">
          {isEdit ? `Edit ${entity.displayName}` : `New ${entity.displayName}`}
        </h1>
        <p className="text-muted-foreground">{entity.description}</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>
              {isEdit ? "Update Details" : `${entity.displayName} Details`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-12 gap-4">
              {visibleFields.map((field) => (
                <FormField
                  key={field.name}
                  field={field}
                  value={values[field.name as keyof T]}
                  error={errors[field.name]}
                  onChange={(value) => handleChange(field.name, value)}
                  disabled={isSubmitting || field.disabled}
                  dynamicOptions={dynamicOptionsMap[field.name]}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4">
          <Button type="button" variant="outline" asChild>
            <Link href={cancelUrl || (isEdit && id ? `${path}/${id}` : path)}>
              Cancel
            </Link>
          </Button>
          <Button ref={submitRef} type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Save Changes" : `Create ${entity.displayName}`}
            <KbdGroup>
              <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>{isMac ? "Return" : "Enter"}</Kbd>
            </KbdGroup>
          </Button>
        </div>
      </form>

      {/* Conflict Dialog for optimistic locking */}
      <ConflictDialog
        open={conflictDialog.isOpen}
        onOpenChange={conflictDialog.setIsOpen}
        onRefresh={handleConflictRefresh}
        onDiscard={handleConflictDiscard}
        isRefreshing={conflictDialog.isRefreshing}
      />
    </div>
  );
}

// Individual form field component
function FormField<T>({
  field,
  value,
  error,
  onChange,
  disabled,
  dynamicOptions,
}: {
  field: EntityFieldDef<T>;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  dynamicOptions?: { value: string; label: string }[];
}) {
  const colSpan = field.colSpan || 6;

  // Map colSpan to responsive Tailwind classes (full width on mobile, colSpan on md+)
  const colSpanClasses: Record<number, string> = {
    3: "col-span-12 md:col-span-3",
    4: "col-span-12 md:col-span-4",
    6: "col-span-12 md:col-span-6",
    8: "col-span-12 md:col-span-8",
    12: "col-span-12",
  };
  const colClass = colSpanClasses[colSpan] || "col-span-12 md:col-span-6";

  return (
    <div className={colClass}>
      <Label htmlFor={field.name} className={field.required ? "required" : ""}>
        {field.label}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </Label>

      <div className="mt-1.5">
        {renderFieldInput(field, value, onChange, disabled, dynamicOptions)}
      </div>

      {field.description && (
        <p className="text-sm text-muted-foreground mt-1">{field.description}</p>
      )}

      {error && <p className="text-sm text-destructive mt-1">{error}</p>}
    </div>
  );
}

// Render appropriate input based on field type
function renderFieldInput<T>(
  field: EntityFieldDef<T>,
  value: unknown,
  onChange: (value: unknown) => void,
  disabled?: boolean,
  dynamicOptions?: { value: string; label: string }[]
) {
  switch (field.type) {
    case "text":
      return (
        <Input
          id={field.name}
          type="text"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
        />
      );

    case "textarea":
      return (
        <Textarea
          id={field.name}
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
        />
      );

    case "number":
      return (
        <Input
          id={field.name}
          type="number"
          value={value !== undefined && value !== null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          placeholder={field.placeholder}
          disabled={disabled}
        />
      );

    case "select": {
      // Use dynamic options if available, otherwise fall back to static options
      const options = dynamicOptions || field.options || [];
      // Check if any option uses _none sentinel (for nullable selects)
      const hasNoneSentinel = options.some((opt) => opt.value === "_none");
      // Use _none sentinel for null values if the options include it
      const selectValue = hasNoneSentinel && (value === null || value === undefined || value === "")
        ? "_none"
        : ((value as string) || "");
      return (
        <Select
          value={selectValue}
          onValueChange={(v) => onChange(v === "_none" ? null : v)}
          disabled={disabled}
        >
          <SelectTrigger id={field.name}>
            <SelectValue placeholder={field.placeholder || "Select..."} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case "relation": {
      const options = dynamicOptions || [];
      // Build a lookup map so onFilter can match search text against labels (not UUIDs)
      const labelMap = new Map(options.map((o) => [o.value, o.label.toLowerCase()]));
      return (
        <Combobox
          value={value ? String(value) : ""}
          onValueChange={(v) => onChange(v || null)}
          disabled={disabled}
          onFilter={(values, search) => {
            const term = search.toLowerCase();
            return values.filter((v) => labelMap.get(v)?.includes(term));
          }}
        >
          <ComboboxAnchor>
            <ComboboxInput
              id={field.name}
              placeholder={field.placeholder || "Search..."}
            />
            {!field.required && !!value && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label="Clear selection"
              >
                <X className="size-3.5" />
              </button>
            )}
            <ComboboxTrigger />
          </ComboboxAnchor>
          <ComboboxContent>
            <ComboboxEmpty>No results found</ComboboxEmpty>
            {options.map((option) => (
              <ComboboxItem key={option.value} value={option.value} label={option.label}>
                {option.label}
              </ComboboxItem>
            ))}
          </ComboboxContent>
        </Combobox>
      );
    }

    case "switch":
    case "checkbox":
      return (
        <Switch
          id={field.name}
          checked={Boolean(value)}
          onCheckedChange={onChange}
          disabled={disabled}
        />
      );

    case "date":
      return (
        <DatePicker
          id={field.name}
          value={(value as string) || undefined}
          onChange={onChange}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      );

    case "datetime":
      return (
        <DateTimePicker
          id={field.name}
          value={(value as string) || undefined}
          onChange={onChange}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      );

    case "unit":
      if (!field.unitType) {
        console.warn(`Field ${field.name} has type "unit" but no unitType specified`);
        return (
          <Input
            id={field.name}
            type="number"
            value={value !== undefined && value !== null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
            placeholder={field.placeholder}
            disabled={disabled}
          />
        );
      }
      return (
        <UnitInput
          value={value as number | null | undefined}
          onChange={(v) => onChange(v)}
          unitType={field.unitType}
          allowSwitch={field.allowUnitSwitch}
          placeholder={field.placeholder}
          disabled={disabled}
        />
      );

    default:
      return (
        <Input
          id={field.name}
          type="text"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
        />
      );
  }
}

// Loading skeleton
function EntityFormSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-12 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="col-span-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
