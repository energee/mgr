"use client";

/**
 * Client Providers
 *
 * Wraps the app with necessary providers:
 * - TanStack Query for server state management
 * - Sonner for toast notifications
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { CACHE_DURATIONS } from "@/lib/constants";

type ProvidersProps = {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  // Create QueryClient inside component to avoid sharing state between requests
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Stale time - data is considered fresh for this duration
            staleTime: CACHE_DURATIONS.DYNAMIC_DATA,
            // Keep unused data in cache for 5 minutes
            gcTime: 5 * 60 * 1000,
            // Retry failed requests once
            retry: 1,
            // Refetch on window focus in production
            refetchOnWindowFocus: process.env.NODE_ENV === "production",
          },
          mutations: {
            // Disable mutation retry to prevent duplicate record creation on transient failures
            retry: false,
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <NuqsAdapter>
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster position="top-right" richColors closeButton />
        </QueryClientProvider>
      </NuqsAdapter>
    </ThemeProvider>
  );
}
