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
  // Determine if read-only based on session status
  // Only allow editing for "planned" and "in_progress" sessions
  const readOnly = data.status === "completed" ||
                   data.status === "revised" ||
                   data.status === "cancelled";

  return (
    <SessionLineItemsEditor
      sessionId={data.id}
      readOnly={readOnly}
    />
  );
}
