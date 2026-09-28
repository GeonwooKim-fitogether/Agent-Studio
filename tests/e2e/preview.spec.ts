/**
 * 미리보기 (docs/plan/04-remote-preview.md §9, 결정 18 의 Q10). 진입점(Workspace, `/`)에서 출발해 클릭만으로 업무 화면의 Review 패널에 가서
 * Open Preview 를 본다. 주소 입력은 첫 화면 `/` 뿐이다.
 */
import { writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { nav, openConnections, openReview, openWork, sync } from "./helpers";
import { PREVIEW_HEADS_FILE } from "../../playwright.config";

const SHOTS = "docs/plan/screenshots";

async function shot(page: Page, name: string): Promise<void> {
  if (process.env.UPDATE_SCREENSHOTS === "1") await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: true });
  else await page.screenshot({ fullPage: true });
}

test("미리보기 기기가 연결되지 않았으면 Open Preview 는 비활성이고 바로 옆에 이유가 보이며, 검토는 막지 않는다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("preview-host").first()).toContainText("Preview host offline");
  // Workspace 에는 미리보기 버튼이 없다 — 업무 화면의 Review 패널에서 연다
  await expect(page.getByRole("button", { name: "Open Preview" })).toHaveCount(0);
  await openConnections(page);
  await expect(page.getByTestId("preview-device")).toHaveText("Preview device: not connected");
  await expect(page.getByTestId("preview-device-detail")).toContainText("PREVIEW_WORKDIR");

  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await openWork(page, "d0e1f2");
  const panel = await openReview(page, 710004, 12);
  const button = panel.getByRole("button", { name: "Open Preview" });
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(panel.getByTestId("preview-blocked-reason")).toHaveText(
    "미리보기 기기가 연결되지 않았다 — PREVIEW_WORKDIR 를 설정한 컴퓨터에서 Studio 를 띄운다.",
  );
  await expect(button).toHaveAttribute("title", "미리보기 기기가 연결되지 않았다 — PREVIEW_WORKDIR 를 설정한 컴퓨터에서 Studio 를 띄운다.");
  // 기기가 꺼진 것을 글로 말하는 곳은 사이드바 한 곳이다 — 패널은 머리의 회색 미리보기 칸과 그 title 로만 (결정 19)
  await expect(panel.getByTestId("preview-status")).toHaveAttribute("title", "Preview host offline — 미리보기 없이 GitHub 에서 확인한다.");
  await expect(panel.getByTestId("preview-status")).toHaveAttribute("data-value", "offline");
  await expect(panel.getByRole("button", { name: "Approve in Studio" })).toBeEnabled(); // 미리보기 없이도 검토한다
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
    await expect(page.getByTestId("preview-host").first()).toContainText("Preview host connected");
    await openConnections(page);
    await expect(page.getByTestId("preview-device")).toHaveText("Preview device: connected");
    await expect(page.getByTestId("preview-device-detail")).toContainText("this computer · 127.0.0.1");

    await nav(page).getByRole("link", { name: "Workspace" }).click();
    await openWork(page, "d0e1f2");
    const card = await openReview(page, 710004, 12);
    const open = card.getByRole("button", { name: "Open Preview" });
    await expect(open).toBeEnabled();
    await open.click();

    const session = card.getByTestId("preview-session");
    await expect(session).toBeVisible();
    await expect(page).toHaveURL(/review=710004:12/); // 패널을 연 채로 돌아온다
    await expect(session).toHaveAttribute("data-phase", "running", { timeout: 90_000 }); // 화면이 2초마다 다시 그린다
    await expect(card.getByTestId("preview-phase")).toHaveText("Running");
    await expect(session).toContainText("PR #12");
    await expect(card.getByTestId("preview-commit")).toHaveText("9e28961");
    await expect(session).toHaveAttribute("data-freshness", "current");
    await expect(card.getByTestId("preview-outdated")).toHaveCount(0);
    const url = await card.getByTestId("preview-url").textContent();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await expect(page.getByTestId("pr-card-710004-12").getByTestId("preview-status")).toHaveAttribute("data-value", "running");
    await expect(page.getByTestId("pr-card-710004-12").getByTestId("preview-status")).toHaveAttribute("title", "Preview: Running · 9e28961");
    await shot(page, "09-preview-running.png");

    // Open 링크는 새 탭에서 PR 커밋의 앱을 연다
    const [preview] = await Promise.all([context.waitForEvent("page"), card.getByTestId("preview-open-link").click()]);
    await expect(preview.getByRole("heading", { level: 1 })).toHaveText("관리자 로그인 2단계 인증");
    await expect(preview.locator("[data-demo=preview]")).toHaveText("demo-org/admin-console#12 미리보기");
    await preview.close();
    await openConnections(page);
    await expect(page.getByTestId("preview-device-detail")).toContainText("Running · demo-org/admin-console#12");
  });

  test("다른 PR 을 열면 이전 미리보기를 끄고 알린다. 받을 수 없는 커밋이면 이유와 로그가 보인다", async ({ page }) => {
    await page.goto("/");
    await openWork(page, "a1b2c3");
    const card = await openReview(page, 710001, 12);
    await expect(card.getByTestId("preview-other-active")).toContainText("demo-org/admin-console#12 의 미리보기가 돌고 있다");
    await card.getByRole("button", { name: "Open Preview" }).click();

    const session = card.getByTestId("preview-session");
    await expect(session).toHaveAttribute("data-phase", "failed", { timeout: 60_000 });
    await expect(card.getByTestId("preview-replaced")).toContainText("이전 미리보기(demo-org/admin-console#12 · 커밋 9e28961)를 종료했다");
    // 시연 저장소에는 결제 서비스 저장소가 없다 — 코드를 받지 못한 이유가 보인다
    await expect(card.getByTestId("preview-failure")).toContainText("로컬 저장소 demo-org/payments 에 커밋 3c4d5e6 이 없다");
    await expect(card.getByTestId("preview-log")).toContainText("[studio]");
    await openConnections(page);
    await expect(page.getByTestId("preview-device-detail")).not.toContainText("demo-org/admin-console#12");
  });

  test("Stop Preview 는 실행 중인 미리보기를 끈다", async ({ page, request }) => {
    await page.goto("/");
    await openWork(page, "d0e1f2");
    const card = await openReview(page, 710004, 12);
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

  /**
   * 이 서버를 쓰는 마지막 시험이다 — admin-console#12 의 최신 커밋을 바꾼다(STUDIO_FIXTURE_HEADS_FILE 로 GitHub 에 새 커밋이 온 것을 흉내 낸다).
   */
  test("실행 중인 미리보기가 이전 커밋이 되면, 결정 버튼을 막고 이유와 Open Preview(최신 커밋)를 보인다 (Q10)", async ({ page }) => {
    await page.goto("/");
    await openWork(page, "d0e1f2");
    const panel = await openReview(page, 710004, 12);
    await panel.getByRole("button", { name: "Open Preview" }).click();
    await expect(panel.getByTestId("preview-session")).toHaveAttribute("data-phase", "running", { timeout: 90_000 });
    await expect(panel.getByRole("button", { name: "Approve in Studio" })).toBeEnabled();

    writeFileSync(PREVIEW_HEADS_FILE, JSON.stringify({ "710004#12": "ab".repeat(20) }));
    await sync(page);
    await expect(panel.getByTestId("review-commit")).toHaveText("abababa");
    await expect(panel.getByTestId("preview-session")).toHaveAttribute("data-freshness", "outdated");
    await expect(panel.getByTestId("preview-status")).toHaveAttribute("data-value", "outdated"); // 머리의 미리보기 칸이 경고색이 된다
    await expect(panel.getByTestId("preview-outdated")).toContainText("이전 버전");
    await expect(panel.getByRole("button", { name: "Approve in Studio" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Request changes" })).toBeDisabled();
    await expect(panel.getByTestId("review-blocked-reason")).toContainText("지금 돌고 있는 미리보기가 이전 커밋이다");
    await expect(panel.getByRole("button", { name: "Open Preview" })).toBeEnabled();
    await expect(page.getByTestId("next-action")).toBeHidden(); // 패널이 열려 있는 동안 Work details 자리는 패널이다
    await panel.getByTestId("review-close").click();
    await expect(page.getByTestId("next-action")).toHaveAttribute("data-kind", "outdated_preview");
    await nav(page).getByRole("link", { name: "Workspace" }).click();
    // 새 커밋은 아직 판단하지 않았으니 검토 필요가 앞선 이유이고, 오래된 미리보기는 같은 줄의 두 번째 이유다 (업무 하나에 한 줄)
    const row = page.locator('[data-testid="attention-row"][data-work="d0e1f2"]');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-kind", "needs_review");
    await expect(row).toContainText("+1");
    await openWork(page, "d0e1f2");
    const again = await openReview(page, 710004, 12);
    await again.getByRole("button", { name: "Stop Preview" }).click();
    await expect(again.getByTestId("preview-phase")).toHaveText("Stopped");
  });
});
