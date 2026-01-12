"use client";

/**
 * EntityForm - Universal Form Component
 *
 * Renders a create/edit form for any entity based on its configuration.
 * Handles: validation via Zod, field rendering, submit, conditional fields.
 * Supports dynamicOptions for select fields that fetch from database tables.
 */

import { useState, useMemo, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { EntityConfig, EntityFieldDef } from "@/types/entity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";

// Hook to fetch dynamic options for fields
function useDynamicOptions<T>(fields: EntityFieldDef<T>[]) {
  const supabase = createClient();

  // Get all fields that have dynamicOptions
  const dynamicFields = fields.filter((f) => f.dynamicOptions);

  // Create queries for each dynamic field
  const queries = useQueries({
    queries: dynamicFields.map((field) => ({
      queryKey: ["dynamic-options", field.dynamicOptions!.table, field.name],
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
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    })),
  });

  // Combine results into a map of fieldName -> options
  const optionsMap = useMemo(() => {
    const map: Record<string, { value: string; label: string }[]> = {};
    queries.forEach((query) => {
      if (query.data) {
        map[query.data.fieldName as string] = query.data.options;
      }
    });
    return map;
  }, [queries]);

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

  // Form state
  const [values, setValues] = useState<Partial<T>>(() => {
    // Initialize with default values from field configs
    const initial: Partial<T> = {};
    entity.formFields.forEach((field) => {
      if (field.defaultValue !== undefined) {
        (initial as Record<string, unknown>)[field.name] = field.defaultValue;
      }
    });
    return { ...initial, ...defaultValues };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch existing record for edit mode
  const { data: existingData, isLoading } = useQuery({
    queryKey: [entity.table, id],
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
    enabled: isEdit,
  });

  // Merge existing data into form values once loaded
  useMemo(() => {
    if (existingData && isEdit) {
      setValues((prev) => ({ ...prev, ...existingData }));
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

    // Validate with Zod schema
    const result = entity.formSchema.safeParse(values);
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
        // Update existing record
        const { data, error } = await db
          .from(entity.table)
          .update(result.data)
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        toast.success(`${entity.displayName} updated successfully`);
        queryClient.invalidateQueries({ queryKey: [entity.table, id] });
        queryClient.invalidateQueries({ queryKey: [entity.table] });
        onSuccess?.(data as T);
        router.push(`${path}/${id}`);
      } else {
        // Create new record
        const { data, error } = await db
          .from(entity.table)
          .insert(result.data)
          .select()
          .single();
        if (error) throw error;
        toast.success(`${entity.displayName} created successfully`);
        queryClient.invalidateQueries({ queryKey: [entity.table] });
        onSuccess?.(data as T);
        router.push(`${path}/${(data as Record<string, unknown>).id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isEdit && isLoading) {
    return <EntityFormSkeleton entity={entity} />;
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
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Save Changes" : `Create ${entity.displayName}`}
          </Button>
        </div>
      </form>
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

  return (
    <div className={`col-span-${colSpan}`} style={{ gridColumn: `span ${colSpan}` }}>
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

    case "textarea": {
      // Handle JSONB values - stringify objects for display
      const textValue = typeof value === "object" && value !== null
        ? JSON.stringify(value, null, 2)
        : (value as string) || "";
      return (
        <Textarea
          id={field.name}
          value={textValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
        />
      );
    }

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
      return (
        <Select
          value={(value as string) || ""}
          onValueChange={onChange}
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
        <Input
          id={field.name}
          type="date"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );

    case "datetime":
      return (
        <Input
          id={field.name}
          type="datetime-local"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
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
function EntityFormSkeleton<T>({ entity }: { entity: EntityConfig<T> }) {
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
