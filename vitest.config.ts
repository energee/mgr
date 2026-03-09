import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      exclude: ["src/lib/supabase/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // pino is a transitive dep (not hoisted by pnpm strict mode); alias to the
      // pnpm store path so Vite can resolve it. Update version here when pino is upgraded.
      pino: path.resolve(
        __dirname,
        "node_modules/.pnpm/pino@10.3.1/node_modules/pino"
      ),
    },
  },
});
