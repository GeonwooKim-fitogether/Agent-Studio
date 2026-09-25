/**
 * 서버를 다시 켜도 남는다 (docs/plan/02-persistence-and-unlink.md §3 의 3) — PostgreSQL 모드에서만 돈다.
 *
 * 이 시험은 자기 서버(3101)를 직접 켜고 끈다. 주 시험 서버와 섞이지 않도록 따로 된 데이터베이스
 * (<TEST_DATABASE_URL 의 이름>_restart, tests/e2e/prepare-db.mjs 가 비워 둔다)를 쓴다.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";

const POSTGRES = process.env.E2E_STORAGE === "postgres";
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;

function restartUrl(): string {
  const u = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://unused/unused");
  u.pathname = `${u.pathname}_restart`;
  return u.href;
}

async function startServer(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(PORT), "--hostname", "127.0.0.1"], {
    env: { ...process.env, DATABASE_URL: restartUrl(), APP_ENV: "test", GITHUB_TOKEN: "", GITHUB_REPOS: "", GITHUB_APP_ID: "", GITHUB_APP_INSTALLATION_ID: "", GITHUB_APP_PRIVATE_KEY_PATH: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(BASE)).status < 500) return child;
    } catch {
      // 아직 켜지는 중
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill("SIGKILL");
  throw new Error("재시작 시험용 서버가 30초 안에 켜지지 않았다");
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await exited;
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test.describe("서버 재시작", () => {
  test.skip(!POSTGRES, "PostgreSQL 모드(E2E_STORAGE=postgres)에서만 돈다");

  test("사람이 만든 연결 · 새 업무 · 연결 해제가 서버를 껐다 켠 뒤에도 그대로 보인다", async ({ page }) => {
    test.setTimeout(120_000);
    let server = await startServer();
    try {
      await page.goto(BASE);
      await expect(page.getByTestId("storage-kind")).toHaveText("Stored in PostgreSQL");
      // 사람이 연결: coach-web#12 → 코치 로그인 개편
      await nav(page).getByRole("link", { name: "Inbox" }).click();
      const coach = page.getByTestId("inbox-710002-12");
      await coach.getByLabel("Work").selectOption({ label: "코치 로그인 개편 · studio-work-b4c5d6" });
      await coach.getByRole("button", { name: "Link to Work" }).click();
      await expect(page).toHaveURL(/\/works\/b4c5d6$/);
      // 새 업무: docs-site#12
      await nav(page).getByRole("link", { name: "Inbox" }).click();
      await page.getByTestId("inbox-710005-12").getByRole("button", { name: "New Work" }).click();
      await expect(page).toHaveURL(/\/works\/[a-z0-9]+$/);
      const newWorkUrl = page.url().replace(BASE, "");
      // 연결 해제: payments#12 를 로그인 화면 만들기에서
      await nav(page).getByRole("link", { name: "Workspace" }).click();
      await page.getByTestId("work-a1b2c3").getByRole("link", { name: "로그인 화면 만들기" }).click();
      const card = page.getByTestId("pr-card-710001-12");
      await card.getByRole("checkbox").check();
      await card.getByRole("button", { name: "Unlink" }).click();
      await expect(page).toHaveURL(/notice=unlinked/);

      await stopServer(server); // 서버를 끈다
      await expect(page.goto(BASE)).rejects.toThrow(); // 정말 꺼졌다
      server = await startServer(); // 다시 켠다

      await page.goto(BASE);
      await expect(page.getByTestId("work-b4c5d6").getByTestId("pr-card-710002-12")).toBeVisible();
      await expect(page.getByTestId("project-docs").getByTestId("pr-card-710005-12")).toBeVisible();
      await expect(page.getByTestId("project-docs").locator('[data-testid^="work-"]')).toHaveCount(1); // 시연 데이터를 다시 심지 않았다
      await expect(page.getByTestId("work-a1b2c3").getByTestId("pr-card-710001-12")).toHaveCount(0);
      await nav(page).getByRole("link", { name: "Inbox" }).click();
      await expect(page.getByTestId("inbox-710001-12").getByTestId("inbox-reason")).toContainText("사람이 이 PR 의 연결을 풀었다");
      await page.getByRole("button", { name: "Sync" }).click(); // 다시 켠 뒤 Sync 해도 자동으로 붙지 않는다
      await expect(page.getByTestId("inbox-710001-12")).toBeVisible();
      expect(newWorkUrl).toMatch(/^\/works\//);
    } finally {
      await stopServer(server);
    }
  });
});
