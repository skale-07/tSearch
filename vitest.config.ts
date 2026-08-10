import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/assessment/**/*.test.ts",
      "tests/digest/**/*.test.ts",
      "tests/linkedin/**/*.test.ts",
      "tests/oracle/**/*.test.ts",
      "tests/storage/**/*.test.ts",
      "tests/web/**/*.test.ts",
    ],
    environment: "node",
  },
});
