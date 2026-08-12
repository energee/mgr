"use client";

/**
 * Dropdown-menu action item shared by the entity data table, the mobile
 * card list, and the unified detail page. Maps entity action icon names
 * ("eye", "edit", "trash", …) to lucide icons. When `href` is set the item
 * renders as a link instead of a button.
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

  if (href) {
    return (
      <DropdownMenuItem asChild>
        <Link href={href}>{content}</Link>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      variant={variant}
      className={variant === "destructive" ? "[&_svg]:!text-destructive" : undefined}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {content}
    </DropdownMenuItem>
  );
}
