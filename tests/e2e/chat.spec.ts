/**
 * 업무 화면 = 업무 Chat (docs/product/feature-plan.md F7, 결정 18 의 Focus 배치). 첫 화면(Workspace, `/`)에서 출발해 클릭만으로 간다.
 *
 * 순서 의존: 이 파일은 이름 순서상 두 번째(attention 다음)에 돈다. 뒤 파일들이 시연 데이터 그대로를 기대하므로 여기서는
 * 상태를 거의 바꾸지 않는다. 바꾸는 것은 하나뿐이다 — '관리자 로그인 보안 점검'(d0e1f2) 의 admin-console#12 Review 패널에서
 * Approve in Studio 를 한 번 더 누른다. 이 PR 의 최신 커밋에는 시연 데이터부터 이미 Approve(내부 검토 완료)가 있어, 그 커밋의 결정도
 * 업무 상태(In progress)도 바뀌지 않는다(뒤의 inbox-to-work · preview · work-status 가 보는 모습 그대로다).
 * 결제 서비스 업무(a1b2c3)는 읽기만 한다 — review.spec 이 그 업무의 결정이 시연 데이터 하나뿐이라고 본다.
 */
import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { nav, openReview, openWork, watchServerErrors } from "./helpers";

/** 보고용 화면을 따로 남기고 싶을 때만 CHAT_SHOTS 폴더에 저장한다(평소 실행은 작업 트리를 더럽히지 않는다) */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.CHAT_SHOTS;
  await page.screenshot(dir === undefined ? { fullPage: true } : { path: join(dir, name), fullPage: true });
}

