"use client";

/**
 * Root-level error boundary.
 * Catches errors in the root layout that the app-level error.tsx cannot catch.
 * Reports errors to Sentry when configured.
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "system-ui, sans-serif",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Something went wrong
          </h2>
          <p style={{ color: "#6b7280", marginBottom: "1rem" }}>
            An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <p
              style={{
                color: "#9ca3af",
                fontSize: "0.75rem",
                fontFamily: "monospace",
                marginBottom: "1rem",
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid #d1d5db",
              background: "white",
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
