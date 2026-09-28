/**
 * 업무 상태가 스스로 바뀐다 (docs/product/feature-plan.md F3, 계약 §5-1). 첫 화면(Workspace, `/`)에서 출발해 클릭만으로 간다.
 *
 * 이 파일은 이름 순서상 주 시험 서버(3100)를 쓰는 마지막 파일이다. 앞 파일들이 같은 서버의 상태를 바꿔 두었을 수 있으므로(예: docs-site#12 는
 * inbox-to-work 시험이 이미 New Work 로 업무를 만들었다), 그 PR 이 Inbox 에 있으면 여기서 업무를 만들고 이미 업무에 있으면 그 업무를 연다.
 * 이 파일만 따로 돌려도(`npx playwright test work-status`) 같은 결과가 나온다.
 *
 * 주기 동기화는 시험 서버에서 꺼 두었다(SYNC_INTERVAL_SECONDS=0) — 상태는 첫 요청 · Sync 버튼 · 사람의 조작에서만 바뀐다.
 */
import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { filterProject, nav, openConnections, openReview, openWork, sync, unlinkFromPanel, visibleWorks, watchServerErrors } from "./helpers";

/** 보고용 화면을 따로 남기고 싶을 때만 STATUS_SHOTS 폴더에 저장한다(평소 실행은 작업 트리를 더럽히지 않는다) */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.STATUS_SHOTS;
  await page.screenshot(dir === undefined ? { fullPage: true } : { path: join(dir, name), fullPage: true });
}

/** docs-site#12(검사 없음, 아직 판단하지 않음)가 붙은 업무의 화면을 연다. 아직 Inbox 에 있으면 New Work 로 만든다 */
async function openDocsWork(page: Page): Promise<void> {
  await page.goto("/");
  await filterProject(page, "docs");
  const works = visibleWorks(page);
  if ((await works.count()) > 0) {
    const first = works.first();
    const id = (await first.getAttribute("data-work")) ?? (await first.getAttribute("data-testid"))!.replace(/^work-/, "");
    await openWork(page, id);
  } else {
    await nav(page).getByRole("link", { name: "Inbox" }).click();
    await page.getByTestId("inbox-710005-12").getByRole("button", { name: "New Work" }).click();
  }
  await expect(page).toHaveURL(/\/works\/[a-z0-9]+$/);
  await expect(page.getByTestId("pr-card-710005-12")).toBeVisible();
}

test("Workspace 의 업무마다 상태 배지가, 업무 화면에는 상태 이력 한 줄이 보인다", async ({ page }) => {
  await page.goto("/");
  const rows = page.locator("a.work-row");
  expect(await rows.count()).toBeGreaterThan(0);
  for (const row of await rows.all()) {
    await expect(row.getByTestId("status-badge")).toHaveText(/^(Draft|In progress|Needs review|Done candidate|Done)$/);
  }
  // 관리자 로그인 보안 점검: 최신 커밋에 내부 검토 완료가 있어 진행 중(R3b 의 상태 — 시연 데이터가 이미 그 상태로 시작한다)
  await expect(page.getByTestId("work-d0e1f2").getByTestId("status-badge")).toHaveText("In progress");
  await openWork(page, "d0e1f2");
  await expect(page.getByTestId("status-box").getByTestId("status-history")).toContainText("상태 이력:");
  await openConnections(page);
  await expect(page.getByTestId("auto-sync")).toHaveText("Auto sync off");
  await expect(page.getByTestId("last-sync-ago")).toHaveText(/^\((방금|\d+분 전)\)$/);
});

