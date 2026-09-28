/**
 * 메모 쓰기 (docs/product/feature-plan.md F8, 시안 v2 의 composer · memo). 첫 화면(Workspace, `/`)에서 출발해 클릭만으로 간다.
 *
 * 순서 의존: 이 파일은 이름 순서상 inbox-to-work 다음, new-work 앞에 돈다. 바꾸는 것은 '코치 로그인 개편'(b4c5d6) 업무의 메모뿐이다.
 * 뒤의 파일들은 메모를 보지 않고(업무 · PR 카드 · 상태만 본다), 이 파일은 앞 파일이 그 업무에 무엇을 연결했든 메모 줄만 본다.
 * 메모는 서버 메모리(기본) 또는 PostgreSQL(E2E_STORAGE=postgres)에 남는다. 서버를 껐다 켠 뒤에도 남는지는 restart.spec 이 본다.
 */
import { expect, type Page, test } from "@playwright/test";
import { hydrated, openWork, watchServerErrors } from "./helpers";

async function openCoachWork(page: Page): Promise<void> {
  await page.goto("/");
  await openWork(page, "b4c5d6");
}

test("메모를 쓰면 타임라인에 '나' 와 시각과 함께 쌓이고, 새로 고쳐도 남는다. 고치면 '고침', 지우면 '지워진 메모' 자리만 남는다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await openCoachWork(page);
  const composer = page.getByTestId("memo-composer");
  await expect(composer.getByRole("textbox", { name: "Memo" })).toHaveAttribute("placeholder", "판단의 이유를 메모로 남긴다");
  // "AI 에게 전달되지 않는다" 는 본문이 아니라 입력칸의 title 로 있다 (결정 18)
  await expect(composer.getByRole("textbox", { name: "Memo" })).toHaveAttribute("title", "메모는 AI 에게 전달되지 않는다. 첫 버전은 나 혼자 보는 기록이다.");
  // 메모의 Reply · 스레드(F9)는 thread.spec 이 본다

  // Send 버튼으로 두 줄짜리 메모를 남긴다 (Shift+Enter 는 줄바꿈)
  const box = composer.getByRole("textbox", { name: "Memo" });
  await box.fill("로그인 화면 문구 다시 확인 필요.");
  await box.press("Shift+Enter");
  await box.pressSequentially("\"인증 코드\" 와 \"OTP\" 가 섞여 있다.");
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(page).toHaveURL(/\/works\/b4c5d6#memo-/);
  const memos = page.getByTestId("timeline").locator('[data-kind="memo"]');
  await expect(memos).toHaveCount(1);
  const first = memos.first();
  await expect(first.getByTestId("memo-body")).toHaveText('로그인 화면 문구 다시 확인 필요.\n"인증 코드" 와 "OTP" 가 섞여 있다.');
  await expect(first.locator(".by")).toHaveText("나메모");
  await expect(first.locator("time")).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.getByTestId("timeline").locator('[data-kind]').last()).toHaveAttribute("data-kind", "memo"); // 타임라인 끝에 쌓인다
  await expect(box).toHaveValue(""); // 입력칸은 비워진다

  // Enter 로 보내기 (자바스크립트가 있을 때)
  await box.fill("두 번째 메모");
  await box.press("Enter");
  await expect(memos).toHaveCount(2);
  await expect(memos.nth(1).getByTestId("memo-body")).toHaveText("두 번째 메모");

  // 빈 메모는 남지 않고 이유가 보인다 (공백만 — 브라우저의 required 는 공백을 막지 않는다)
  await box.fill("   ");
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("memo-problem")).toContainText("메모가 비어 있다");
  await expect(memos).toHaveCount(2);

  // 새로 고쳐도(다시 열어도) 남는다
  await openCoachWork(page);
  await page.reload();
  await expect(memos).toHaveCount(2);
  await expect(memos.first().getByTestId("memo-body")).toContainText("로그인 화면 문구 다시 확인 필요.");

  // 고치기: Edit → 본문을 바꿔 Save → '고침'
  await memos.first().getByRole("link", { name: "Edit" }).click();
  const editBox = memos.first().getByRole("textbox", { name: "Edit memo" });
  await expect(editBox).toHaveValue('로그인 화면 문구 다시 확인 필요.\n"인증 코드" 와 "OTP" 가 섞여 있다.');
  await hydrated(page);
  await editBox.fill("문구는 \"인증 코드\" 로 통일하기로.");
  await memos.first().getByRole("button", { name: "Save" }).click();
  await expect(memos.first().getByTestId("memo-body")).toHaveText('문구는 "인증 코드" 로 통일하기로.');
  await expect(memos.first().getByTestId("memo-edited")).toHaveText("고침");
  await expect(memos.nth(1).getByTestId("memo-edited")).toHaveCount(0);

  // Cancel 은 아무것도 바꾸지 않는다
  await memos.nth(1).getByRole("link", { name: "Edit" }).click();
  await hydrated(page);
  await memos.nth(1).getByRole("textbox", { name: "Edit memo" }).fill("저장하지 않을 글");
  await memos.nth(1).getByRole("link", { name: "Cancel" }).click();
  await expect(memos.nth(1).getByTestId("memo-body")).toHaveText("두 번째 메모");

  // 지우기: Edit 칸 안의 Delete → '지워진 메모' 자리만 남고, 더는 고칠 수 없다
  await memos.nth(1).getByRole("link", { name: "Edit" }).click();
  await memos.nth(1).getByRole("button", { name: "Delete" }).click();
  await expect(memos).toHaveCount(2);
  await expect(memos.nth(1).getByTestId("memo-deleted")).toHaveText("나메모지워진 메모");
  await expect(memos.nth(1)).not.toContainText("두 번째 메모");
  await expect(memos.nth(1).getByRole("link", { name: "Edit" })).toHaveCount(0);

  await page.reload();
  await expect(memos.first().getByTestId("memo-edited")).toBeVisible();
  await expect(memos.nth(1).getByTestId("memo-deleted")).toBeVisible();
  expect(serverErrors).toEqual([]);
});

test.describe("자바스크립트 없이", () => {
  test.use({ javaScriptEnabled: false });

  test("Send 로 메모가 남고(Enter 는 줄바꿈), Edit · Save 도 동작한다", async ({ page }) => {
    const serverErrors = watchServerErrors(page);
    await openCoachWork(page);
    const composer = page.getByTestId("memo-composer");
    const box = composer.getByRole("textbox", { name: "Memo" });
    await box.fill("자바스크립트 없이");
    await box.press("Enter"); // 보내지 않고 줄을 바꾼다
    await box.pressSequentially("남긴 메모");
    await composer.getByRole("button", { name: "Send" }).click();
    const last = page.getByTestId("timeline").locator('[data-kind="memo"]').last();
    await expect(last.getByTestId("memo-body")).toHaveText("자바스크립트 없이\n남긴 메모");

    await last.getByRole("link", { name: "Edit" }).click();
    await last.getByRole("textbox", { name: "Edit memo" }).fill("자바스크립트 없이 고친 메모");
    await last.getByRole("button", { name: "Save" }).click();
    await expect(last.getByTestId("memo-body")).toHaveText("자바스크립트 없이 고친 메모");
    await expect(last.getByTestId("memo-edited")).toHaveText("고침");
    expect(serverErrors).toEqual([]);
  });
});
