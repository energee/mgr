"use client";

/**
 * Safe SVG Renderer
 *
 * Renders user-provided SVG strings inline with DOMPurify sanitization.
 * Uses fill-current so the SVG inherits the current text color (dark mode compatible).
 */

import DOMPurify from "isomorphic-dompurify";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

type SafeSvgProps = {
  svg: string;
  className?: string;
  ariaLabel?: string;
}

export function SafeSvg({ svg, className, ariaLabel }: SafeSvgProps) {
  const sanitized = useMemo(() => DOMPurify.sanitize(svg), [svg]);

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center text-foreground [&_svg]:h-full [&_svg]:w-full [&_*]:fill-current",
        className
      )}
      role="img"
      aria-label={ariaLabel}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
