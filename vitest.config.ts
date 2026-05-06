import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      ".github/scripts/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      exclude: ["src/lib/supabase/**"],
      // Harness gate: thresholds start permissive so the rule can be
      // committed without first writing tests. Raise them as `src/lib`
      // coverage grows. See docs/agents/quality.md for the trend log.
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // pino is a transitive dep; alias so Vite can resolve it in the test environment.
      pino: path.resolve(__dirname, "node_modules/pino"),
    },
  },
});
