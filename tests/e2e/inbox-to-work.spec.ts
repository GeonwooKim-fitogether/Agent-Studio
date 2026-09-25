/**
 * 진입점(Workspace, `/`)에서 출발해 클릭만으로 가는 사용자 흐름 (docs/plan/01-pr-collection.md §4 "화면에서 확인할 수 있다").
 * 중간 화면에 주소를 직접 입력해 들어가지 않는다. 주소 입력은 첫 화면 `/` 뿐이다
 * (마지막 시험 하나만 "없는 업무 주소" 화면을 보려고 일부러 없는 주소를 연다).
 *
 * 시험들은 같은 서버(같은 메모리 저장소)를 차례로 쓴다. 각 시험은 서로 다른 Inbox PR 을 다룬다.
 *   1 coach-web#12 · 2 docs-site#12 · 3 player-app#9 · 4 player-app#12 · 5 남은 것 전부
 */
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";

const SHOTS = "docs/plan/screenshots";
const POSTGRES = process.env.E2E_STORAGE === "postgres";
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** 이 페이지에서 500 이상의 응답이 오면 모아 둔다. 시험 끝에 비어 있어야 한다. */
function watchServerErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function inboxCount(page: Page): Promise<number> {
  return Number(await page.getByTestId("inbox-count").textContent());
}

async function expectSeparateStateRows(card: Locator) {
  await expect(card.getByTestId("github-status")).toContainText("GitHub");
  await expect(card.getByTestId("studio-status")).toContainText("Studio");
}

/** 아직 만들지 않은 기능의 메뉴 · 버튼이 이 화면 어디에도 없다 (결정 7: 실행되지 않는 버튼을 두지 않는다) */
async function expectNoUnbuiltFeatures(page: Page) {
  const unbuilt = /^(Run|Open Preview|Chat|Flow|Agents)$/;
  await expect(page.getByRole("button", { name: unbuilt })).toHaveCount(0);
  await expect(page.getByRole("link", { name: unbuilt })).toHaveCount(0);
  await expect(page.getByText(unbuilt)).toHaveCount(0);
  await expect(nav(page).getByRole("link")).toHaveText(["Workspace", "Inbox"]);
}

