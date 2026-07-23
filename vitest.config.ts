import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/assessment/**/*.test.ts", "tests/digest/**/*.test.ts"],
    environment: "node",
  },
});
