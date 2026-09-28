/**
 * 업무 Chat (docs/product/feature-plan.md F7, 시안 v2 의 2.5단계). 첫 화면(Workspace, `/`)에서 출발해 클릭만으로 간다.
 *
 * 순서 의존: 이 파일은 이름 순서상 두 번째(attention 다음)에 돈다. 뒤 파일들이 시연 데이터 그대로를 기대하므로 여기서는
 * 상태를 거의 바꾸지 않는다. 바꾸는 것은 하나뿐이다 — '관리자 로그인 보안 점검'(d0e1f2) 의 admin-console#12 최신 카드에서
 * Approve 를 한 번 더 누른다. 이 PR 의 최신 커밋에는 시연 데이터부터 이미 Approve(내부 검토 완료)가 있어, 그 커밋의 결정도
 * 업무 상태(In progress)도 바뀌지 않는다(뒤의 inbox-to-work · preview · work-status 가 보는 모습 그대로다).
 * 결제 서비스 업무(a1b2c3)는 읽기만 한다 — review.spec 이 그 업무의 결정이 시연 데이터 하나뿐이라고 본다.
 */
import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** 보고용 화면을 따로 남기고 싶을 때만 CHAT_SHOTS 폴더에 저장한다(평소 실행은 작업 트리를 더럽히지 않는다) */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.CHAT_SHOTS;
  await page.screenshot(dir === undefined ? { fullPage: true } : { path: join(dir, name), fullPage: true });
}

function watchServerErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

