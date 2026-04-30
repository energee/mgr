/**
 * EmptyStateHint — Reusable empty state message with optional link.
 *
 * Used in sections that have no data yet but can guide the user
 * to the right place to set things up.
 */

import Link from "next/link";

type EmptyStateHintProps = {
  /** The main message explaining why this section is empty. */
  message: string;
  /** Optional link URL for the action the user should take. */
  href?: string;
  /** Optional link label. Defaults to the href path if not provided. */
  linkLabel?: string;
};

export function EmptyStateHint({ message, href, linkLabel }: EmptyStateHintProps) {
  return (
    <p className="text-sm text-muted-foreground py-4">
      {message}
      {href && (
        <>
          {" "}
          <Link
            href={href}
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {linkLabel ?? href}
          </Link>
        </>
      )}
    </p>
  );
}
