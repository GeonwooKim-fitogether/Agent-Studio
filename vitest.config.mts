import { defineConfig } from "vitest/config";

// 단위 테스트는 tests/unit 아래의 *.test.ts 만 돈다. e2e(tests/e2e)는 Playwright 가 따로 돌린다.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
