/**
 * 진입점(Workspace, `/`)에서 출발해 클릭만으로 가는 사용자 흐름 (docs/plan/01-pr-collection.md §4 "화면에서 확인할 수 있다").
 * 중간 화면에 주소를 직접 입력해 들어가지 않는다. 주소 입력은 첫 화면 `/` 뿐이다
 * (마지막 시험 하나만 "없는 업무 주소" 화면을 보려고 일부러 없는 주소를 연다).
 *
 * 시험들은 같은 서버(같은 메모리 저장소)를 차례로 쓴다. 각 시험은 서로 다른 Inbox PR 을 다룬다.
 *   1 coach-web#12 · 2 docs-site#12 · 3 player-app#9 · 4 player-app#12 · 5 남은 것 전부
 */
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { filterProject, nav, openConnections, openLinkSection, openReview, openWork, sync, unlinkFromPanel, visibleWorks, watchServerErrors } from "./helpers";

const SHOTS = "docs/plan/screenshots";
const POSTGRES = process.env.E2E_STORAGE === "postgres";

/**
 * 보고용 스크린샷은 커밋 대상이라, UPDATE_SCREENSHOTS=1 일 때만 새로 저장한다(평소 실행이 작업 트리를 더럽히지 않게).
 * 저장하지 않을 때도 화면을 한 번 찍어 보아 찍기 자체가 실패하지 않는지는 확인한다.
 */
async function shot(page: Page, name: string): Promise<void> {
  if (process.env.UPDATE_SCREENSHOTS === "1") await page.screenshot({ path: `${SHOTS}/${name}`, fullPage: true });
  else await page.screenshot({ fullPage: true });
}

async function inboxCount(page: Page): Promise<number> {
  return Number(await page.getByTestId("inbox-count").textContent());
}

/** GitHub 줄과 Studio 줄은 따로다 (계약 §5). Studio 줄은 결정이 있을 때만 있고, 있으면 Internal: 표기만 든다 */
async function expectSeparateStateRows(card: Locator) {
  await expect(card.getByTestId("github-status")).toContainText("GitHub");
  await expect(card.getByTestId("github-status")).not.toContainText("Internal:");
  const studio = card.getByTestId("studio-status");
  if ((await studio.count()) > 0) await expect(studio).toContainText("Internal:");
}

/**
 * 아직 만들지 않은 기능의 메뉴 · 버튼이 이 화면 어디에도 없다 (결정 7: 실행되지 않는 버튼을 두지 않는다).
 * Open Preview 는 2단계에서 생겼다(docs/plan/04-remote-preview.md). 이 서버는 미리보기 기기를 연결하지 않고 띄우므로,
 * 보이는 Open Preview 는 모두 비활성이어야 한다 — 누를 수 있는데 동작하지 않는 버튼이 없다는 같은 규칙이다.
 */
async function expectNoUnbuiltFeatures(page: Page) {
  // Chat 은 2.5단계에 실제 화면(업무 Chat)이 생겨 메뉴에 들어갔다(feature-plan §3-1). Run · Flow · Agents 는 아직 없다
  const unbuilt = /^(Run|Flow|Agents)$/;
  await expect(page.getByRole("button", { name: unbuilt })).toHaveCount(0);
  const previewButtons = page.getByRole("button", { name: "Open Preview" });
  for (const button of await previewButtons.all()) await expect(button).toBeDisabled();
  await expect(page.getByRole("link", { name: unbuilt })).toHaveCount(0);
  await expect(page.getByText(unbuilt)).toHaveCount(0);
  await expect(nav(page).getByRole("link")).toHaveText(["Workspace", "Chat", /^Inbox/]);
}

