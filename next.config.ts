import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/** Wrap the final config with bundle analyzer when ANALYZE=true. */
const analyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/**
 * Security headers applied to all routes.
 * Content-Security-Policy is intentionally omitted — it will be added
 * separately after testing to avoid breaking inline scripts/styles.
 */
const securityHeaders = [
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
