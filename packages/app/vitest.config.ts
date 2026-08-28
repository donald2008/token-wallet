import { defineConfig } from "vitest/config";

// L1 单元测试(instances schema/store)。排除 e2e Playwright spec(走 playwright test)
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});