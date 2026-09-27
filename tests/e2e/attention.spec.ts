/**
 * Needs your attention (docs/product/feature-plan.md F4). 첫 화면(Workspace, `/`)에서 출발해 줄을 눌러 업무나 Inbox 로 간다.
 * 주소 입력은 첫 화면 `/` 뿐이다.
 *
 * 순서 의존 — 이 파일은 이름 순서상 맨 먼저 돈다. 그래서 주 시험 서버(3100)의 시연 데이터가 **처음 모습**일 때를 가정한다
 * (검사 실패 한 줄: 로그인 화면 만들기 · payments#12, Inbox 5개). 이 파일은 3100 의 상태를 바꾸지 않는다 — 뒤 파일들이 같은 서버를 쓴다.
 * 상태를 바꿔야 하는 "검토 필요" 줄은 미리보기 기기를 연결한 서버(3101)에서 확인한다. 3101 을 쓰는 preview.spec 은 docs-site#12 를 보지 않는다.
 * 빈 상태는 시연 데이터로 만들 수 없어(payments#12 의 검사 실패는 업무에 있든 Inbox 에 있든 늘 한 줄을 낸다) 빈 저장소의 서버(3103)를 직접 켜서 본다.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const rows = (page: Page) => page.getByTestId("attention-row");

function watchServerErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

test("Workspace 맨 위에 검사 실패와 Inbox 줄이 모이고, 누르면 그 업무와 Inbox 로 간다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  const section = page.getByTestId("attention");
  await expect(section.getByRole("heading", { level: 2, name: "Needs your attention" })).toBeVisible();
  await expect(page.getByTestId("attention-count")).toHaveText("2");
  await expect(rows(page)).toHaveCount(2);

  const failing = rows(page).nth(0);
  await expect(failing).toHaveAttribute("data-kind", "checks_failing");
  await expect(failing).toContainText("Checks failing");
  await expect(failing).toContainText("'로그인 화면 만들기' · demo-org/payments#12");
  await expect(failing).toContainText("작성자가 고칠 차례라 업무 상태는 그대로 둔다");
  const inbox = rows(page).nth(1);
  await expect(inbox).toHaveAttribute("data-kind", "inbox");
  await expect(inbox.getByTestId("inbox-count")).toHaveText("5");
  await expect(inbox).toContainText("Open Inbox");
  // 완료 후보는 올리지 않는다(결정 16 의 4) — 종류는 네 가지뿐이다
  for (const row of await rows(page).all()) {
    expect(["needs_review", "checks_failing", "outdated_preview", "inbox"]).toContain(await row.getAttribute("data-kind"));
  }
  await page.screenshot({ fullPage: true });

  await failing.click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);
  await expect(page.getByRole("heading", { level: 1, name: "로그인 화면 만들기" })).toBeVisible();
  await expect(page.getByTestId("pr-card-710001-12")).toBeVisible();

  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await rows(page).filter({ hasText: "Open Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  expect(serverErrors).toEqual([]);
});

test.describe("검토 필요 줄 (서버 3101)", () => {
  test.use({ baseURL: "http://127.0.0.1:3101" });

  test("검토를 기다리는 업무가 생기면 맨 위에 오르고, 누르면 그 업무로 간다", async ({ page }) => {
    const serverErrors = watchServerErrors(page);
    await page.goto("/");
    await expect(rows(page).and(page.locator('[data-kind="needs_review"]'))).toHaveCount(0);
    // docs-site#12(검사 없음, 아직 판단하지 않음)로 새 업무를 만들면 규칙 R2 가 검토 필요로 올린다
    await nav(page).getByRole("link", { name: "Inbox" }).click();
    await page.getByTestId("inbox-710005-12").getByRole("button", { name: "New Work" }).click();
    await expect(page).toHaveURL(/\/works\/[a-z0-9]+$/);
    const workUrl = page.url();

    await nav(page).getByRole("link", { name: "Workspace" }).click();
    const first = rows(page).first();
    await expect(first).toHaveAttribute("data-kind", "needs_review");
    await expect(first).toContainText("Needs review");
    await expect(first).toContainText("'로그인 안내 문서'");
    await expect(first).toContainText("demo-org/docs-site#12 최신 커밋 6f7a8b9 의 검사가 끝났다. 아직 판단하지 않았다.");
    await expect(page.getByTestId("inbox-count")).toHaveText("4");
    await first.click();
    await expect(page).toHaveURL(workUrl);
    await expect(page.getByRole("heading", { level: 1, name: "로그인 안내 문서" })).toBeVisible();
    await expect(page.locator(".work-head").getByTestId("status-badge")).toHaveText("Needs review");
    expect(serverErrors).toEqual([]);
  });
});

test.describe("판단할 일이 없을 때 (빈 저장소 서버 3103)", () => {
  const PORT = 3103;
  const BASE = `http://127.0.0.1:${PORT}`;
  let server: ChildProcess | null = null;

  // 읽을 곳이 없는 GitHub 설정으로 켜면 시연 데이터를 심지 않는다 — 프로젝트도 PR 도 없는 저장소다. 저장은 늘 메모리다.
  test.beforeAll(async () => {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(PORT), "--hostname", "127.0.0.1"], {
      env: {
        ...process.env,
        DATABASE_URL: "",
        APP_ENV: "local",
        SYNC_INTERVAL_SECONDS: "0",
        GITHUB_TOKEN: "e2e-empty-store",
        GITHUB_REPOS: "",
        GITHUB_TOKEN_ORGS: "",
        GITHUB_APP_ID: "",
        GITHUB_APP_INSTALLATION_ID: "",
        GITHUB_APP_PRIVATE_KEY_PATH: "",
        GITHUB_APP_PRIVATE_KEY: "",
        PREVIEW_WORKDIR: "",
        PREVIEW_LOCAL_REPOS_DIR: "",
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 100; i += 1) {
      try {
        if ((await fetch(BASE)).status < 500) return;
      } catch {
        // 아직 켜지는 중
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("빈 저장소 서버가 30초 안에 켜지지 않았다");
  });

  test.afterAll(async () => {
    if (server === null || server.exitCode !== null) return;
    const exited = new Promise((r) => server?.once("exit", r));
    server.kill("SIGTERM");
    await exited;
  });

  test("'지금 판단할 일이 없다' 문장이 보이고 줄은 하나도 없다", async ({ page }) => {
    await page.goto(BASE);
    const section = page.getByTestId("attention");
    await expect(section.getByRole("heading", { level: 2, name: "Needs your attention" })).toBeVisible();
    await expect(page.getByTestId("attention-count")).toHaveText("0");
    await expect(page.getByTestId("attention-empty")).toHaveText(
      "지금 판단할 일이 없다. 검토할 PR, 실패한 검사, 이전 버전 미리보기, 연결을 기다리는 PR 이 생기면 여기에 모인다.",
    );
    await expect(rows(page)).toHaveCount(0);
    // 프로젝트가 없으면 New Work 는 누를 수 없고, 그 이유가 옆에 보인다(feature-plan F5, 결정 7)
    await expect(page.getByRole("button", { name: "New Work" })).toBeDisabled();
    await expect(page.getByTestId("new-work-disabled-reason")).toHaveText("연결된 프로젝트가 없어 업무를 만들 수 없다.");
    await page.screenshot({ fullPage: true });
  });
});