test("Workspace 에서 Inbox 로 가서 PR 을 기존 업무에 연결하면, 업무 화면과 Workspace 에 PR 카드가 나타난다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Workspace" })).toBeVisible();
  await expectNoUnbuiltFeatures(page);

  // 데이터 출처, "다시 켜면 처음 상태", 한국 시간이 보인다
  const source = page.getByTestId("data-source");
  await expect(source).toContainText("Fixture data");
  if (POSTGRES) {
    await expect(page.getByTestId("storage-kind")).toHaveText("Stored in PostgreSQL");
    await expect(source).not.toContainText("서버를 다시 켜면 처음 상태로 돌아간다");
  } else {
    await expect(page.getByTestId("storage-kind")).toHaveText("Stored in memory");
    await expect(source).toContainText("서버를 다시 켜면 처음 상태로 돌아간다");
  }
  await expect(page.getByTestId("last-sync")).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} KST$/);
  await expect(page.getByTestId("state-legend")).toContainText("GitHub 에 반영되지 않는다");

  // 표식으로 붙은 PR: 표식을 찾은 자리가 보이고, 이전 커밋에 대한 결정은 이전 버전이다
  const payments = page.getByTestId("work-a1b2c3").getByTestId("pr-card-710001-12");
  await expectSeparateStateRows(payments);
  await expect(payments.getByTestId("link-origin")).toHaveText("Linked by marker (body)");
  await expect(page.getByTestId("work-a1b2c3").getByTestId("pr-card-710001-15").getByTestId("link-origin")).toHaveText(
    "Linked by marker (branch)",
  );
  await expect(payments.getByTestId("review-decision")).toHaveAttribute("data-freshness", "outdated");
  await expect(payments.getByTestId("review-decision")).toContainText("Internal: changes requested");
  // GitHub 리뷰와 Studio 결정의 글자가 다르다
  await expect(payments.getByTestId("github-status")).toContainText("Changes requested");
  await expect(payments.getByTestId("github-status")).not.toContainText("Internal:");

  // 내부 검토 완료여도 GitHub 쪽은 Open 이다 — 두 상태가 다른 줄에 있다
  const admin = page.getByTestId("work-d0e1f2").getByTestId("pr-card-710004-12");
  await expect(admin.getByTestId("studio-status")).toContainText("Internal: review done");
  await expect(admin.getByTestId("github-status")).toContainText("Open");
  await expect(admin.getByTestId("github-status")).not.toContainText("Internal:");
  await expect(page.getByTestId("work-d0e1f2")).toContainText("In progress");
  // 업무 제목은 hover 가 없는 휴대전화에서도 링크로 보이도록 늘 밑줄이 있다
  await expect(page.getByTestId("work-a1b2c3").getByRole("link", { name: "로그인 화면 만들기" })).toHaveCSS(
    "text-decoration-line",
    "underline",
  );

  const before = await inboxCount(page);
  await expect(page.getByTestId("pr-card-710002-12")).toHaveCount(0); // 아직 어느 업무에도 없다

  // 1. 클릭으로 Inbox 에 간다
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expectNoUnbuiltFeatures(page);
  await expect(page.getByTestId("marker-hint")).toContainText("다음 Sync 에서 그 업무에 자동으로 연결된다");
  await expect(page.getByTestId("state-legend")).toBeVisible();
  await expect(page.getByTestId("inbox-710003-12")).toContainText("다른 프로젝트('결제 서비스')");
  const item = page.getByTestId("inbox-710002-12");
  await expect(item).toContainText("업무 표식이 없어");
  await expect(item.getByLabel("Work").locator("option")).toContainText(["코치 로그인 개편 · studio-work-b4c5d6"]);
  await page.screenshot({ path: `${SHOTS}/01-inbox.png`, fullPage: true });

  // 2. 같은 프로젝트의 업무를 골라 Link to Work
  await item.getByLabel("Work").selectOption({ label: "코치 로그인 개편 · studio-work-b4c5d6" });
  await item.getByRole("button", { name: "Link to Work" }).click();

  // 3. 업무 화면에 PR 카드가 나타난다
  await expect(page).toHaveURL(/\/works\/b4c5d6$/);
  await expectNoUnbuiltFeatures(page);
  await expect(page.getByRole("heading", { level: 1, name: "코치 로그인 개편" })).toBeVisible();
  await expect(page.getByTestId("work-marker")).toHaveText("studio-work-b4c5d6");
  await expect(page.getByTestId("state-legend")).toBeVisible();
  const linked = page.getByTestId("pr-card-710002-12");
  await expect(linked.getByTestId("link-origin")).toHaveText("Linked manually");
  await expectSeparateStateRows(linked);
  await page.screenshot({ path: `${SHOTS}/02-work-after-link.png`, fullPage: true });

  // 4. 클릭으로 Workspace 에 돌아오면 그 업무 아래에 카드가 있고, Inbox 수는 하나 줄었다
  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("work-b4c5d6").getByTestId("pr-card-710002-12")).toBeVisible();
  expect(await inboxCount(page)).toBe(before - 1);
  await page.screenshot({ path: `${SHOTS}/03-workspace-after-link.png`, fullPage: true });

  // 5. Sync 로 다시 읽어도 사람이 만든 연결은 그대로다
  await page.getByRole("button", { name: "Sync" }).click();
  await expect(page.getByTestId("work-b4c5d6").getByTestId("pr-card-710002-12")).toBeVisible();
  expect(await inboxCount(page)).toBe(before - 1);

  // 6. Inbox 에서는 사라졌다
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  await expect(page.getByTestId("inbox-710002-12")).toHaveCount(0);
  expect(serverErrors).toEqual([]);
});

