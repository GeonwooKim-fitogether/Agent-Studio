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
  await shot(page, "04-preview-not-connected.png");
});
