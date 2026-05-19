"use client";

/**
 * SessionLineItemsDisplay - Wrapper component for inline line item editing
 *
 * Extracts the session ID from entity data and renders the SessionLineItemsEditor.
 * Used as a custom component in the packaging session detail view.
 */

import { SessionLineItemsEditor } from "./session-line-items-editor";

type SessionLineItemsDisplayProps = {
  data: { id: string; status?: string };
}

export function SessionLineItemsDisplay({ data }: SessionLineItemsDisplayProps) {
  // All statuses except "planned" are read-only in this wrapper.
  // "in_progress" sessions use PackagingDayView instead, but if this
  // component is reached for in_progress, default to read-only for safety.
  const readOnly = data.status !== "planned";

  return (
    <SessionLineItemsEditor
      sessionId={data.id}
      readOnly={readOnly}
    />
  );
}