test("Workspace 에서 Inbox 로 가서 PR 을 기존 업무에 연결하면, 업무 화면에 PR 카드가 나타나고 Workspace 의 업무 줄에 그 PR 이 보인다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Workspace" })).toBeVisible();
  await expectNoUnbuiltFeatures(page);
  // 고정 데이터로 돌면 사이드바에 늘 "Fixture data" 가 보인다 (Q2)
  await expect(page.getByTestId("fixture-badge").first()).toHaveText("Fixture data");

  // 기술 정보는 Connections 한 곳에 있다 — 데이터 출처, "다시 켜면 처음 상태", 한국 시간
  await openConnections(page);
  const source = page.getByTestId("data-source");
  await expect(page.getByTestId("source-kind")).toHaveText("Fixture data");
  await expect(page.getByTestId("last-sync-result")).toContainText("저장소 5 · PR 9");
  if (POSTGRES) {
    await expect(page.getByTestId("storage-kind")).toHaveText("Stored in PostgreSQL");
    await expect(page.getByTestId("storage-note")).not.toContainText("서버를 다시 켜면 처음 상태로 돌아간다");
  } else {
    await expect(page.getByTestId("storage-kind")).toHaveText("Stored in memory");
    await expect(page.getByTestId("storage-note")).toContainText("서버를 다시 켜면 처음 상태로 돌아간다");
  }
  await expect(source).toContainText("demo-org/payments");
  await expect(page.getByTestId("last-sync")).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} KST$/);
  await expectNoUnbuiltFeatures(page);

  // 표식으로 붙은 PR: 표식을 찾은 자리가 보이고, 이전 커밋에 대한 결정은 이전 버전이다 (Review 패널)
  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await openWork(page, "a1b2c3");
  const payments = await openReview(page, 710001, 12);
  await expectSeparateStateRows(payments);
  await expect(payments.getByTestId("link-origin")).toHaveText("Linked by marker (body)");
  // 이전 커밋에 대한 결정은 패널이 아니라 타임라인의 한 줄에 "이전 커밋" 으로 남는다. 패널의 알약은 지금 커밋의 결정뿐이다 (결정 19)
  await expect(payments.getByTestId("review-decision")).toHaveCount(0);
  const oldDecision = page.getByTestId("timeline").locator('[data-kind="review"][data-commit="9f8e7d6"]');
  await expect(oldDecision).toHaveAttribute("data-freshness", "outdated");
  await expect(oldDecision).toHaveAttribute("data-verdict", "changes_requested");
  // GitHub 리뷰와 Studio 결정의 글자가 다르다
  await expect(payments.getByTestId("github-status")).toContainText("Changes requested");
  await expect(payments.getByTestId("github-status")).not.toContainText("Internal:");
  await payments.getByTestId("review-close").click();
  await expect((await openReview(page, 710001, 15)).getByTestId("link-origin")).toHaveText("Linked by marker (branch)");

  // 내부 검토 완료여도 GitHub 쪽은 Open 이다 — 두 상태가 다른 줄에 있다
  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await expect(page.getByTestId("work-d0e1f2")).toContainText("In progress");
  // 업무 제목은 hover 가 없는 휴대전화에서도 링크로 보이도록 늘 밑줄이 있다
  await expect(page.getByTestId("work-d0e1f2").locator(".work-title")).toHaveCSS("text-decoration-line", "underline");
  await openWork(page, "d0e1f2");
  const admin = await openReview(page, 710004, 12);
  await expect(admin.getByTestId("studio-status")).toContainText("Internal: review done");
  await expect(admin.getByTestId("github-status")).toContainText("Open");
  await expect(admin.getByTestId("github-status")).not.toContainText("Internal:");

  await nav(page).getByRole("link", { name: "Workspace" }).click();
  const before = await inboxCount(page);
  await expect(page.getByTestId("work-b4c5d6").getByTestId("work-pr")).toHaveCount(0); // 아직 어느 업무에도 없다

  // 1. 클릭으로 Inbox 에 간다
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expectNoUnbuiltFeatures(page);
  // 표식으로 자동 연결되는 방법은 본문이 아니라 "?" 를 펼쳐야 보인다 (결정 18)
  const hint = page.getByTestId("marker-hint");
  await expect(hint.locator("p")).toBeHidden();
  await hint.locator("summary").click();
  await expect(hint).toContainText("다음 Sync 에서 그 업무에 자동으로 연결된다");
  // 연결 안 된 닫힌 PR(coach-web#7)은 목록에 없고 개수로만 보인다
  await expect(page.getByTestId("closed-unlinked-count")).toContainText("닫히거나 병합된 PR 1개는 목록에 없다");
  await expect(page.getByTestId("inbox-710002-7")).toHaveCount(0);
  await expect(page.getByTestId("inbox-710003-12")).toContainText("다른 프로젝트('결제 서비스')");
  const item = page.getByTestId("inbox-710002-12");
  await expect(item.getByTestId("inbox-reason")).toHaveCount(0); // 표식이 없어 온 보통의 PR 에는 사유를 적지 않는다
  await expect(item).toContainText("coach-web · #12 · Checks pending");
  await expect(item.getByLabel("Work").locator("option")).toContainText(["코치 로그인 개편 · studio-work-b4c5d6"]);
  await shot(page, "01-inbox.png");

  // 2. 같은 프로젝트의 업무를 골라 Link to Work
  await item.getByLabel("Work").selectOption({ label: "코치 로그인 개편 · studio-work-b4c5d6" });
  await item.getByRole("button", { name: "Link to Work" }).click();

  // 3. 업무 화면에 PR 카드가 나타난다
  await expect(page).toHaveURL(/\/works\/b4c5d6$/);
  await expectNoUnbuiltFeatures(page);
  await expect(page.getByRole("heading", { level: 1, name: "코치 로그인 개편" })).toBeVisible();
  await expect(page.getByTestId("work-marker")).toHaveText("studio-work-b4c5d6");
  const linked = page.getByTestId("pr-card-710002-12");
  await expectSeparateStateRows(linked);
  await expect((await openReview(page, 710002, 12)).getByTestId("link-origin")).toHaveText("Linked manually");
  await shot(page, "02-work-after-link.png");

  // 4. 클릭으로 Workspace 에 돌아오면 그 업무 줄에 PR 이 보이고, Inbox 수는 하나 줄었다
  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("work-b4c5d6").getByTestId("work-pr")).toContainText("#12");
  expect(await inboxCount(page)).toBe(before - 1);
  await shot(page, "03-workspace-after-link.png");

  // 5. Sync 로 다시 읽어도 사람이 만든 연결은 그대로다
  await sync(page);
  await expect(page.getByTestId("work-b4c5d6").getByTestId("work-pr")).toContainText("#12");
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
  await expect(item.getByTestId("inbox-reason")).toContainText("서로 다른 업무의 표식이 2개");
  await item.getByRole("button", { name: "New Work" }).dblclick();

  // 두 번째 요청이 늦게 끝나면 Inbox 의 사유 화면("이미 … 연결돼 있다" + Open work)에 선다. 어느 쪽이든 그 업무에 닿는다.
  await expect(page).toHaveURL(/\/works\/[a-z0-9]+$|\/inbox\?notice=already_linked/);
  if (page.url().includes("/inbox")) await page.getByTestId("inbox-notice").getByRole("link", { name: "Open work" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "로그인 안내 문서" })).toBeVisible();
  await expect(page.getByTestId("work-marker")).toHaveText(/^studio-work-[a-z0-9]+$/);
  await expect(page.getByTestId("pr-card-710005-12")).toBeVisible();

  await filterProject(page, "docs");
  await expect(visibleWorks(page)).toHaveCount(1); // 빈 업무가 남지 않았다
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
  await shot(page, "04-inbox-notice.png");
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
    await filterProject(stale, "player");
    await expect(visibleWorks(stale)).toHaveCount(2);
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
  await openWork(page, "a1b2c3");
  const stalePage = await context.newPage(); // 같은 업무의 Review 패널을 연 다른 탭 (나중에 오래된 화면이 된다)
  await stalePage.goto("/");
  await openWork(stalePage, "a1b2c3");
  await openReview(stalePage, 710001, 12);

  const panel = await openReview(page, 710001, 12);
  await expect(panel.getByTestId("link-origin")).toHaveText("Linked by marker (body)");
  await openLinkSection(panel);
  // 확인 체크 없이 누르면 브라우저가 제출을 막는다
  await panel.getByRole("button", { name: "Unlink" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3\?review=710001:12/);
  await expect(page.getByTestId("pr-card-710001-12")).toBeVisible();

  // 브라우저의 required 를 걷어내고 체크 없이 보내면(= 서버 액션을 직접 부르는 것과 같다) 서버가 거절한다
  await panel.getByRole("checkbox").evaluate((el) => (el as HTMLInputElement).removeAttribute("required"));
  await panel.getByRole("button", { name: "Unlink" }).click();
  await expect(page).toHaveURL(/\/inbox\?notice=invalid_input/);
  await expect(page.getByTestId("inbox-710001-12")).toHaveCount(0); // 연결은 그대로다 — Inbox 에 없다
  await page.goBack();
  await page.reload();
  await expect(page.getByTestId("pr-card-710001-12")).toBeVisible();
  await openLinkSection(panel);

  // 체크하고 Unlink
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Unlink" }).click();
  await expect(page).toHaveURL(/\/inbox\?notice=unlinked/);
  await expect(page.getByTestId("inbox-notice")).toContainText("demo-org/payments#12)의 연결을 풀었다");
  const item = page.getByTestId("inbox-710001-12");
  await expect(item.getByTestId("inbox-reason")).toContainText("사람이 연결을 풀었다('로그인 화면 만들기' 업무에서)");

  // 표식이 본문에 그대로 있어도 Sync 가 다시 붙이지 않는다
  await sync(page);
  await expect(page.getByTestId("inbox-710001-12").getByTestId("inbox-reason")).toContainText("사람이 연결을 풀었다");
  await shot(page, "06-inbox-after-unlink.png");

  // 오래된 탭에서 같은 PR 을 다시 Unlink 하면 500 대신 사유 안내
  const staleErrors = watchServerErrors(stalePage);
  const stalePanel = stalePage.getByTestId("review-panel");
  await openLinkSection(stalePanel);
  await stalePanel.getByRole("checkbox").check();
  await stalePanel.getByRole("button", { name: "Unlink" }).click();
  await expect(stalePage).toHaveURL(/\/inbox\?notice=not_linked/);
  await expect(stalePage.getByTestId("inbox-notice")).toContainText("그 업무에 연결돼 있지 않아 처리하지 않았다");

  // 사람이 Inbox 에서 다시 연결하면 정상으로 붙는다
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  const again = page.getByTestId("inbox-710001-12");
  await again.getByLabel("Work").selectOption({ label: "로그인 화면 만들기 · studio-work-a1b2c3" });
  await again.getByRole("button", { name: "Link to Work" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);
  await expect((await openReview(page, 710001, 12)).getByTestId("link-origin")).toHaveText("Linked manually");
  expect([...serverErrors, ...staleErrors]).toEqual([]);
});

