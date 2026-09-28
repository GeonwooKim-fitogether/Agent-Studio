import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
/** 미리보기 기기를 연결한 두 번째 서버 (docs/plan/04-remote-preview.md §9 기준 3). 고정 데이터 + 로컬 시연 저장소로 돈다 */
export const PREVIEW_PORT = 3101;
const PREVIEW_ROOT = join(tmpdir(), "agent-studio-e2e-preview");
const PREVIEW_REPOS = join(PREVIEW_ROOT, "repos");
/**
 * 고정 데이터 모드에서 "GitHub 에 새 커밋이 올라왔다" 를 흉내 내는 파일 (STUDIO_FIXTURE_HEADS_FILE, 결정 18).
 * 서버를 켜기 전에 지운다 — 앞 실행이 남긴 커밋이 처음 상태를 바꾸지 않게.
 */
export const PREVIEW_HEADS_FILE = join(PREVIEW_ROOT, "heads.json");
const CLEAR_HEADS = `node -e "require('fs').rmSync(process.argv[1], { force: true })" ${JSON.stringify(PREVIEW_HEADS_FILE)}`;

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
  webServer: [
    {
    command: POSTGRES ? `node tests/e2e/prepare-db.mjs && ${START}` : START,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    // 빈 문자열로 두면 .env.local 이 있어도 덮어쓰지 않는다(Next 는 이미 있는 변수를 그대로 둔다)
    env: {
      GITHUB_TOKEN: "",
      GITHUB_REPOS: "",
      GITHUB_APP_ID: "",
      GITHUB_APP_INSTALLATION_ID: "",
      GITHUB_APP_PRIVATE_KEY_PATH: "",
      // 미리보기 기기를 연결하지 않은 상태로 띄운다(연결 안 됨 화면). .env.local 에 값이 있어도 덮어쓴다
      PREVIEW_WORKDIR: "",
      PREVIEW_LOCAL_REPOS_DIR: "",
      PREVIEW_BIND_HOST: "",
      PREVIEW_PUBLIC_HOST: "",
      DATABASE_URL: POSTGRES ? TEST_DATABASE_URL : "",
      // 주기 동기화를 끈다 — 동기화는 첫 요청과 Sync 버튼에서만 일어나 결과가 시각에 따라 달라지지 않는다
      SYNC_INTERVAL_SECONDS: "0",
      APP_ENV: POSTGRES ? "test" : "local",
    },
    },
    {
      // 미리보기 기기를 연결한 서버. 시연 저장소(admin-console#12 의 커밋)를 만든 뒤 켠다. 저장은 늘 메모리다.
      command: `${CLEAR_HEADS} && node scripts/preview-demo-repo.mjs ${JSON.stringify(PREVIEW_REPOS)} && npm run start -- --port ${PREVIEW_PORT} --hostname 127.0.0.1`,
      url: `http://127.0.0.1:${PREVIEW_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        GITHUB_TOKEN: "",
        GITHUB_REPOS: "",
        GITHUB_APP_ID: "",
        GITHUB_APP_INSTALLATION_ID: "",
        GITHUB_APP_PRIVATE_KEY_PATH: "",
        GITHUB_APP_PRIVATE_KEY: "",
        GITHUB_TOKEN_ORGS: "",
        DATABASE_URL: "",
        APP_ENV: "local",
        SYNC_INTERVAL_SECONDS: "0",
        PREVIEW_WORKDIR: join(PREVIEW_ROOT, "work"),
        PREVIEW_LOCAL_REPOS_DIR: PREVIEW_REPOS,
        PREVIEW_BIND_HOST: "127.0.0.1",
        PREVIEW_PUBLIC_HOST: "",
        STUDIO_FIXTURE_HEADS_FILE: PREVIEW_HEADS_FILE,
      },
    },
  ],
});
