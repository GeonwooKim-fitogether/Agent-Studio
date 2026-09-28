/**
 * 스레드 (docs/product/feature-plan.md F9, 시안 v2 renderChat 의 thread 패널). 첫 화면(Workspace, `/`)에서 출발해 클릭만으로 간다.
 *
 * 순서 의존: 이 파일은 이름 순서상 review 다음, work-status 앞에 돈다. 바꾸는 것은 '로그인 화면 만들기'(a1b2c3) 업무의
 * 메모 · 답글뿐이다(마지막 시험은 그 메모를 지운다) — review.spec(그 업무의 검토 결정)은 이미 끝났고, 뒤의 work-status.spec 은 업무 상태 · PR 카드만 보고
 * 메모 · 답글은 보지 않는다. 이 파일 안의 시험은 차례로 돌고, 앞 시험이 남긴 메모 · 답글을 뒤 시험이 이어서 쓴다.
 *
 * 시연 데이터의 payments#12 에는 이전 커밋(9f8e7d6) 카드와 최신 커밋(3c4d5e6) 카드가 있다. 새 답글은 최신 카드에만 달고,
 * 최신 카드에 단 답글은 이전 커밋 카드에 섞이지 않는다. (새 커밋이 와서 옛 답글이 옛 카드에 남는 것은 고정 데이터에 새 커밋이
 * 오지 않으므로 여기서 재현하지 못한다 — tests/unit/thread.test.ts 가 Sync 로 새 커밋을 흘려 본다.)
 */
import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { openWork, watchServerErrors } from "./helpers";

const LATEST = "card-foot-710001-12-3c4d5e6";
const OLD = "card-foot-710001-12-9f8e7d6";

/** 보고용 화면을 따로 남기고 싶을 때만 CHAT_SHOTS 폴더에 저장한다 */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.CHAT_SHOTS;
  if (dir !== undefined) await page.screenshot({ path: join(dir, name), fullPage: false });
}

async function openLoginWork(page: Page): Promise<void> {
  await page.goto("/");
  await openWork(page, "a1b2c3");
}

const memos = (page: Page) => page.getByTestId("timeline").locator('[data-kind="memo"]');
const thread = (page: Page) => page.getByRole("complementary", { name: "Thread" });

