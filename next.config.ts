import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/** Wrap the final config with bundle analyzer when ANALYZE=true. */
const analyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/**
 * Build a Content-Security-Policy header value.
 * Supabase project URL is allowed for API/auth calls and realtime websockets.
 * In development, 'unsafe-eval' is required by Next.js fast-refresh.
 */
const cspDirectives = [
  "default-src 'self'",
  `script-src 'self'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} 'unsafe-inline'`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} wss://*.supabase.co https://*.supabase.co https://*.ingest.sentry.io`,
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

/**
 * Security headers applied to all routes.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: cspDirectives.join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  /** Disable the X-Powered-By: Next.js header to reduce fingerprinting surface. */
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },

  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "date-fns",
      "motion",
    ],
  },
};

export default analyzer(
  withSentryConfig(nextConfig, {
    // Suppress noisy build logs unless running in CI
    silent: !process.env.CI,

    // Disable source map upload unless SENTRY_AUTH_TOKEN is configured
    sourcemaps: {
      disable: !process.env.SENTRY_AUTH_TOKEN,
    },
  })
);
