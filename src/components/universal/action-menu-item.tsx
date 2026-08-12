"use client";

/**
 * Dropdown-menu action item shared by the entity data table, the mobile
 * card list, and the unified detail page. Maps entity action icon names
 * ("eye", "edit", "trash", …) to lucide icons. When `href` is set the item
 * renders as a link — unless it is also `disabled`, in which case it renders
 * as a plain (non-navigable) menu item so the destination stays unreachable.
 */

import Link from "next/link";
import { Copy, Eye, SquarePen, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

const actionIconMap: Record<string, LucideIcon> = {
  eye: Eye,
  view: Eye,
  edit: SquarePen,
  pencil: SquarePen,
  trash: Trash2,
  delete: Trash2,
  copy: Copy,
  clone: Copy,
};

export function ActionMenuItem({
  icon,
  label,
  href,
  disabled,
  title,
  variant,
  onClick,
}: {
  icon?: string;
  label: string;
  href?: string;
  disabled?: boolean;
  title?: string;
  variant?: "default" | "destructive";
  onClick?: () => void;
}) {
  const IconComponent = icon ? actionIconMap[icon] : undefined;
  const content = (
    <>
      {IconComponent && <IconComponent className="h-4 w-4 mr-2" />}
      {label}
    </>
  );

  // Shared across both branches so an item does not silently lose its
  // disabled/destructive/title/onClick behaviour just because it has an href.
  const itemProps = {
    variant,
    className: variant === "destructive" ? "[&_svg]:!text-destructive" : undefined,
    disabled,
    title,
    onClick,
  };

  // A disabled item must not stay navigable: with `asChild` the Radix
  // `disabled` state only lands as `data-disabled`/`aria-disabled` +
  // `pointer-events-none` on the `<a>`, so the href would still be reachable
  // (screen-reader link list, "open in new tab", browser find-link).
  if (href && !disabled) {
    return (
      <DropdownMenuItem {...itemProps} asChild>
        <Link href={href}>{content}</Link>
      </DropdownMenuItem>
    );
  }

  return <DropdownMenuItem {...itemProps}>{content}</DropdownMenuItem>;
}
