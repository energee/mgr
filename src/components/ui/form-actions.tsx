"use client";

/**
 * FormActions
 *
 * Shared cancel/submit button row for dialog and section forms. Replaces
 * the ~15 places that hand-build their own DialogFooter with cancel +
 * submit buttons (audit F-077).
 *
 * Conventions baked in:
 * - Cancel on the left, submit on the right (consistent across the app).
 * - Submit uses default variant; cancel uses outline.
 * - Loading state shows a spinner + customizable label.
 * - 44px minimum height so the buttons clear the WCAG mobile touch target.
 *
 * For dialogs, render this inside `<DialogFooter>` — the wrapper div uses
 * the same flex classes as DialogFooter, so the rendered layout is
 * unchanged. For inline forms, render it standalone.
 */

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type FormActionsProps = {
  /** Submit-button label. Defaults to "Save". */
  submitLabel?: string;
  /** Cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Loading-state label shown alongside the spinner. */
  loadingLabel?: string;
  /** Whether the submit button is disabled. */
  submitDisabled?: boolean;
  /**
   * Whether the cancel button is disabled. Most dialogs keep cancel
   * clickable while the mutation is in flight; pass the pending flag here
   * for the ones that lock it.
   */
  cancelDisabled?: boolean;
  /** Whether the mutation is in flight. Disables submit, shows spinner. */
  isLoading?: boolean;
  /** Click handler for the cancel button. */
  onCancel: () => void;
  /** Submit handler. Omit when the form's onSubmit handles submission. */
  onSubmit?: () => void;
  /** Optional submit-button variant (default uses primary styling). */
  submitVariant?: "default" | "destructive";
  /** Optional icon rendered before the submit label (when not loading). */
  submitIcon?: React.ReactNode;
};

export function FormActions({
  submitLabel = "Save",
  cancelLabel = "Cancel",
  loadingLabel,
  submitDisabled,
  cancelDisabled,
  isLoading,
  onCancel,
  onSubmit,
  submitVariant = "default",
  submitIcon,
}: FormActionsProps) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={cancelDisabled}
        className="min-h-[44px]"
      >
        {cancelLabel}
      </Button>
      <Button
        type={onSubmit ? "button" : "submit"}
        variant={submitVariant}
        onClick={onSubmit}
        disabled={submitDisabled || isLoading}
        aria-busy={isLoading ?? false}
        className="min-h-[44px]"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {loadingLabel ?? `${submitLabel}…`}
          </>
        ) : (
          <>
            {submitIcon}
            {submitLabel}
          </>
        )}
      </Button>
    </div>
  );
}