test("Workspace 에서 업무를 열면 같은 주소에서 Chat 배치다 — 채널 목록 · 머리 · 커밋별 카드가 쌓인 타임라인, 버튼은 최신 카드에만", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await expect(nav(page).getByRole("link")).toHaveText(["Workspace", "Chat", "Inbox"]);
  await page.getByTestId("work-a1b2c3").getByRole("link", { name: "로그인 화면 만들기" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);
  await expect(nav(page).getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");

  // 왼쪽 채널 목록: 프로젝트 > 업무, 지금 채널 표시, 상태
  const channels = page.getByRole("navigation", { name: "Channels" });
  await expect(channels.getByRole("heading", { name: "결제 서비스" })).toBeVisible();
  await expect(channels.getByTestId("channel-a1b2c3")).toHaveAttribute("aria-current", "page");
  await expect(channels.getByTestId("channel-a1b2c3")).toContainText("In progress");
  await expect(channels.getByTestId("channel-d0e1f2")).toContainText("관리자 로그인 보안 점검");

  // 머리: 제목 · 상태 · 표식 Copy · 상태 이력
  await expect(page.getByRole("heading", { level: 1, name: "로그인 화면 만들기" })).toBeVisible();
  await expect(page.locator(".work-head").getByTestId("status-badge")).toHaveText("In progress");
  await expect(page.getByTestId("work-marker")).toHaveText("studio-work-a1b2c3");
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
  await expect(page.getByTestId("status-box").getByTestId("status-history")).toBeVisible();

  // 타임라인: 첫 줄은 기록이 언제부터인지 정직하게, 그다음 날짜 구분과 출처가 붙은 줄들
  const timeline = page.getByTestId("timeline");
  await expect(timeline.getByTestId("record-start")).toContainText("이 업무의 기록은");
  await expect(timeline.getByTestId("record-start")).toContainText("부터 남는다");
  await expect(timeline.getByTestId("day").first()).toBeVisible();
  await expect(timeline.locator('[data-kind="work_created"]')).toContainText("업무를 만들었다");
  await expect(timeline.locator('[data-kind="linked"]').first()).toContainText("Linked by marker");
  await expect(timeline.locator('[data-kind="linked"]').first().getByTestId("event-owner")).toHaveText("Studio");
  await expect(timeline.locator('[data-kind="review"]')).toContainText("커밋 9f8e7d6 에 Request Changes");

  // payments#12: 검토 결정이 가리키는 이전 커밋(9f8e7d6)의 카드는 흐린 기록이고 버튼이 없다. 최신 카드(3c4d5e6)에만 버튼이 있다
  const old = timeline.getByTestId("pr-card-old-710001-12-9f8e7d6");
  await expect(old).toContainText("이전 커밋");
  await expect(old.getByTestId("old-card-note")).toHaveText("이전 커밋의 기록이다. 버튼은 최신 카드(3c4d5e6)에서만 누른다.");
  await expect(old.getByRole("button")).toHaveCount(0);
  const latest = timeline.getByTestId("pr-card-710001-12");
  await expect(latest).toContainText("최신 커밋");
  await expect(latest.getByRole("button", { name: "Approve" })).toBeEnabled();
  await expect(latest.getByRole("button", { name: "Request Changes" })).toBeEnabled();
  await expect(latest.getByRole("button", { name: "Open Preview" })).toBeDisabled(); // 이 서버에는 미리보기 기기가 없다 — 이유가 옆에 보인다
  await expect(latest.getByRole("button", { name: "Unlink" })).toBeVisible();
  // 병합된 payments#15 는 카드가 하나(최신)이고 Review 버튼은 비활성 + 이유 (결정 16-2)
  const merged = timeline.getByTestId("pr-card-710001-15");
  await expect(merged.getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(merged.getByTestId("review-blocked-reason")).toContainText("이미 병합된");

  // 메모 입력칸(F8)은 있고 Reply(F9 스레드)는 아직 없다 — 동작하지 않는 칸을 두지 않는다(결정 7). 메모 자체는 memo.spec 이 본다
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reply" })).toHaveCount(0);
  await shot(page, "chat-desktop.png");
  expect(serverErrors).toEqual([]);
});

test("채널을 눌러 다른 업무로 가고, 최신 카드의 Approve 가 동작해 타임라인 끝에 Studio 줄로 쌓인다. 메뉴의 Chat 은 마지막에 연 업무를 다시 연다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  // 기억한 업무가 없으면 Chat 은 Workspace 의 첫 업무를 연다
  await nav(page).getByRole("link", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);

  await page.getByRole("navigation", { name: "Channels" }).getByTestId("channel-d0e1f2").click();
  await expect(page).toHaveURL(/\/works\/d0e1f2$/);
  await expect(page.getByRole("heading", { level: 1, name: "관리자 로그인 보안 점검" })).toBeVisible();
  const timeline = page.getByTestId("timeline");
  const reviewLines = timeline.locator('[data-kind="review"]');
  const before = await reviewLines.count();

  const card = timeline.getByTestId("pr-card-710004-12");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page).toHaveURL(/\/works\/d0e1f2$/);
  await expect(reviewLines).toHaveCount(before + 1);
  const last = reviewLines.last();
  await expect(last).toContainText("demo-org/admin-console#12");
  await expect(last).toContainText("에 Approve — Internal: review done");
  await expect(last.getByTestId("event-owner")).toHaveText("Studio");
  await expect(timeline.getByTestId("pr-card-710004-12").getByTestId("studio-status")).toContainText("Internal: review done");
  await expect(page.locator(".work-head").getByTestId("status-badge")).toHaveText("In progress");

  // Workspace 로 갔다가 Chat 을 누르면 마지막에 연 업무로 돌아온다
  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  await nav(page).getByRole("link", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/works\/d0e1f2$/);
  expect(serverErrors).toEqual([]);
});

test.describe("휴대전화 폭", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("채널 목록은 숨고 타임라인이 보인다. ‹ Channels 로 채널 목록을 열고, 채널을 누르면 그 업무의 타임라인으로 간다", async ({ page }) => {
    const serverErrors = watchServerErrors(page);
    await page.goto("/");
    await page.getByTestId("work-a1b2c3").getByRole("link", { name: "로그인 화면 만들기" }).click();
    await expect(page).toHaveURL(/\/works\/a1b2c3$/);
    const channels = page.getByRole("navigation", { name: "Channels" });
    await expect(channels).toBeHidden();
    await expect(page.getByTestId("timeline")).toBeVisible();
    await expect(page.getByTestId("pr-card-710001-12")).toBeVisible();
    await shot(page, "chat-phone-timeline.png");

    await page.getByRole("link", { name: "‹ Channels" }).click();
    await expect(channels).toBeVisible();
    await expect(page.getByTestId("timeline")).toBeHidden();
    await shot(page, "chat-phone-channels.png");

    await channels.getByTestId("channel-b4c5d6").click();
    await expect(page).toHaveURL(/\/works\/b4c5d6$/);
    await expect(channels).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "코치 로그인 개편" })).toBeVisible();
    await expect(page.getByTestId("timeline")).toBeVisible();
    expect(serverErrors).toEqual([]);
  });
});
