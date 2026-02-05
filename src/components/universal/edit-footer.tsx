/**
 * EditFooter - Sticky footer bar for edit mode
 *
 * Displays Save and Cancel buttons in a fixed footer when editing.
 * Shows "Unsaved changes" indicator when the form is dirty.
 */

"use client";

import { Button } from "@/components/ui/button";
import type { UseFormReturn } from "react-hook-form";

interface EditFooterProps {
  form: UseFormReturn<Record<string, unknown>>;
  onSave: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function EditFooter({
  form,
  onSave,
  onCancel,
  isSubmitting,
}: EditFooterProps) {
  const isDirty = form.formState.isDirty;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex items-center justify-end gap-3 py-3">
        {isDirty && (
          <span className="text-sm text-muted-foreground mr-auto">
            Unsaved changes
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={isSubmitting || !isDirty}
        >
          {isSubmitting ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
