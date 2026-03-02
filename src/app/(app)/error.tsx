"use client";

/**
 * App Error Boundary
 *
 * Catches unhandled errors within the authenticated app routes.
 * Provides a user-friendly error page with retry action.
 */

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("App error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
      <AlertCircle className="h-12 w-12 text-destructive" />
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="max-w-md text-center text-muted-foreground">
        An unexpected error occurred. You can try again or navigate to a different page.
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">Error ID: {error.digest}</p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => window.location.href = "/"}>
          Go Home
        </Button>
        <Button onClick={reset}>
          Try Again
        </Button>
      </div>
    </div>
  );
}
