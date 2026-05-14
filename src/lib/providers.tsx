"use client";

/**
 * Client Providers
 *
 * Wraps the app with necessary providers:
 * - TanStack Query for server state management
 * - Sonner for toast notifications
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { createAppQueryClient } from "@/lib/query-client";

type ProvidersProps = {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  // Create QueryClient inside component to avoid sharing state between requests
  const [queryClient] = useState(createAppQueryClient);

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
