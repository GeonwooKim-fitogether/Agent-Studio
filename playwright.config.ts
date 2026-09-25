import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * e2e 는 빌드된 앱(`npm run build` 뒤 `next start`)을 띄워 사용자 흐름대로 구동한다.
 * 매 실행마다 새 서버를 띄우므로(reuseExistingServer: false) 메모리 저장소는 언제나 처음 상태에서 시작한다.
 * GitHub 변수를 비워 두어 항상 고정 데이터(fixture)로 돈다.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start -- --port ${PORT} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { GITHUB_TOKEN: "", GITHUB_REPOS: "" },
  },
});
