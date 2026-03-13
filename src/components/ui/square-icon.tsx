import { cn } from "@/lib/utils";

type SquareIconProps = {
  className?: string;
}

/**
 * Square POS logo mark.
 * Rendered as an inline SVG so it can be sized and colored via className.
 */
export function SquareIcon({ className }: SquareIconProps) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4", className)}
    >
      <path d="M256 128h512a128 128 0 0 1 128 128v512a128 128 0 0 1-128 128H256a128 128 0 0 1-128-128V256a128 128 0 0 1 128-128m42.666667 128a42.666667 42.666667 0 0 0-42.666667 42.666667v426.666666a42.666667 42.666667 0 0 0 42.666667 42.666667h426.666666a42.666667 42.666667 0 0 0 42.666667-42.666667V298.666667a42.666667 42.666667 0 0 0-42.666667-42.666667H298.666667m106.666666 128h213.333334a21.333333 21.333333 0 0 1 21.333333 21.333333v213.333334a21.333333 21.333333 0 0 1-21.333333 21.333333h-213.333334a21.333333 21.333333 0 0 1-21.333333-21.333333v-213.333334a21.333333 21.333333 0 0 1 21.333333-21.333333z" />
    </svg>
  );
}
