"use client";

/**
 * Reusable Route Error Boundary Component
 *
 * Shared error UI for all route-level error.tsx files.
 * Captures errors to Sentry and provides retry/home actions.
 */

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { log } from "@/lib/client-logger";

type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  /** Domain label shown in the error message, e.g. "production" */
  domain: string;
  /** Target of the "Go Home" button. Defaults to the staff app root. */
  homeHref?: string;
}

export function RouteError({ error, reset, domain, homeHref = "/" }: RouteErrorProps) {
  const router = useRouter();
  useEffect(() => {
    Sentry.captureException(error);
    log.error(`${domain} error boundary:`, error);
  }, [error, domain]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
      <AlertCircle className="h-12 w-12 text-destructive" />
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="max-w-md text-center text-muted-foreground">
        An error occurred loading {domain} data. You can try again or navigate to a different page.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">Error ID: {error.digest}</p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.push(homeHref)}>
          Go Home
        </Button>
        <Button onClick={reset}>
          Try Again
        </Button>
      </div>
    </div>
  );
}
