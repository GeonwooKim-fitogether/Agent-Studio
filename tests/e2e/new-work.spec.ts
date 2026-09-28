/**
 * New Work (docs/product/feature-plan.md F5). 첫 화면(Workspace, `/`)에서 New Work 를 눌러 빈 업무를 만들고, 표식과 Copy 를 보고,
 * Open Work 로 그 업무에 간다. 주소 입력은 첫 화면 `/` 뿐이다.
 *
 * 순서 의존 — 이 파일은 주 시험 서버(3100)에서 inbox-to-work 다음에 돈다. 새 업무는 모두 "코치 대시보드" 에 만든다.
 * 앞 파일들은 이 프로젝트의 업무 수를 세지 않고, 뒤 파일들(preview · review · work-status)은 이 프로젝트를 보지 않는다.
 * 각 시험은 자기가 만든 업무만 확인하므로 이 파일만 따로 돌려도 같은 결과가 나온다.
 *
 * "표식을 넣은 PR 이 다음 Sync 에서 붙는다" 는 고정 데이터로 PR 을 새로 만들 수 없어 단위 시험(tests/unit/new-work.test.ts)이 확인한다.
 */
import { expect, type Page, test } from "@playwright/test";
import { nav, watchServerErrors } from "./helpers";

const MARKER = /^studio-work-[a-z0-9]+$/;
const GOAL = "코치가 선수 이름 두 글자로 3초 안에 찾는다";

/** Workspace 에서 New Work 폼을 열고 코치 대시보드에 업무를 만든다. 결과 칸의 표식을 돌려준다 */
async function createCoachWork(page: Page, title: string): Promise<string> {
  await page.goto("/");
  await page.getByRole("link", { name: "New Work" }).click();
  const form = page.getByTestId("new-work-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Project").selectOption({ label: "코치 대시보드" });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Goal").fill(GOAL);
  await form.getByRole("button", { name: "Create" }).click();
  const result = page.getByTestId("new-work-result");
  await expect(result).toBeVisible();
  const marker = String(await result.getByTestId("new-work-marker").textContent());
  expect(marker).toMatch(MARKER);
  return marker;
}

test.describe("클립보드를 쓸 수 있는 브라우저", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("New Work 로 빈 업무를 만들면 표식 · Copy · Open Work 가 보이고, Copy 가 표식을 복사하며, Open Work 로 그 업무에 간다", async ({ page }) => {
    const serverErrors = watchServerErrors(page);
    const marker = await createCoachWork(page, "  코치 목록 검색 필터 ");
    const result = page.getByTestId("new-work-result");
    await expect(result).toContainText("업무를 만들었다 · 코치 대시보드");
    await expect(result.getByTestId("new-work-title")).toHaveText("코치 목록 검색 필터"); // 앞뒤 공백은 떼고 받는다
    await expect(result.getByTestId("status-badge")).toHaveText("Draft");
    await expect(result.getByTestId("new-work-goal")).toHaveText(GOAL);
    await expect(result).toContainText("표식이 든 PR 은 다음 Sync 에서 이 업무에 붙고, 표식이 없는 PR 은 Inbox 로 간다.");
    await expect(page.getByRole("link", { name: "New Work" })).toHaveCount(0); // 결과를 보는 동안에는 머리의 버튼을 숨긴다
    await page.screenshot({ fullPage: true });

    await result.getByRole("button", { name: "Copy" }).click();
    await expect(result.getByTestId("copy-status")).toHaveText("복사했다.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(marker);

    await result.getByRole("link", { name: "Open Work" }).click();
    await expect(page).toHaveURL(new RegExp(`/works/${marker.replace("studio-work-", "")}$`));
    await expect(page.getByRole("heading", { level: 1, name: "코치 목록 검색 필터" })).toBeVisible();
    await expect(page.getByTestId("work-marker")).toHaveText(marker);
    await expect(page.locator(".work-head").getByTestId("status-badge")).toHaveText("Draft");
    await expect(page.getByText("아직 연결된 PR 이 없다.")).toBeVisible();
    // 목표는 대화 위에 고정되고, 할 일은 PR 을 연결하는 것이다
    await expect(page.getByTestId("goal-text")).toHaveText(GOAL);
    await expect(page.getByTestId("goal-edit")).toHaveText("Edit goal");
    await expect(page.getByTestId("next-action")).toHaveAttribute("data-kind", "link_pr");
    await expect(page.getByTestId("next-action")).toContainText(marker);

    // Workspace 의 업무 줄에도 표식이 보인다
    await nav(page).getByRole("link", { name: "Workspace" }).click();
    const row = page.getByTestId(`work-${marker.replace("studio-work-", "")}`);
    await expect(row).toContainText(`코치 대시보드 · PR 없음 · ${marker}`);
    await expect(page.getByRole("link", { name: "New Work" })).toBeVisible();
    expect(serverErrors).toEqual([]);
  });
});

test("클립보드가 막힌 브라우저에서는 미리 그렇게 적고, Copy 를 누르면 표식을 선택해 둔다 (결정 7)", async ({ page }) => {
  // http 주소로 휴대전화에서 연 경우처럼 클립보드가 없는 브라우저를 흉내 낸다
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  const marker = await createCoachWork(page, "코치 권한 정리");
  const result = page.getByTestId("new-work-result");
  await expect(result.getByTestId("copy-status")).toHaveText(
    "이 주소에서는 브라우저가 자동 복사를 막는다 — Copy 를 누르면 표식을 선택해 두니 직접 복사한다.",
  );
  await result.getByRole("button", { name: "Copy" }).click();
  await expect(result.getByTestId("copy-status")).toContainText("자동으로 복사하지 못했다 — 표식을 선택해 두었다.");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(marker);
});

test("제목이 공백뿐이면 업무를 만들지 않고, 폼을 다시 열어 이유를 보인다. Cancel 로 닫는다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  const coachWorks = page.locator('[data-project="coach"]');
  const before = await coachWorks.count();
  await page.getByRole("link", { name: "New Work" }).click();
  const form = page.getByTestId("new-work-form");
  await form.getByLabel("Project").selectOption({ label: "코치 대시보드" });
  await form.getByLabel("Title").fill("   "); // 브라우저의 required 는 공백을 막지 않는다 — 서버가 거절한다
  await form.getByLabel("Goal").fill(GOAL);
  await form.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("new-work-problem")).toHaveText("업무를 만들지 않았다 — 제목이 비어 있다. 업무의 목표를 한 줄로 적는다.");
  await expect(form.getByLabel("Project")).toHaveValue("coach"); // 고른 프로젝트는 남는다

  // 목표도 반드시 받는다 (결정 18) — 공백뿐이면 서버가 거절한다
  await form.getByLabel("Title").fill("코치 목록 정렬");
  await form.getByLabel("Goal").fill("   ");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("new-work-problem")).toHaveText(
    "업무를 만들지 않았다 — 목표가 비어 있다. 이 업무가 끝나면 무엇이 달라지는지 한두 문장으로 적는다.",
  );
  await page.goto("/");
  await expect(coachWorks).toHaveCount(before);

  await page.getByRole("link", { name: "New Work" }).click();
  await page.getByTestId("new-work-form").getByRole("link", { name: "Cancel" }).click();
  await expect(page.getByTestId("new-work-form")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New Work" })).toBeVisible();
  expect(serverErrors).toEqual([]);
});
