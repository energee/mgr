"use client";

import { useRef } from "react";
import Link from "next/link";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  AnimatedEye,
  AnimatedSquarePen,
  AnimatedDelete,
  AnimatedCopy,
  type AnimatedIconHandle,
} from "@/components/icons/animated";

const actionIconMap: Record<string, typeof AnimatedEye> = {
  eye: AnimatedEye,
  view: AnimatedEye,
  edit: AnimatedSquarePen,
  pencil: AnimatedSquarePen,
  trash: AnimatedDelete,
  delete: AnimatedDelete,
  copy: AnimatedCopy,
  clone: AnimatedCopy,
};

export function AnimatedActionMenuItem({
  icon,
  label,
  disabled,
  title,
  variant,
  onClick,
}: {
  icon?: string;
  label: string;
  disabled?: boolean;
  title?: string;
  variant?: "default" | "destructive";
  onClick?: () => void;
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  const IconComponent = icon ? actionIconMap[icon] : undefined;

  return (
    <DropdownMenuItem
      variant={variant}
      className={variant === "destructive" ? "[&_svg]:!text-destructive" : undefined}
      disabled={disabled}
      title={title}
      onClick={onClick}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
    >
      {IconComponent && <IconComponent ref={iconRef} className="h-4 w-4 mr-2" />}
      {label}
    </DropdownMenuItem>
  );
}

export function AnimatedLinkActionMenuItem({
  icon,
  label,
  href,
}: {
  icon: string;
  label: string;
  href: string;
}) {
  const iconRef = useRef<AnimatedIconHandle>(null);
  const IconComponent = actionIconMap[icon];

  return (
    <DropdownMenuItem
      asChild
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
    >
      <Link href={href}>
        {IconComponent && <IconComponent ref={iconRef} className="h-4 w-4 mr-2" />}
        {label}
      </Link>
    </DropdownMenuItem>
  );
}
