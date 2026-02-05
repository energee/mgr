"use client";

/**
 * EntityForm - Universal Form Component
 *
 * Renders a create/edit form for any entity based on its configuration.
 * Handles: validation via Zod, field rendering, submit, conditional fields.
 * Supports dynamicOptions for select fields that fetch from database tables.
 */

import { useState, useMemo, useRef, useEffect, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useSubmitShortcut } from "@/hooks/use-submit-shortcut";
import { useDynamicOptions } from "@/hooks/use-dynamic-options";
import { entityKeys } from "@/lib/query-keys";
import { CACHE_DURATIONS } from "@/lib/constants";
import type { EntityConfig } from "@/types/entity";
import { FieldInput } from "@/components/universal/field-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { ConflictDialog, useConflictDialog } from "@/components/ui/conflict-dialog";
import { updateWithOptimisticLock } from "@/lib/optimistic-lock";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";

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
  /** Render prop for additional content below the form fields (edit mode only) */
  children?: (context: { id: string; isSubmitting: boolean }) => ReactNode;
}

export function EntityForm<T = Record<string, unknown>>({
  entity,
  id,
  basePath,
  cancelUrl,
  defaultValues,
  onSuccess,
  children,
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

  // Esc to cancel / go back
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        router.push(cancelUrl || (isEdit && id ? `${path}/${id}` : path));
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [router, cancelUrl, isEdit, id, path]);

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
              <Kbd>Esc</Kbd>
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
                <FieldInput
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

        {isEdit && id && children && children({ id, isSubmitting })}

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(cancelUrl || (isEdit && id ? `${path}/${id}` : path))}
          >
            Cancel
            <Kbd>Esc</Kbd>
          </Button>
          <Button ref={submitRef} type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Save Changes" : `Create ${entity.displayName}`}
            <KbdGroup>
              <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>{isMac ? "↵" : "Enter"}</Kbd>
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
