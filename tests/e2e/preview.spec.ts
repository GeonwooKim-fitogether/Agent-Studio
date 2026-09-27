/**
 * 미리보기 (docs/plan/04-remote-preview.md §9). 진입점(Workspace, `/`)에서 출발해 클릭만으로 업무 화면에 가서 Open Preview 를 본다.
 * 주소 입력은 첫 화면 `/` 뿐이다.
 */
import { expect, type Page, test } from "@playwright/test";

const SHOTS = "docs/plan/screenshots";

async function shot(page: Page, name: string): Promise<void> {
  if (process.env.UPDATE_SCREENSHOTS === "1") await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: true });
  else await page.screenshot({ fullPage: true });
}

test("미리보기 기기가 연결되지 않았으면 Open Preview 는 비활성이고, 바로 옆에 이유가 보인다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("preview-device")).toHaveText("Preview device: not connected");
  await expect(page.getByTestId("preview-device-detail")).toContainText("PREVIEW_WORKDIR");
  // Workspace 의 카드에는 미리보기 버튼이 없다 — 업무 화면에서 연다
  await expect(page.getByRole("button", { name: "Open Preview" })).toHaveCount(0);

  await page.getByTestId("work-d0e1f2").getByRole("link", { name: "관리자 로그인 보안 점검" }).click();
  await expect(page).toHaveURL(/\/works\/d0e1f2$/);
  const card = page.getByTestId("pr-card-710004-12");
  const button = card.getByRole("button", { name: "Open Preview" });
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(card.getByTestId("preview-blocked-reason")).toHaveText(
    "미리보기 기기가 연결되지 않았다 — PREVIEW_WORKDIR 를 설정한 컴퓨터에서 Studio 를 띄운다.",
  );
  await shot(page, "08-preview-not-connected.png");
});

/**
 * 미리보기 기기를 연결한 서버(3101, playwright.config.ts). 고정 데이터의 admin-console#12 커밋이 로컬 시연 저장소에 실제로 있어,
 * 진짜 npm ci 와 진짜 자식 프로세스로 앱이 뜬다. 시험들은 같은 서버(같은 실행기)를 차례로 쓴다.
 */
test.describe("미리보기 기기가 연결된 서버", () => {
  test.use({ baseURL: "http://127.0.0.1:3101" });
  test.describe.configure({ timeout: 120_000 });

  test("Open Preview 를 누르면 준비 과정이 보이고, 실행 중 · PR · 커밋 · 주소와 Open 링크가 나타나며, 그 주소가 PR 커밋의 화면이다", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("preview-device")).toHaveText("Preview device: connected");
    await expect(page.getByTestId("preview-device-detail")).toContainText("this computer · 127.0.0.1");

    await page.getByTestId("work-d0e1f2").getByRole("link", { name: "관리자 로그인 보안 점검" }).click();
    const card = page.getByTestId("pr-card-710004-12");
    const open = card.getByRole("button", { name: "Open Preview" });
    await expect(open).toBeEnabled();
    await open.click();

    const session = card.getByTestId("preview-session");
    await expect(session).toBeVisible();
    await expect(session).toHaveAttribute("data-phase", "running", { timeout: 90_000 }); // 화면이 2초마다 다시 그린다
    await expect(card.getByTestId("preview-phase")).toHaveText("Running");
    await expect(session).toContainText("PR #12");
    await expect(card.getByTestId("preview-commit")).toHaveText("9e28961");
    await expect(session).toHaveAttribute("data-freshness", "current");
    await expect(card.getByTestId("preview-outdated")).toHaveCount(0);
    const url = await card.getByTestId("preview-url").textContent();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await expect(page.getByTestId("preview-device-detail")).toContainText("Running · demo-org/admin-console#12");
    await shot(page, "09-preview-running.png");

    // Open 링크는 새 탭에서 PR 커밋의 앱을 연다
    const [preview] = await Promise.all([context.waitForEvent("page"), card.getByTestId("preview-open-link").click()]);
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText("관리자 로그인 2단계 인증");
    await expect(preview.locator("[data-demo=preview]")).toHaveText("demo-org/admin-console#12 미리보기");
    await preview.close();
  });

  test("다른 PR 을 열면 이전 미리보기를 끄고 알린다. 받을 수 없는 커밋이면 이유와 로그가 보인다", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("work-a1b2c3").getByRole("link", { name: "로그인 화면 만들기" }).click();
    const card = page.getByTestId("pr-card-710001-12");
    await expect(card.getByTestId("preview-other-active")).toContainText("demo-org/admin-console#12 의 미리보기가 돌고 있다");
    await card.getByRole("button", { name: "Open Preview" }).click();

    const session = card.getByTestId("preview-session");
    await expect(session).toHaveAttribute("data-phase", "failed", { timeout: 60_000 });
    await expect(card.getByTestId("preview-replaced")).toContainText("이전 미리보기(demo-org/admin-console#12 · 커밋 9e28961)를 종료했다");
    // 시연 저장소에는 결제 서비스 저장소가 없다 — 코드를 받지 못한 이유가 보인다
    await expect(card.getByTestId("preview-failure")).toContainText("로컬 저장소 demo-org/payments 에 커밋 3c4d5e6 이 없다");
    await expect(card.getByTestId("preview-log")).toContainText("[studio]");
    await expect(page.getByTestId("preview-device-detail")).not.toContainText("demo-org/admin-console#12");
  });

  test("Stop Preview 는 실행 중인 미리보기를 끈다", async ({ page, request }) => {
    await page.goto("/");
    await page.getByTestId("work-d0e1f2").getByRole("link", { name: "관리자 로그인 보안 점검" }).click();
    const card = page.getByTestId("pr-card-710004-12");
    await card.getByRole("button", { name: "Open Preview" }).click();
    await expect(card.getByTestId("preview-session")).toHaveAttribute("data-phase", "running", { timeout: 90_000 });
    const url = String(await card.getByTestId("preview-url").textContent());
    expect((await request.get(url)).ok()).toBe(true);

    await card.getByRole("button", { name: "Stop Preview" }).click();
    await expect(card.getByTestId("preview-phase")).toHaveText("Stopped");
    await expect(card.getByTestId("preview-open-link")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Stop Preview" })).toHaveCount(0);
    await expect(request.get(url, { timeout: 3000 })).rejects.toThrow();
  });
});
