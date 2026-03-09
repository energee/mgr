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
      // pino is installed but not hoisted by pnpm; alias to the deep store path
      // so Vite's import analysis can resolve it in mocked test files
      pino: path.resolve(
        __dirname,
        "node_modules/.pnpm/pino@10.3.1/node_modules/pino"
      ),
    },
  },
});
