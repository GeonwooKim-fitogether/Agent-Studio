/**
 * Review 패널 (docs/product/feature-plan.md F2, 결정 18 의 Q8 · Q11). 첫 화면(Workspace, `/`)에서 출발해 클릭만으로 업무를 열고 결정을 남긴다.
 *
 * 시연 데이터의 결제 서비스 업무(로그인 화면 만들기)는 payments#12 의 **이전 커밋**(9f8e7d6)에 대한 수정 요청을 이미 갖고 있고,
 * PR 의 지금 커밋은 3c4d5e6 이다 — "새 커밋이 온 뒤" 의 상황이다. 여기서 Approve in Studio 를 누르면 새 커밋의 결정이 생기고
 * 앞선 결정은 "이전 커밋에 대한 결정" 으로 남는다. 같은 업무의 payments#15 는 GitHub 에서 병합됐으므로 버튼이 비활성이다.
 * (검토 중에 새 커밋이 오는 경우는 자기 서버를 켜는 focus.spec 이 본다.)
 *
 * 순서 의존: 이 파일은 이름 순서상 thread · work-status 앞에 돈다. 뒤 파일들은 이 업무의 결정 개수를 보지 않는다.
 */
import { expect, test } from "@playwright/test";
import { openReview, openWork, watchServerErrors } from "./helpers";

test("Workspace 에서 업무를 열어 Approve in Studio · Request changes 를 남기면 본 커밋에 대한 결정이 보이고, GitHub 상태는 따로 그대로다", async ({
  page,
}) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await openWork(page, "a1b2c3");

  let panel = await openReview(page, 710001, 12);
  const decisions = panel.getByTestId("review-decision");
  // 처음: 이전 커밋에 대한 결정 하나
  await expect(decisions).toHaveCount(1);
  await expect(decisions).toHaveAttribute("data-freshness", "outdated");
  await expect(decisions).toHaveText("Internal: changes requested · 수정 요청 · 커밋 9f8e7d6 · 이전 커밋에 대한 결정");
  await expect(panel.getByTestId("approve-note")).toContainText("내부 검토 완료 — GitHub 병합이 아니다");
  await expect(panel.getByTestId("approve-note")).toContainText("Studio 에만 기록된다. GitHub 리뷰 · 병합은 GitHub 에서 한다.");
  await expect(panel.getByTestId("viewed-sha")).toHaveValue("3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d"); // 본 커밋을 폼에 싣는다
  const githubBefore = await panel.getByTestId("github-status").textContent();

  // Approve in Studio → 지금 커밋(3c4d5e6)에 대한 내부 검토 완료. 패널은 닫히고 타임라인의 결정 줄로 간다
  await panel.getByRole("button", { name: "Approve in Studio" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3#decision-/);
  await expect(page.getByTestId("timeline").locator('[data-kind="review"]').last()).toContainText("커밋 3c4d5e6 에 Approve in Studio");
  panel = await openReview(page, 710001, 12);
  const current = panel.locator('[data-testid="review-decision"][data-freshness="current"]');
  await expect(current).toHaveText("Internal: review done · 내부 검토 완료 · 커밋 3c4d5e6");
  await expect(panel.locator('[data-testid="review-decision"][data-freshness="outdated"]')).toContainText("커밋 9f8e7d6 · 이전 커밋에 대한 결정");
  // GitHub 줄은 한 글자도 바뀌지 않고, Studio 결정과 다른 줄에 있다 (계약 §5 · §8-5)
  await expect(panel.getByTestId("github-status")).toHaveText(githubBefore ?? "");
  await expect(panel.getByTestId("github-status")).toContainText("Open");
  await expect(panel.getByTestId("github-status")).not.toContainText("Internal:");
  await page.screenshot({ fullPage: true });

  // Request changes 는 Reason 과 Done when 이 모두 있어야 남는다 — 빈 칸이면 서버가 거절하고 이유를 보인다
  await panel.getByRole("button", { name: "Request changes" }).click();
  await expect(page).toHaveURL(/review=710001:12&problem=reason_missing/);
  panel = page.getByTestId("review-panel");
  await expect(panel.getByTestId("review-problem")).toHaveText("Request changes 에는 Reason(무엇이 왜 문제인가)이 필요하다.");
  await panel.getByRole("textbox", { name: "Reason" }).fill("오류 문구가 입력칸 위아래에 두 번 보인다");
  await panel.getByRole("button", { name: "Request changes" }).click();
  await expect(panel.getByTestId("review-problem")).toHaveText("Request changes 에는 Done when(무엇이 되면 수정이 끝나나)이 필요하다.");
  await expect(panel.getByRole("textbox", { name: "Reason" })).toHaveValue("오류 문구가 입력칸 위아래에 두 번 보인다"); // 적은 이유는 되살린다
  await expect(current).toHaveText("Internal: review done · 내부 검토 완료 · 커밋 3c4d5e6"); // 아직 아무것도 남지 않았다
  await panel.getByRole("textbox", { name: "Done when" }).fill("오류 문구가 입력칸 아래에 한 번만 보인다");
  await panel.getByRole("button", { name: "Request changes" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3#decision-/);

  // 같은 커밋의 결정은 마지막 것 하나로 보이고, 타임라인에 이유 · 수정 기준 · 본 커밋이 남는다
  const line = page.getByTestId("timeline").locator('[data-kind="review"]').last();
  await expect(line).toContainText("커밋 3c4d5e6 에 Request changes");
  await expect(line.getByTestId("decision-reason")).toHaveText("오류 문구가 입력칸 위아래에 두 번 보인다");
  await expect(line.getByTestId("decision-done-when")).toHaveText("오류 문구가 입력칸 아래에 한 번만 보인다");
  await expect(line.getByTestId("decision-commit")).toHaveText("3c4d5e6");
  await expect(page.getByTestId("pr-card-710001-12").getByTestId("studio-status")).toContainText("Internal: changes requested");
  panel = await openReview(page, 710001, 12);
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("Internal: changes requested · 수정 요청 · 커밋 3c4d5e6");
  await expect(decisions).toHaveCount(2);
  await expect(panel.getByRole("textbox", { name: "Reason" })).toHaveValue(""); // 남긴 뒤에는 되살리지 않는다
  await panel.getByTestId("review-close").click();

  // 병합된 PR 은 버튼을 숨기지 않고 비활성 + 이유
  const merged = await openReview(page, 710001, 15);
  await expect(merged.getByRole("button", { name: "Approve in Studio" })).toBeDisabled();
  await expect(merged.getByRole("button", { name: "Request changes" })).toBeDisabled();
  await expect(merged.getByTestId("review-blocked-reason")).toHaveText("GitHub 에서 이미 병합된 PR 이라 내부 검토 결정을 새로 남기지 않는다.");
  expect(serverErrors).toEqual([]);
});
