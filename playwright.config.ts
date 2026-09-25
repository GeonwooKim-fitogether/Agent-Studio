import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * 저장 종류. 기본은 메모리이고, E2E_STORAGE=postgres 이면 TEST_DATABASE_URL 의 PostgreSQL 로 돈다(`npm run test:e2e:postgres`).
 * PostgreSQL 모드는 서버를 켜기 전에 시험용 데이터베이스를 비우고 마이그레이션을 적용한다(tests/e2e/prepare-db.mjs).
 */
const POSTGRES = process.env.E2E_STORAGE === "postgres";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
if (POSTGRES && TEST_DATABASE_URL === "") throw new Error("E2E_STORAGE=postgres 로 돌리려면 TEST_DATABASE_URL 이 필요하다.");
const START = `npm run start -- --port ${PORT} --hostname 127.0.0.1`;

/**
 * e2e 는 빌드된 앱(`npm run build` 뒤 `next start`)을 띄워 사용자 흐름대로 구동한다.
 * 매 실행마다 새 서버를 띄우므로(reuseExistingServer: false) 메모리 저장소는 언제나 처음 상태에서 시작한다.
 * GitHub 변수를 비워 두어 항상 고정 데이터(fixture)로 돈다.
 * 메모리 모드는 서버를 새로 띄우므로 처음 상태에서 시작하고, PostgreSQL 모드는 켜기 전에 데이터베이스를 비운다.
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
    command: POSTGRES ? `node tests/e2e/prepare-db.mjs && ${START}` : START,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    // 빈 문자열로 두면 .env.local 이 있어도 덮어쓰지 않는다(Next 는 이미 있는 변수를 그대로 둔다)
    env: {
      GITHUB_TOKEN: "",
      GITHUB_REPOS: "",
      DATABASE_URL: POSTGRES ? TEST_DATABASE_URL : "",
      APP_ENV: POSTGRES ? "test" : "local",
    },
  },
});