test("메모의 Reply 로 오른쪽 스레드를 열고, 답글을 달고, 닫는다. 답글은 메인 타임라인에 없고 메모에 '답글 N' 이 붙는다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await openLoginWork(page);
  await expect(thread(page)).toHaveCount(0);
  const composer = page.getByTestId("memo-composer");
  await composer.getByRole("textbox", { name: "Memo" }).fill("로그인 문구를 스레드에서 정리한다");
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(memos(page)).toHaveCount(1);
  const memo = memos(page).first();
  await expect(memo.getByTestId("reply-count")).toHaveCount(0); // 답글이 없으면 개수도 없다

  await memo.getByRole("link", { name: "Reply" }).click();
  await expect(page).toHaveURL(/\?thread=memo%3Am[a-z0-9]+#memo-m/);
  const panel = thread(page);
  await expect(panel.getByRole("heading", { name: "Thread" })).toBeVisible();
  await expect(panel.getByTestId("thread-title")).toHaveText("메모");
  await expect(panel.getByTestId("thread-root")).toHaveText("로그인 문구를 스레드에서 정리한다");
  await expect(panel.getByTestId("no-replies")).toHaveText("아직 답글이 없다.");
  const box = panel.getByRole("textbox", { name: "Reply" });
  await expect(box).toHaveAttribute("placeholder", "답글을 남긴다");
  await expect(panel.getByTestId("reply-composer")).toContainText("답글도 AI 에게 전달되지 않는다.");

  // 넓은 화면: 타임라인과 스레드가 나란히 (스레드는 오른쪽, Work details 자리)
  const [tl, side] = [await page.getByRole("region", { name: "Timeline" }).boundingBox(), await panel.boundingBox()];
  expect(side!.x).toBeGreaterThanOrEqual(tl!.x + tl!.width - 1);

  await box.fill("\"인증 코드\" 로 통일");
  await panel.getByRole("button", { name: "Reply" }).click();
  await expect(panel.getByTestId("reply")).toHaveCount(1);
  await box.fill("OTP 표기는 쓰지 않는다");
  await box.press("Enter"); // 자바스크립트가 있으면 Enter 로 보낸다
  await expect(panel.getByTestId("reply")).toHaveCount(2);
  await expect(panel.getByTestId("reply").getByTestId("memo-body")).toHaveText(['"인증 코드" 로 통일', "OTP 표기는 쓰지 않는다"]);
  await expect(panel.getByTestId("reply").first().locator(".by")).toHaveText("나답글");
  await expect(panel.getByTestId("reply").getByRole("link", { name: "Reply" })).toHaveCount(0); // 한 단계만 — 답글에는 Reply 가 없다
  await expect(panel.getByTestId("no-replies")).toHaveCount(0);

  // 메인 타임라인에는 답글이 없고, 메모에 개수가 붙는다
  await expect(memos(page)).toHaveCount(1);
  await expect(page.getByTestId("timeline")).not.toContainText("OTP 표기는 쓰지 않는다");
  await expect(memo.getByTestId("reply-count")).toHaveText("답글 2");
  await shot(page, "thread-desktop.png");

  // 빈 답글은 남지 않고 이유가 스레드 입력칸에 보인다
  await box.fill("   ");
  await panel.getByRole("button", { name: "Reply" }).click();
  await expect(panel.getByTestId("reply-problem")).toContainText("메모가 비어 있다");
  await expect(panel.getByTestId("reply")).toHaveCount(2);

  // 답글 고치기 — 스레드 안에서 Edit · Save 하고 스레드에 머문다
  await panel.getByTestId("reply").nth(1).getByRole("link", { name: "Edit" }).click();
  await panel.getByRole("textbox", { name: "Edit memo" }).fill("OTP 표기는 화면에서 뺀다");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(thread(page).getByTestId("reply").nth(1).getByTestId("memo-body")).toHaveText("OTP 표기는 화면에서 뺀다");
  await expect(thread(page).getByTestId("reply").nth(1).getByTestId("memo-edited")).toHaveText("고침");

  // Close → 스레드가 닫히고 개수는 남는다. '답글 2' 로 다시 연다
  await thread(page).getByRole("link", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3#memo-m/);
  await expect(thread(page)).toHaveCount(0);
  await expect(memo.getByTestId("reply-count")).toHaveText("답글 2");
  await memo.getByTestId("reply-count").click();
  await expect(thread(page).getByTestId("reply")).toHaveCount(2);
  await page.reload(); // 다시 열어도 남는다
  await expect(thread(page).getByTestId("reply")).toHaveCount(2);
  expect(serverErrors).toEqual([]);
});

test("PR 카드의 Reply 는 최신 커밋 카드에만 있고, 그 커밋의 카드에 답글이 붙는다. 이전 커밋 카드에는 섞이지 않는다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await openLoginWork(page);
  const timeline = page.getByTestId("timeline");
  await expect(timeline.getByTestId(OLD).getByRole("link")).toHaveCount(0); // 이전 커밋 카드에는 Reply 를 반복하지 않는다(결정 16-5)
  await expect(timeline.getByTestId(LATEST).getByTestId("reply-count")).toHaveCount(0);

  await timeline.getByTestId(LATEST).getByRole("link", { name: "Reply" }).click();
  await expect(page).toHaveURL(/\?thread=card%3A710001%3A12%3A3c4d5e6f[0-9a-f]+#card-710001-12-3c4d5e6/);
  const panel = thread(page);
  await expect(panel.getByTestId("thread-title")).toHaveText("demo-org/payments#12 · 3c4d5e6");
  await expect(panel.getByTestId("thread-root")).toContainText("커밋 3c4d5e6");
  await expect(panel.getByTestId("thread-root")).toContainText("이 스레드는 이 커밋의 카드에 붙는다. 새 커밋이 오면 새 카드에서 새 스레드가 시작된다.");
  await expect(panel.getByTestId("no-replies")).toBeVisible();

  await panel.getByRole("textbox", { name: "Reply" }).fill("미리보기에서 코드 입력칸이 6칸인지 확인한다");
  await panel.getByRole("button", { name: "Reply" }).click();
  await expect(panel.getByTestId("reply")).toHaveCount(1);
  await expect(timeline.getByTestId(LATEST).getByTestId("reply-count")).toHaveText("답글 1");
  await expect(timeline.getByTestId(OLD).getByTestId("reply-count")).toHaveCount(0); // 옛 카드의 스레드는 옛 카드 것이다
  await expect(timeline.getByTestId(OLD).getByRole("link")).toHaveCount(0);
  await expect(timeline).not.toContainText("코드 입력칸이 6칸인지"); // 메인 타임라인에는 없다

  await panel.getByRole("link", { name: "Close" }).click();
  await expect(thread(page)).toHaveCount(0);
  await expect(timeline.getByTestId(LATEST).getByTestId("reply-count")).toHaveText("답글 1");
  expect(serverErrors).toEqual([]);
});

test.describe("휴대전화 폭", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("스레드가 화면 전체를 덮고, Close 로 타임라인에 돌아온다", async ({ page }) => {
    const serverErrors = watchServerErrors(page);
    await openLoginWork(page);
    const memo = memos(page).first();
    await memo.getByTestId("reply-count").click();
    const panel = thread(page);
    await expect(panel.getByTestId("reply")).toHaveCount(2);
    expect(await panel.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await expect(panel.getByRole("link", { name: "Close" })).toBeInViewport();
    await expect(panel.getByRole("textbox", { name: "Reply" })).toBeInViewport();
    await shot(page, "thread-phone.png");
    await panel.getByRole("textbox", { name: "Reply" }).fill("휴대전화에서 단 답글");
    await panel.getByRole("button", { name: "Reply" }).click();
    await expect(thread(page).getByTestId("reply")).toHaveCount(3);
    await thread(page).getByRole("link", { name: "Close" }).click();
    await expect(thread(page)).toHaveCount(0);
    await expect(memo.getByTestId("reply-count")).toHaveText("답글 3");
    expect(serverErrors).toEqual([]);
  });
});

test.describe("자바스크립트 없이", () => {
  test.use({ javaScriptEnabled: false });

  test("Reply 로 스레드를 열고, 답글을 달고(Enter 는 줄바꿈), Close 로 닫는다", async ({ page }) => {
    const serverErrors = watchServerErrors(page);
    await openLoginWork(page);
    const timeline = page.getByTestId("timeline");
    await timeline.getByTestId(LATEST).getByRole("link", { name: "Reply" }).click();
    const panel = thread(page);
    await expect(panel.getByTestId("reply")).toHaveCount(1);
    const box = panel.getByRole("textbox", { name: "Reply" });
    await box.fill("자바스크립트 없이");
    await box.press("Enter"); // 보내지 않고 줄을 바꾼다
    await box.pressSequentially("단 답글");
    await panel.getByRole("button", { name: "Reply" }).click();
    await expect(thread(page).getByTestId("reply")).toHaveCount(2);
    await expect(thread(page).getByTestId("reply").nth(1).getByTestId("memo-body")).toHaveText("자바스크립트 없이\n단 답글");
    await thread(page).getByRole("link", { name: "Close" }).click();
    await expect(thread(page)).toHaveCount(0);
    await expect(timeline.getByTestId(LATEST).getByTestId("reply-count")).toHaveText("답글 2");

    // 답글이 달린 메모를 지우면 "지워진 메모" 자리에 '답글 3' 이 남고, 그 스레드는 읽기만 한다 (새 답글 입력칸 대신 이유 한 줄)
    const memo = memos(page).first();
    // 이 자리에서는 아래에 붙은 메모 입력칸이 마지막 메모의 Edit 을 가려 포인터가 닿지 않는다(2.5-B 부터의 배치). 키보드로 누른다
    await memo.getByRole("link", { name: "Edit" }).focus();
    await page.keyboard.press("Enter");
    await memo.getByRole("button", { name: "Delete" }).focus();
    await page.keyboard.press("Enter");
    await expect(memo.getByTestId("memo-deleted")).toBeVisible();
    await expect(memo.getByRole("link", { name: "Reply" })).toHaveCount(0);
    await memo.getByTestId("reply-count").click();
    await expect(thread(page).getByTestId("thread-root")).toHaveText("지워진 메모");
    await expect(thread(page).getByTestId("reply")).toHaveCount(3);
    await expect(thread(page).getByTestId("thread-closed")).toHaveText("지워진 메모의 스레드다. 남은 답글은 읽을 수 있고, 새 답글은 달지 않는다.");
    await expect(thread(page).getByRole("textbox", { name: "Reply" })).toHaveCount(0);
    expect(serverErrors).toEqual([]);
  });
});