test("New Work 를 빠르게 두 번 눌러도 업무는 하나만 생기고, 500 없이 그 업무에 닿는다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Open Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);

  const item = page.getByTestId("inbox-710005-12");
  await expect(item).toContainText("서로 다른 업무를 가리키는 표식이 2개");
  await item.getByRole("button", { name: "New Work" }).dblclick();

  // 두 번째 요청이 늦게 끝나면 Inbox 의 사유 화면("이미 … 연결돼 있다" + Open work)에 선다. 어느 쪽이든 그 업무에 닿는다.
  await expect(page).toHaveURL(/\/works\/[a-z0-9]+$|\/inbox\?notice=already_linked/);
  if (page.url().includes("/inbox")) await page.getByTestId("inbox-notice").getByRole("link", { name: "Open work" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인 안내 문서" })).toBeVisible();
  await expect(page.getByTestId("work-marker")).toHaveText(/^studio-work-[a-z0-9]+$/);
  await expect(page.getByTestId("pr-card-710005-12")).toBeVisible();

  await nav(page).getByRole("link", { name: "Workspace" }).click();
  const docs = page.getByTestId("project-docs");
  await expect(docs.getByTestId("pr-card-710005-12")).toBeVisible();
  await expect(docs.locator('[data-testid^="work-"]')).toHaveCount(1); // 빈 업무가 남지 않았다
  expect(serverErrors).toEqual([]);
});

test("다른 탭에서 먼저 연결된 PR 을 오래된 화면에서 다시 처리하면, Inbox 에 구체적 사유와 그 업무로 가는 링크가 뜬다", async ({
  page,
  context,
}) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  const other = await context.newPage();
  await other.goto("/");
  await nav(other).getByRole("link", { name: "Inbox" }).click();

  // 다른 탭에서 player-app#9 를 먼저 연결한다
  const first = other.getByTestId("inbox-710003-9");
  await first.getByLabel("Work").selectOption({ label: "선수 앱 온보딩 정리 · studio-work-c7d8e9" });
  await first.getByRole("button", { name: "Link to Work" }).click();
  await expect(other).toHaveURL(/\/works\/c7d8e9$/);

  // 오래된 화면에서 같은 PR 로 New Work 를 누르면 500 대신 Inbox 에 사유가 뜬다
  await page.getByTestId("inbox-710003-9").getByRole("button", { name: "New Work" }).click();
  await expect(page).toHaveURL(/\/inbox\?notice=already_linked/);
  const notice = page.getByTestId("inbox-notice");
  await expect(notice).toContainText("demo-org/player-app#9");
  await expect(notice).toContainText("이미 '선수 앱 온보딩 정리' 업무에 연결돼 있어");
  await page.screenshot({ path: `${SHOTS}/04-inbox-notice.png`, fullPage: true });
  await notice.getByRole("link", { name: "Open work" }).click();
  await expect(page).toHaveURL(/\/works\/c7d8e9$/);
  await expect(page.getByTestId("pr-card-710003-9")).toBeVisible();
  expect(serverErrors).toEqual([]);
});

test.describe("자바스크립트를 끈 브라우저", () => {
  test.use({ javaScriptEnabled: false });

  test("오래된 폼 제출과 빠른 이중 클릭에도 500 이 나지 않고, 업무는 하나만 생긴다", async ({ browser }) => {
    const context = await (browser as Browser).newContext({ javaScriptEnabled: false });
    const stale = await context.newPage();
    const fresh = await context.newPage();
    const serverErrors = [...[stale, fresh].map(watchServerErrors)];
    for (const p of [stale, fresh]) {
      await p.goto("/");
      await nav(p).getByRole("link", { name: "Inbox" }).click();
      await expect(p).toHaveURL(/\/inbox$/);
    }

    // 한 탭에서 player-app#12 로 New Work 를 빠르게 두 번 누른다
    await fresh.getByTestId("inbox-710003-12").getByRole("button", { name: "New Work" }).dblclick();
    await expect(fresh).toHaveURL(/\/works\/[a-z0-9]+$|\/inbox\?notice=already_linked/);

    // 다른(오래된) 탭에서 같은 PR 을 Link to Work 로 보낸다
    const staleItem = stale.getByTestId("inbox-710003-12");
    await staleItem.getByLabel("Work").selectOption({ label: "선수 앱 온보딩 정리 · studio-work-c7d8e9" });
    await staleItem.getByRole("button", { name: "Link to Work" }).click();
    await expect(stale).toHaveURL(/\/inbox\?notice=already_linked/);
    await expect(stale.getByTestId("inbox-notice")).toContainText("이미 '로그인 화면 문구 수정' 업무에 연결돼 있어");

    // 선수 앱 프로젝트에는 원래 업무 하나 + 새 업무 하나뿐이다
    await nav(stale).getByRole("link", { name: "Workspace" }).click();
    await expect(stale.getByTestId("project-player").locator('[data-testid^="work-"]')).toHaveCount(2);
    expect(serverErrors.flat()).toEqual([]);
    await context.close();
  });
});