test("검토를 기다리는 업무에서 Approve in Studio 하면 In progress(R3b)로, 손으로 고른 상태는 Sync 가 덮지 않는다(R6)", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await openDocsWork(page);
  const badge = page.locator(".work-head").getByTestId("status-badge");
  const history = page.getByTestId("status-box").getByTestId("status-history");

  // 검사 없음 + 아직 판단하지 않음 → 검토 필요 (R2)
  await expect(badge).toHaveText("Needs review");
  await expect(history).toContainText("규칙 R2 · demo-org/docs-site#12 커밋 6f7a8b9 · 최신 커밋의 검사가 끝났고 아직 판단하지 않았다");
  await shot(page, "work-needs-review.png");

  // Approve in Studio → 진행 중 (R3b, GitHub 병합을 기다린다). GitHub 줄은 그대로 Open
  const panel = await openReview(page, 710005, 12);
  await panel.getByRole("button", { name: "Approve in Studio" }).click();
  await expect(badge).toHaveText("In progress");
  await expect(history).toContainText("규칙 R3b · demo-org/docs-site#12 커밋 6f7a8b9 · 최신 커밋에 Approve in Studio(내부 검토 완료)를 남겼다");
  await expect(page.getByTestId("pr-card-710005-12").getByTestId("github-status")).toContainText("Open");

  // 사람이 손으로 Draft 로 바꾼다 → Sync 를 눌러도 PR 이 그대로라 Draft 유지
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("draft");
  await page.getByRole("button", { name: "Set Status" }).click();
  await expect(badge).toHaveText("Draft");
  await expect(history).toContainText("사람이 상태를 Draft 로 바꿨다 · 다음 PR 변화까지 규칙이 덮지 않는다");
  await sync(page);
  await expect(badge).toHaveText("Draft");

  // Workspace 에서도 같은 상태가 보인다
  await filterProject(page, "docs");
  await expect(page.locator("a.work-row").getByTestId("status-badge")).toHaveText("Draft");
  expect(serverErrors).toEqual([]);
});

test("열린 PR 을 떼어 병합된 PR 만 남으면 Done candidate, Mark as Done 으로 Done, PR 을 다시 붙이면 In progress(R5)", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await openWork(page, "a1b2c3");
  // payments#12(열림)를 떼어 낸다 — 남는 것은 병합된 payments#15 하나
  await unlinkFromPanel(page, 710001, 12);
  await expect(page).toHaveURL(/\/inbox\?notice=unlinked/);

  // Workspace 에서 완료 후보가 보인다 — 자동으로 완료하지 않는다. 완료 후보는 Needs your attention 에 올리지 않는다(결정 16 의 4)
  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await expect(page.locator('[data-testid="attention-row"][data-work="a1b2c3"]')).toHaveCount(0);
  await page.getByTestId("filter-done_candidate").click();
  const row = page.getByTestId("work-a1b2c3");
  await expect(row.getByTestId("status-badge")).toHaveText("Done candidate");

  // 업무 화면: Next action 이 Mark as Done 과 그 이유다
  await row.click();
  const badge = page.locator(".work-head").getByTestId("status-badge");
  await expect(badge).toHaveText("Done candidate");
  await expect(page.getByTestId("status-box").getByTestId("status-history")).toContainText(
    "규칙 R4 · demo-org/payments#15 커밋 7a8b9c0 · 열린 PR 이 없고 병합된 PR 이 있다",
  );
  await expect(page.getByTestId("next-action")).toHaveAttribute("data-kind", "mark_done");
  await expect(page.getByTestId("done-candidate-note")).toContainText(
    "연결된 PR 이 모두 병합됐다. 업무는 PR 보다 클 수 있어 자동으로 완료하지 않는다",
  );
  await shot(page, "work-done-candidate.png");
  await page.getByRole("button", { name: "Mark as Done" }).click();
  await expect(badge).toHaveText("Done");
  await expect(page.getByRole("button", { name: "Mark as Done" })).toHaveCount(0);
  await expect(page.getByTestId("status-box").getByTestId("status-history")).toContainText("사람이 Mark as Done 을 눌렀다");

  // Sync 를 눌러도 완료는 그대로다
  await sync(page);
  await expect(badge).toHaveText("Done");

  // Inbox 에서 PR 을 다시 붙이면 일이 다시 움직인다 (R5)
  await nav(page).getByRole("link", { name: "Inbox" }).click();
  const again = page.getByTestId("inbox-710001-12");
  await again.getByLabel("Work").selectOption({ label: "로그인 화면 만들기 · studio-work-a1b2c3" });
  await again.getByRole("button", { name: "Link to Work" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3$/);
  await expect(badge).toHaveText("In progress");
  await expect(page.getByTestId("status-box").getByTestId("status-history")).toContainText("규칙 R5 · demo-org/payments#12");
  expect(serverErrors).toEqual([]);
});
