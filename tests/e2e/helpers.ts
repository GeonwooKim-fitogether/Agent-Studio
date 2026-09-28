/**
 * e2e 의 공통 동작 (결정 18 의 화면). 모두 첫 화면(Workspace, `/`)이나 지금 화면에서 클릭으로만 간다 — 중간 화면의 주소를 입력하지 않는다.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 브라우저 쪽 React 가 화면에 붙기(하이드레이션)를 기다린다. 미리 채워진 textarea(메모 Edit · 목표 Edit)는 React 가 붙는 순간
 * 본문을 다시 놓으므로, 그 전에 fill 하면 새 글 뒤에 옛 글이 이어 붙는다(부하가 큰 CI 에서 실측). 자바스크립트를 끈 시험에서는 부르지 않는다.
 */
export async function hydrated(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "1");
}

/** 지금 보이는 주 내비게이션 (넓은 화면은 사이드바, 휴대전화 폭은 아래쪽 탭) */
export const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** 이 페이지에서 500 이상의 응답이 오면 모아 둔다. 시험 끝에 비어 있어야 한다 */
export function watchServerErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 960;

/**
 * Workspace 에서 업무 하나를 연다. Needs your attention 에 있으면 그 줄을 누르고(넓은 화면은 Up next 의 버튼까지),
 * 아니면 Other work 의 줄을 누른다. Other work 의 Open 탭에 없으면 Done candidate · Done 탭을 차례로 본다.
 * 이미 Workspace 에 있지 않으면 첫 화면에서 시작한다.
 */
export async function openWork(page: Page, workId: string): Promise<void> {
  // 다른 서버(재시작 시험 등)에서도 그 서버의 첫 화면으로 간다
  const here = page.url();
  if (here.startsWith("about:")) await page.goto("/");
  else if (new URL(here).pathname !== "/" || new URL(here).search !== "") await page.goto(new URL("/", here).href); // 거른 Workspace 도 처음부터
  await expect(page.getByRole("heading", { level: 1, name: "Workspace" })).toBeVisible();
  const row = page.locator(`[data-testid="attention-row"][data-work="${workId}"]`);
  if ((await row.count()) > 0) {
    await row.getByRole("link").first().click();
    if (!isPhone(page)) {
      await expect(page).toHaveURL(new RegExp(`focus=${workId}`));
      await expect(page.getByTestId("up-next")).toContainText(await row.locator(".row-title").first().innerText());
      await page.getByTestId("up-next-open").click();
    }
  } else {
    for (const filter of ["done_candidate", "done"]) {
      if ((await page.getByTestId(`work-${workId}`).count()) > 0) break;
      await page.getByTestId(`filter-${filter}`).click();
      await expect(page.getByTestId(`filter-${filter}`)).toHaveAttribute("aria-current", "true"); // 그 탭이 다 그려진 뒤에 센다
    }
    await page.getByTestId(`work-${workId}`).click();
  }
  await expect(page).toHaveURL(new RegExp(`/works/${workId}(\\?|#|$)`));
}

/** Workspace 를 한 프로젝트로 거른다 (사이드바의 Projects — 넓은 화면만). 끝나지 않은 업무가 없는 프로젝트는 "N more" 안에 접혀 있어 먼저 펼친다 */
export async function filterProject(page: Page, projectId: string): Promise<void> {
  if (new URL(page.url()).pathname !== "/") await nav(page).getByRole("link", { name: "Workspace" }).click();
  const link = page.getByTestId(`project-filter-${projectId}`);
  if (!(await link.isVisible())) await page.getByTestId("project-more").locator("summary").click();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`project=${projectId}`));
}

/** 거른 Workspace 에 보이는 업무 전부 — Needs your attention 의 업무 줄과 Other work(Open 탭)의 줄 */
export const visibleWorks = (page: Page): Locator => page.locator('[data-testid="attention-row"][data-work], a.work-row');

/** 업무 화면에서 PR 결과 카드의 Open review 를 눌러 Review 패널을 연다 */
export async function openReview(page: Page, repoId: number, number: number): Promise<Locator> {
  await page.getByTestId(`pr-card-${repoId}-${number}`).getByTestId("open-review").click();
  const panel = page.getByTestId("review-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Review work" })).toBeVisible();
  return panel;
}

/** Review 패널의 Link 절에서 확인을 체크하고 Unlink 한다 */
export async function unlinkFromPanel(page: Page, repoId: number, number: number): Promise<void> {
  const panel = await openReview(page, repoId, number);
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Unlink" }).click();
}

/** 사이드바의 Connections (넓은 화면) */
export async function openConnections(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Connections" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Connections" })).toBeVisible();
}

/** 사이드바의 Sync */
export async function sync(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sync" }).click();
}