test("업무 화면에서 Unlink 하면 PR 이 Inbox 로 돌아가고, 표식이 있어도 Sync 로 다시 붙지 않으며, 사람이 다시 연결할 수 있다", async ({
  page,
  context,
}) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  // 클릭으로 업무 화면에 간다
  await page.getByTestId("work-a1b2c3").getByRole("link", { name: "로그인 화면 만들기" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);
  const stalePage = await context.newPage(); // 같은 업무 화면을 연 다른 탭 (나중에 오래된 화면이 된다)
  await stalePage.goto("/");
  await stalePage.getByTestId("work-a1b2c3").getByRole("link", { name: "로그인 화면 만들기" }).click();

  const card = page.getByTestId("pr-card-710001-12");
  await expect(card.getByTestId("link-origin")).toHaveText("Linked by marker (body)");
  // 확인 체크 없이 누르면 브라우저가 제출을 막는다
  await card.getByRole("button", { name: "Unlink" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);
  await expect(page.getByTestId("pr-card-710001-12")).toBeVisible();

  // 체크하고 Unlink
  await card.getByRole("checkbox").check();
  await card.getByRole("button", { name: "Unlink" }).click();
  await expect(page).toHaveURL(/\/inbox\?notice=unlinked/);
  await expect(page.getByTestId("inbox-notice")).toContainText("demo-org/payments#12)의 연결을 풀었다");
  const item = page.getByTestId("inbox-710001-12");
  await expect(item.getByTestId("inbox-reason")).toContainText("사람이 이 PR 의 연결을 풀었다('로그인 화면 만들기' 업무에서)");

  // 표식이 본문에 그대로 있어도 Sync 가 다시 붙이지 않는다
  await page.getByRole("button", { name: "Sync" }).click();
  await expect(page.getByTestId("inbox-710001-12").getByTestId("inbox-reason")).toContainText("사람이 이 PR 의 연결을 풀었다");
  await page.screenshot({ path: `${SHOTS}/06-inbox-after-unlink.png`, fullPage: true });

  // 오래된 탭에서 같은 PR 을 다시 Unlink 하면 500 대신 사유 안내
  const staleErrors = watchServerErrors(stalePage);
  const staleCard = stalePage.getByTestId("pr-card-710001-12");
  await staleCard.getByRole("checkbox").check();
  await staleCard.getByRole("button", { name: "Unlink" }).click();
  await expect(stalePage).toHaveURL(/\/inbox\?notice=not_linked/);
  await expect(stalePage.getByTestId("inbox-notice")).toContainText("그 업무에 연결돼 있지 않아 처리하지 않았다");

  // 사람이 Inbox 에서 다시 연결하면 정상으로 붙는다
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  const again = page.getByTestId("inbox-710001-12");
  await again.getByLabel("Work").selectOption({ label: "로그인 화면 만들기 · studio-work-a1b2c3" });
  await again.getByRole("button", { name: "Link to Work" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);
  await expect(page.getByTestId("pr-card-710001-12").getByTestId("link-origin")).toHaveText("Linked manually");
  expect([...serverErrors, ...staleErrors]).toEqual([]);
});

test("복제본에서 온 PR 은 같은 프로젝트 업무의 표식이 있어도 Inbox 에 이유와 함께 있다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("work-a1b2c3").getByTestId("pr-card-710001-18")).toHaveCount(0);
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  const fork = page.getByTestId("inbox-710001-18");
  await expect(fork).toContainText("외부 기여: 로그인 오류 문구 다듬기");
  await expect(fork.getByTestId("inbox-reason")).toContainText("PR 의 브랜치가 다른 저장소(복제본)에 있다");
  await fork.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/07-inbox-fork-pr.png`, fullPage: true });
});

test("Inbox 가 비면 Workspace 는 강조 카드 대신 비어 있다는 문장을 보여 준다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  // 남은 Inbox PR 을 모두 New Work 로 치운다 (앞 시험의 결과에 기대지 않는다)
  for (let guard = 0; guard < 10; guard += 1) {
    const button = page.getByRole("button", { name: "New Work" }).first();
    if ((await button.count()) === 0) break;
    await button.click();
    await expect(page).toHaveURL(/\/works\//);
    await nav(page).getByRole("link", { name: "Inbox" }).click();
  }
  await expect(page.getByTestId("inbox-empty")).toBeVisible();

  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await expect(page.getByTestId("inbox-empty-summary")).toHaveText("Inbox 가 비어 있다. 연결을 기다리는 PR 이 없다.");
  await expect(page.getByTestId("inbox-summary")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Inbox" })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/05-workspace-inbox-empty.png`, fullPage: true });
  expect(serverErrors).toEqual([]);
});

test("없는 업무 주소는 한국어 안내와 Workspace 로 돌아가는 링크를 보여 준다", async ({ page }) => {
  const response = await page.goto("/works/nope404");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "찾는 업무나 화면이 없다" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workspace" })).toBeVisible();
});