test("복제본에서 온 PR 은 같은 프로젝트 업무의 표식이 있어도 Inbox 에 이유와 함께 있다", async ({ page }) => {
  await page.goto("/");
  await openWork(page, "a1b2c3");
  await expect(page.getByTestId("pr-card-710001-12")).toBeVisible();
  await expect(page.getByTestId("pr-card-710001-18")).toHaveCount(0);
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  const fork = page.getByTestId("inbox-710001-18");
  await expect(fork).toContainText("외부 기여: 로그인 오류 문구 다듬기");
  await expect(fork.getByTestId("inbox-reason")).toContainText("복제본(fork)에서 온 PR");
  await fork.scrollIntoViewIfNeeded();
  await shot(page, "07-inbox-fork-pr.png");
});

test("Inbox 가 비면 Workspace 의 Needs your attention 에서 Inbox 줄이 사라진다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  // Inbox 링크를 누른 뒤 Inbox 화면이 다 뜬 것을 확인하고 나서 버튼을 센다.
  // 확인 없이 세면 느린 환경(CI)에서 아직 이전 화면을 세어 0 이 나오고, 반복이 일찍 끝난다.
  const openInbox = async () => {
    await nav(page).getByRole("link", { name: "Inbox" }).click();
    await expect(page).toHaveURL(/\/inbox(\?|$)/);
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  };
  await page.goto("/");
  await openInbox();
  // 남은 Inbox PR 을 모두 New Work 로 치운다 (앞 시험의 결과에 기대지 않는다)
  for (let guard = 0; guard < 10; guard += 1) {
    const button = page.getByRole("button", { name: "New Work" }).first();
    if ((await button.count()) === 0) break;
    await button.click();
    await expect(page).toHaveURL(/\/works\//);
    await openInbox();
  }
  await expect(page.getByTestId("inbox-empty")).toBeVisible();

  await nav(page).getByRole("link", { name: "Workspace" }).click();
  // Inbox 개수는 Needs your attention 의 한 줄이다(feature-plan F4). 기다리는 PR 이 없으면 그 줄이 사라진다
  await expect(page.getByTestId("attention")).toBeVisible();
  await expect(page.locator('[data-testid="attention-row"][data-kind="inbox"]')).toHaveCount(0);
  await expect(page.getByTestId("inbox-count")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Inbox" })).toHaveCount(0);
  await shot(page, "05-workspace-inbox-empty.png");
  expect(serverErrors).toEqual([]);
});

test("범위를 넘는 PR 번호(2^31 이상)가 주소나 폼으로 들어와도 500 없이 사유 안내가 뜬다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  // 주소로 들어온 알림: PR 을 특정하지 않은 안내로 바뀐다 (저장소에 묻지 않는다)
  const direct = await page.goto("/inbox?notice=not_found&repoId=710001&number=3000000000");
  expect(direct?.status()).toBe(200);
  await expect(page.getByTestId("inbox-notice")).toContainText("그 PR 이나 업무를 찾을 수 없다");

  // 폼으로 들어온 값: 업무 화면의 Unlink 폼을 고쳐 범위 밖 번호를 보내면 invalid_input 안내가 뜬다
  // (앞 시험이 Inbox 를 비웠을 수 있으므로, 늘 카드가 있는 업무 화면의 폼을 쓴다)
  await page.goto("/");
  await openWork(page, "d0e1f2");
  await openLinkSection(await openReview(page, 710004, 12));
  const form = page.getByTestId("unlink-form").first();
  await form.locator('input[name="number"]').evaluate((el) => ((el as HTMLInputElement).value = "3000000000"));
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Unlink" }).click();
  await expect(page).toHaveURL(/\/inbox\?notice=invalid_input/);
  await expect(page.getByTestId("inbox-notice")).toContainText("요청 값이 올바르지 않아 처리하지 않았다");
  expect(serverErrors).toEqual([]);
});

test("없는 업무 주소는 한국어 안내와 Workspace 로 돌아가는 링크를 보여 준다", async ({ page }) => {
  const response = await page.goto("/works/nope404");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "찾는 업무나 화면이 없다" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workspace" })).toBeVisible();
});
