/**
 * createQBOSyncDisplay - Factory for entity detail sections
 *
 * Adapts QBOSyncSection to work with EntityDetail's custom component section
 * pattern. Split out from qbo-sync-section.tsx (a real "use client" module —
 * it calls useState/useQuery/useMutation directly) so this factory can be
 * invoked eagerly at module scope inside each entity's presentation.tsx
 * without inheriting that client boundary. See revision-history-display.tsx
 * for the same split and SENTRY-7611936148 / MGR-S for why it matters: a
 * server-only import of a presentation module would otherwise try to call a
 * client-reference function and crash.
 */

import { QBOSyncSection, type QBOSyncSectionProps } from "./qbo-sync-section";

export function createQBOSyncDisplay(entityType: QBOSyncSectionProps["entityType"]) {
  return function QBOSyncDisplay({ data }: { data: { id: string } }) {
    if (!data?.id) return null;
    return <QBOSyncSection entityType={entityType} entityId={data.id} />;
  };
}
