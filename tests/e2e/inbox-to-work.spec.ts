/**
 * 진입점(Workspace, `/`)에서 출발해 클릭만으로 가는 사용자 흐름 (docs/plan/01-pr-collection.md §4 "화면에서 확인할 수 있다").
 * 중간 화면에 주소를 직접 입력해 들어가지 않는다. 주소 입력은 첫 화면 `/` 한 번뿐이다.
 */
import { expect, type Locator, type Page, test } from "@playwright/test";

const SHOTS = "docs/plan/screenshots";
const COACH_PR = "pr-card-710002-12"; // demo-org/coach-web#12 — 표식이 없어 Inbox 에 있다
const DOCS_PR = "pr-card-710005-12"; // demo-org/docs-site#12 — 표식이 둘이라 Inbox 에 있다

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function inboxCount(page: Page): Promise<number> {
  return Number(await page.getByTestId("inbox-count").textContent());
}

async function expectSeparateStateRows(card: Locator) {
  await expect(card.getByTestId("github-status")).toContainText("GitHub");
  await expect(card.getByTestId("studio-status")).toContainText("Studio");
}

test("Workspace 에서 Inbox 로 가서 PR 을 기존 업무에 연결하면, 업무 화면과 Workspace 에 PR 카드가 나타난다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Workspace" })).toBeVisible();

  // 데이터 출처와 "다시 켜면 처음 상태" 가 보인다
  const source = page.getByTestId("data-source");
  await expect(source).toContainText("Fixture data");
  await expect(source).toContainText("서버를 다시 켜면 처음 상태로 돌아간다");
  // 동작하지 않는 버튼·메뉴가 없다
  await expect(page.getByRole("button", { name: /^(Run|Open Preview)$/ })).toHaveCount(0);
  await expect(nav(page).getByRole("link")).toHaveText(["Workspace", "Inbox"]);

  // 표식으로 자동 연결된 PR 은 처음부터 Workspace 에 있고, GitHub 줄과 Studio 줄이 나뉘어 있다
  const payments = page.getByTestId("work-a1b2c3").getByTestId("pr-card-710001-12");
  await expect(payments).toBeVisible();
  await expectSeparateStateRows(payments);
  await expect(payments.getByTestId("review-decision")).toHaveAttribute("data-freshness", "outdated");
  await expect(payments.getByTestId("review-decision")).toContainText("이전 버전");

  // 내부 검토 완료여도 GitHub 쪽은 Open 이다 — 두 상태가 다른 줄에 있다
  const admin = page.getByTestId("work-d0e1f2").getByTestId("pr-card-710004-12");
  await expect(admin.getByTestId("studio-status")).toContainText("Internal review done");
  await expect(admin.getByTestId("github-status")).toContainText("Open");
  await expect(admin.getByTestId("github-status")).not.toContainText("Internal review done");

  const before = await inboxCount(page);
  await expect(page.getByTestId(COACH_PR)).toHaveCount(0); // 아직 어느 업무에도 없다

  // 1. 클릭으로 Inbox 에 간다
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  const item = page.getByTestId("inbox-710002-12");
  await expect(item).toContainText("업무 표식이 없어");
  await page.screenshot({ path: `${SHOTS}/01-inbox.png`, fullPage: true });

  // 2. 같은 프로젝트의 업무를 골라 Link to Work
  await item.getByLabel("Work").selectOption({ label: "코치 로그인 개편" });
  await item.getByRole("button", { name: "Link to Work" }).click();

  // 3. 업무 화면에 PR 카드가 나타난다
  await expect(page).toHaveURL(/\/works\/b4c5d6$/);
  await expect(page.getByRole("heading", { level: 1, name: "코치 로그인 개편" })).toBeVisible();
  await expect(page.getByTestId("work-marker")).toHaveText("studio-work-b4c5d6");
  const linked = page.getByTestId(COACH_PR);
  await expect(linked).toBeVisible();
  await expect(linked.getByTestId("studio-status")).toContainText("Linked in Inbox");
  await expectSeparateStateRows(linked);
  await page.screenshot({ path: `${SHOTS}/02-work-after-link.png`, fullPage: true });

  // 4. 클릭으로 Workspace 에 돌아오면 그 업무 아래에 카드가 있고, Inbox 수는 하나 줄었다
  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("work-b4c5d6").getByTestId(COACH_PR)).toBeVisible();
  expect(await inboxCount(page)).toBe(before - 1);
  await page.screenshot({ path: `${SHOTS}/03-workspace-after-link.png`, fullPage: true });

  // 5. Sync 로 GitHub(여기서는 고정 데이터)를 다시 읽어도 사람이 만든 연결은 그대로다
  await page.getByRole("button", { name: "Sync" }).click();
  await expect(page.getByTestId("work-b4c5d6").getByTestId(COACH_PR)).toBeVisible();
  expect(await inboxCount(page)).toBe(before - 1);

  // 6. Inbox 에서는 사라졌다
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  await expect(page.getByTestId("inbox-710002-12")).toHaveCount(0);
});

test("Inbox 에서 New Work 를 누르면 그 PR 로 새 업무가 생기고 Workspace 에 나타난다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open Inbox" }).click();
  await expect(page).toHaveURL(/\/inbox$/);

  const item = page.getByTestId("inbox-710005-12");
  await expect(item).toContainText("서로 다른 업무를 가리키는 표식이 2개");
  await item.getByRole("button", { name: "New Work" }).click();

  await expect(page).toHaveURL(/\/works\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "로그인 안내 문서" })).toBeVisible();
  await expect(page.getByTestId("work-marker")).toHaveText(/^studio-work-[a-z0-9]+$/);
  await expect(page.getByTestId(DOCS_PR)).toBeVisible();

  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await expect(page.getByTestId("project-docs").getByTestId(DOCS_PR)).toBeVisible();
});

test("다른 탭에서 먼저 연결된 PR 을 오래된 화면에서 다시 처리하면 오류 화면이 뜨고 Workspace 로 돌아갈 수 있다", async ({ page, context }) => {
  // 두 탭 모두 첫 화면에서 출발해 클릭으로 Inbox 에 간다
  await page.goto("/");
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  const other = await context.newPage();
  await other.goto("/");
  await nav(other).getByRole("link", { name: "Inbox" }).click();

  // 다른 탭에서 player-app#9 를 먼저 연결한다
  const first = other.getByTestId("inbox-710003-9");
  await first.getByLabel("Work").selectOption({ label: "선수 앱 온보딩 정리" });
  await first.getByRole("button", { name: "Link to Work" }).click();
  await expect(other).toHaveURL(/\/works\/c7d8e9$/);

  // 오래된 화면에서 같은 PR 로 New Work 를 누르면 거절된다
  await page.getByTestId("inbox-710003-9").getByRole("button", { name: "New Work" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "요청을 처리하지 못했다" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workspace" })).toBeVisible();
  await expect(page.getByTestId("work-c7d8e9").getByTestId("pr-card-710003-9")).toBeVisible();
});
