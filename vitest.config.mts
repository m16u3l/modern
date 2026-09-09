import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // TypeScript labs share this runner — they are excluded from the Next
    // build and from lint, but a lab test can never break the deploy, so
    // there is no reason to make each one install its own vitest.
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "labs/**/*.test.ts",
    ],
    // Pure logic runs in node. Files that render React opt into jsdom with a
    // `// @vitest-environment jsdom` docblock.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
});
