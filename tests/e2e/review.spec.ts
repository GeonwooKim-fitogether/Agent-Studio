/**
 * Review 버튼 (docs/product/feature-plan.md F2). 첫 화면(Workspace, `/`)에서 출발해 클릭만으로 업무를 열고 결정을 남긴다.
 *
 * 시연 데이터의 결제 서비스 업무(로그인 화면 만들기)는 payments#12 의 **이전 커밋**(9f8e7d6)에 대한 수정 요청을 이미 갖고 있고,
 * PR 의 지금 커밋은 3c4d5e6 이다 — "새 커밋이 온 뒤" 의 상황이다. 여기서 Approve 를 누르면 새 커밋의 결정이 생기고
 * 앞선 결정은 "이전 커밋에 대한 결정" 으로 남는다. 같은 업무의 payments#15 는 GitHub 에서 병합됐으므로 버튼이 비활성이다.
 *
 * 이 파일은 이름 순서상 마지막에 돈다. 앞 파일의 시험은 이 업무에 결정이 하나(시연 데이터)만 있다고 본다.
 */
import { expect, type Page, test } from "@playwright/test";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("Workspace 에서 업무를 열어 Approve · Request Changes 를 누르면 최신 커밋에 대한 결정이 보이고, GitHub 상태는 따로 그대로다", async ({
  page,
}) => {
  const serverErrors: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
  });

  await page.goto("/");
  await page.getByTestId("work-a1b2c3").getByRole("link", { name: "로그인 화면 만들기" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);

  const card = page.getByTestId("pr-card-710001-12");
  const decisions = card.getByTestId("review-decision");
  // 처음: 이전 커밋에 대한 결정 하나
  await expect(decisions).toHaveCount(1);
  await expect(decisions).toHaveAttribute("data-freshness", "outdated");
  await expect(decisions).toHaveText("Internal: changes requested · 수정 요청 · 커밋 9f8e7d6 · 이전 커밋에 대한 결정");
  await expect(card.getByTestId("approve-note")).toHaveText("내부 검토 완료 — GitHub 병합이 아니다");
  const githubBefore = await card.getByTestId("github-status").textContent();

  // Approve → 지금 커밋(3c4d5e6)에 대한 내부 검토 완료
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);
  const current = card.locator('[data-testid="review-decision"][data-freshness="current"]');
  await expect(current).toHaveText("Internal: review done · 내부 검토 완료 · 커밋 3c4d5e6");
  await expect(card.locator('[data-testid="review-decision"][data-freshness="outdated"]')).toContainText("커밋 9f8e7d6 · 이전 커밋에 대한 결정");
  // GitHub 줄은 한 글자도 바뀌지 않고, Studio 결정과 다른 줄에 있다 (계약 §5 · §8-5)
  await expect(card.getByTestId("github-status")).toHaveText(githubBefore ?? "");
  await expect(card.getByTestId("github-status")).toContainText("Open");
  await expect(card.getByTestId("github-status")).not.toContainText("Internal:");
  await page.screenshot({ fullPage: true });

  // 같은 커밋에 Request Changes → 그 커밋의 결정은 마지막 것 하나로 보인다
  await card.getByRole("button", { name: "Request Changes" }).click();
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("Internal: changes requested · 수정 요청 · 커밋 3c4d5e6");
  await expect(decisions).toHaveCount(2);

  // 병합된 PR 은 버튼을 숨기지 않고 비활성 + 이유
  const merged = page.getByTestId("pr-card-710001-15");
  await expect(merged.getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(merged.getByRole("button", { name: "Request Changes" })).toBeDisabled();
  await expect(merged.getByTestId("review-blocked-reason")).toHaveText("GitHub 에서 이미 병합된 PR 이라 내부 검토 결정을 새로 남기지 않는다.");

  // Workspace 로 돌아가도 같은 결정이 보인다
  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await expect(
    page.getByTestId("work-a1b2c3").getByTestId("pr-card-710001-12").locator('[data-testid="review-decision"][data-freshness="current"]'),
  ).toHaveText("Internal: changes requested · 수정 요청 · 커밋 3c4d5e6");
  expect(serverErrors).toEqual([]);
});