test("Workspace 에서 업무를 열면 목표 · 타임라인 · 결과 카드 · Next action 이 한 화면에 있고, 결정 버튼은 최신 커밋의 Review 패널에만 있다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await expect(nav(page).getByRole("link")).toHaveText(["Workspace", "Chat", /^Inbox/]);
  await openWork(page, "a1b2c3");
  await expect(nav(page).getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
  // 왼쪽 채널 목록 열은 없다 — 사이드바의 Projects 와 Workspace 가 그 역할이다 (Q6)
  await expect(page.getByRole("navigation", { name: "Channels" })).toHaveCount(0);

  // 머리: 프로젝트 · 제목 · 상태. 목표는 대화 위에 고정되고, 비어 있으면 Set goal
  await expect(page.getByRole("heading", { level: 1, name: "로그인 화면 만들기" })).toBeVisible();
  await expect(page.locator(".work-head").getByTestId("status-badge")).toHaveText("In progress");
  await expect(page.getByTestId("goal")).toContainText("The goal");
  await expect(page.getByTestId("goal-edit")).toHaveText("Set goal");
  // Work details: Next action(검사 실패 — 작성자가 고칠 차례) · 속성 · 상태 이력 · Link a PR(표식 · Copy)
  const next = page.getByTestId("next-action");
  await expect(next).toHaveAttribute("data-kind", "checks_failing");
  await expect(next.getByTestId("next-action-button")).toHaveText(/Open review/);
  await expect(next.getByTestId("host-offline-note")).toHaveText("Preview host offline — 미리보기 없이 GitHub 에서 확인한다.");
  await expect(page.getByTestId("work-properties")).toContainText("demo-org/payments#12");
  await expect(page.getByTestId("status-box").getByTestId("status-history")).toBeVisible();
  await page.getByText("Link a PR").click();
  await expect(page.getByTestId("work-marker")).toHaveText("studio-work-a1b2c3");
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();

  // 타임라인: 첫 줄은 기록이 언제부터인지(작은 한 줄), 그다음 날짜 구분과 출처가 붙은 작은 줄들
  const timeline = page.getByTestId("timeline");
  await expect(timeline.getByTestId("record-start")).toContainText("기록 시작 · ");
  await expect(timeline.getByTestId("record-start")).toContainText("KST");
  await expect(timeline.getByTestId("day").first()).toBeVisible();
  await expect(timeline.locator('[data-kind="work_created"]')).toContainText("업무를 만들었다");
  await expect(timeline.locator('[data-kind="linked"]').first()).toContainText("Linked by marker");
  await expect(timeline.locator('[data-kind="linked"]').first().getByTestId("event-owner")).toHaveText("Studio");
  await expect(timeline.locator('[data-kind="review"]')).toContainText("커밋 9f8e7d6 에 Request changes");

  // payments#12: 검토 결정이 가리키는 이전 커밋(9f8e7d6)의 카드는 한 줄로 접힌 기록이고 버튼이 없다. 최신 카드(3c4d5e6)에만 Open review 가 있다
  const old = timeline.getByTestId("pr-card-old-710001-12-9f8e7d6");
  await expect(old).toContainText("이전 커밋");
  await expect(old.getByRole("link")).toHaveCount(0);
  await expect(old.getByRole("button", { name: /Approve|Request|Preview|Unlink/ })).toHaveCount(0);
  const latest = timeline.getByTestId("pr-card-710001-12");
  await expect(latest).toContainText("최신 커밋");
  await expect(latest.getByTestId("github-status")).toContainText("Open");
  await expect(latest.getByTestId("github-status")).not.toContainText("Internal:");
  await expect(latest.getByTestId("studio-status")).toHaveCount(0); // 최신 커밋에 결정이 없으면 Studio 줄이 없다 — 설명 문장을 두지 않는다 (결정 18)
  await expect(latest.getByRole("button")).toHaveCount(0); // 카드에는 버튼을 늘어놓지 않는다 — 결정은 Review 패널에서 (Q7)
  await shot(page, "chat-desktop.png");

  const panel = await openReview(page, 710001, 12);
  await expect(page).toHaveURL(/\?review=710001:12#review$/);
  await expect(panel.getByTestId("review-commit")).toHaveText("3c4d5e6");
  await expect(panel.getByRole("button", { name: "Approve in Studio" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Request changes" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Open Preview" })).toBeDisabled(); // 이 서버에는 미리보기 기기가 없다 — 이유가 옆에 보인다
  await expect(panel.getByTestId("host-offline-note")).toBeVisible(); // 그래도 검토는 막지 않는다 (Q10)
  await expect(panel.getByRole("button", { name: "Unlink" })).toBeVisible();
  await panel.getByTestId("review-close").click();
  await expect(page.getByTestId("review-panel")).toHaveCount(0);

  // 병합된 payments#15 는 카드가 하나(최신)이고 결정 버튼은 비활성 + 이유 (결정 16-2)
  const merged = await openReview(page, 710001, 15);
  await expect(merged.getByRole("button", { name: "Approve in Studio" })).toBeDisabled();
  await expect(merged.getByTestId("review-blocked-reason")).toContainText("이미 병합된");
  await merged.getByTestId("review-close").click();

  // 메모 입력칸(F8)이 있다. Reply 는 버튼이 아니라 링크(F9 스레드)다 — 메모 자체는 memo.spec, 스레드는 thread.spec 이 본다
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply" })).toHaveCount(0);
  expect(serverErrors).toEqual([]);
});

test("Workspace 에서 다른 업무로 가고, Review 패널의 Approve in Studio 가 동작해 타임라인 끝에 Studio 줄로 쌓인다. 메뉴의 Chat 은 마지막에 연 업무를 다시 연다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  // 기억한 업무가 없으면 Chat 은 Workspace 의 첫 업무를 연다
  await nav(page).getByRole("link", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);

  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await openWork(page, "d0e1f2");
  await expect(page.getByRole("heading", { level: 1, name: "관리자 로그인 보안 점검" })).toBeVisible();
  const timeline = page.getByTestId("timeline");
  const reviewLines = timeline.locator('[data-kind="review"]');
  const before = await reviewLines.count();

  const panel = await openReview(page, 710004, 12);
  await panel.getByRole("button", { name: "Approve in Studio" }).click();
  await expect(page).toHaveURL(/\/works\/d0e1f2#decision-/);
  await expect(page.getByTestId("review-panel")).toHaveCount(0);
  await expect(reviewLines).toHaveCount(before + 1);
  const last = reviewLines.last();
  await expect(last).toContainText("demo-org/admin-console#12");
  await expect(last).toContainText("에 Approve in Studio — Internal: review done");
  await expect(last.getByTestId("event-owner").first()).toHaveText("Studio");
  await expect(timeline.getByTestId("pr-card-710004-12").getByTestId("studio-status")).toContainText("Internal: review done");
  await expect(page.locator(".work-head").getByTestId("status-badge")).toHaveText("In progress");
  // 승인 뒤의 할 일은 GitHub 병합을 기다리는 것이다 — Studio 의 승인은 GitHub 병합이 아니다
  await expect(page.getByTestId("next-action")).toHaveAttribute("data-kind", "set_goal");

  // Workspace 로 갔다가 Chat 을 누르면 마지막에 연 업무로 돌아온다
  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  await nav(page).getByRole("link", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/works\/d0e1f2(#.*)?$/);
  expect(serverErrors).toEqual([]);
});

test.describe("휴대전화 폭", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("사이드바 대신 아래쪽 탭이 있고, attention 줄을 누르면 곧바로 업무 화면이다. 목표 바로 아래의 Next action 버튼이 첫 화면 안에 보인다", async ({ page }) => {
    const serverErrors = watchServerErrors(page);
    await page.goto("/");
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();
    await expect(nav(page).getByRole("link")).toHaveText(["Workspace", "Chat", /^Inbox/, "Connections"]);
    await expect(page.getByTestId("up-next")).toBeHidden(); // 휴대전화 폭에는 Up next 패널이 없다
    await openWork(page, "a1b2c3");
    const button = page.getByTestId("next-action").getByTestId("next-action-button");
    await expect(button).toBeInViewport();
    const [goal, next] = [await page.getByTestId("goal").boundingBox(), await page.getByTestId("next-action").boundingBox()];
    expect(next!.y).toBeGreaterThan(goal!.y); // 목표 바로 아래
    await expect(page.getByTestId("work-properties")).toBeHidden(); // 속성은 Details 로 접혀 있다
    await shot(page, "chat-phone-timeline.png");

    await page.getByTestId("details-toggle").click();
    await expect(page.getByTestId("work-properties")).toBeVisible();
    await expect(page.getByTestId("timeline")).toBeVisible();

    // Review 패널은 화면 전체를 덮는다
    await button.click();
    const panel = page.getByTestId("review-panel");
    expect(await panel.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await expect(panel.getByRole("button", { name: "Approve in Studio" })).toBeVisible();
    await panel.getByTestId("review-close").click();

    // 아래쪽 탭으로 Workspace 에 돌아가 다른 업무를 연다
    await nav(page).getByRole("link", { name: "Workspace" }).click();
    await openWork(page, "b4c5d6");
    await expect(page.getByRole("heading", { level: 1, name: "코치 로그인 개편" })).toBeVisible();
    await expect(page.getByTestId("timeline")).toBeVisible();
    expect(serverErrors).toEqual([]);
  });
});
