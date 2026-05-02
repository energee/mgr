import { GripVertical } from "lucide-react";

type SortableDragPreviewProps = {
  title: string;
  subtitle?: string;
};

export function SortableDragPreview({ title, subtitle }: SortableDragPreviewProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-sm">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">{title}</span>
      {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
    </div>
  );
}

export function reorderWithPositions<T extends { position?: number }>(items: T[]): T[] {
  return items.map((item, i) => ({ ...item, position: i }));
}
