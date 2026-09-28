/**
 * Flow · Agents (결정 20 — Demo). 첫 화면에서 클릭으로만 간다.
 *
 *   1. 사이드바 Flow → 마지막으로 연 업무의 Flow. 네 노드의 상태가 업무의 실제 기록(목표 · PR · 결정)과 같고, Work path 도 같은 말을 한다
 *   2. Review 노드 → 기존 Review 패널. Build 노드 → Open in Agents → Builder 가 골라진 Agents, "Flow 에서 쓰는 곳" 링크로 돌아온다
 *   3. Agents: Add Agent(이름만) → 편집 칸 → Add Skill · Save draft → 다른 초안을 봤다 돌아와도 남는다. 빈 이름은 칸 옆 한 줄로 거절
 *   4. 어디에도 Run 버튼이 없고, AI model 칸은 비활성이다
 *   5. 휴대전화 폭: 아래 탭 다섯 칸, 설명 칸은 흐름도 아래
 */
import { expect, type Page, test } from "@playwright/test";
import { hydrated, nav, openWork, watchServerErrors } from "./helpers";

const DEMO_FLOW = "실행 연결 없음 — 흐름은 기록을 보여 줄 뿐 아무것도 실행하지 않는다";
const DEMO_AGENTS = "실행 연결 없음 — 지시문은 저장만 되고 아직 AI 에게 가지 않는다";

async function expectNoRun(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /^\s*Run\b/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^\s*Run\b/ })).toHaveCount(0);
}

test("사이드바 Flow 는 마지막으로 연 업무의 흐름도를 열고, 노드는 실제 기록을 비추며 Open in Agents 가 Builder 를 고른다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await openWork(page, "d0e1f2"); // 먼저 다른 업무를 연다
  await hydrated(page);
  await openWork(page, "a1b2c3"); // 마지막으로 연 업무
  await hydrated(page);
  // Work details 의 Work path 도 같은 네 단계 이름과 상태다
  const workPath = page.getByTestId("work-path");
  await expect(workPath).toHaveAttribute("data-step", "build");
  await expect(workPath).toContainText("Goal");
  await expect(workPath).toContainText("Finish on GitHub");
  await expect(workPath.locator('[data-step="goal"]')).toHaveAttribute("data-state", "todo"); // 목표가 비어 있다
  await expectNoRun(page);

  await nav(page).getByRole("link", { name: "Workspace" }).click();
  await nav(page).getByRole("link", { name: /^Flow/ }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3\/flow$/);
  await expect(nav(page).getByRole("link", { name: /^Flow/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("demo-band")).toContainText(DEMO_FLOW);
  await expect(page.getByTestId("tab-flow")).toHaveAttribute("aria-current", "page");

  await expect(page.getByTestId("flow-node-goal")).toHaveAttribute("data-state", "todo");
  await expect(page.getByTestId("flow-node-goal")).toContainText("목표 없음");
  const build = page.getByTestId("flow-node-build");
  await expect(build).toHaveAttribute("data-state", "current");
  await expect(build).toContainText("지금");
  await expect(build.getByTestId("flow-build-pr")).toHaveText("#12"); // #15 는 병합됐다 — 열린 #12 가 최신 PR
  await expect(build.getByTestId("pr-icons").locator('[data-slot="checks"]')).toHaveAttribute("data-value", "failing");
  await expect(page.getByTestId("flow-review-decision")).toHaveText("Request changes");
  await expect(page.getByTestId("flow-review-old")).toHaveText("이전 커밋");
  await expect(page.getByTestId("flow-node-finish")).toContainText("대기");
  await expect(page.getByTestId("flow-loop")).toHaveAttribute("data-passed", "true"); // Request changes 를 지나간 적이 있다
  await expect(page.getByTestId("flow-approve")).toHaveAttribute("data-passed", "false");
  const inspector = page.getByTestId("flow-inspector");
  await expect(inspector).toHaveAttribute("data-step", "build"); // 처음엔 지금 단계
  await expect(inspector).toContainText("PR 작성자 — 지금은 Studio 밖에서 커밋한다");
  await expectNoRun(page);

  // Review 노드 → 기존 Review 패널
  await page.getByTestId("flow-node-review").click();
  await expect(inspector).toHaveAttribute("data-step", "review");
  await inspector.getByRole("link", { name: "Open review" }).click();
  await expect(page.getByTestId("review-panel")).toBeVisible();
  await expect(page).toHaveURL(/\/works\/a1b2c3\?review=710001:12/);

  // Build 노드 → Open in Agents → Builder
  await page.getByTestId("tab-flow").click();
  await page.getByTestId("flow-node-build").click();
  await page.getByTestId("flow-inspector").getByRole("link", { name: "Open in Agents" }).click();
  await expect(page).toHaveURL(/\/agents\?agent=builder$/);
  await expect(page.getByTestId("agent-item-builder")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("agent-editor").getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Builder");
  await expect(page.getByTestId("demo-band")).toContainText(DEMO_AGENTS);
  const model = page.getByRole("combobox", { name: "AI model" });
  await expect(model).toBeDisabled();
  await expect(model).toHaveValue("none");
  await expect(page.getByTestId("agent-editor")).toContainText("Runtime");
  await expectNoRun(page);
  await page.getByTestId("agent-used-in").getByRole("link", { name: "로그인 화면 만들기 — Build" }).click();
  await expect(page).toHaveURL(/\/works\/a1b2c3\/flow\?node=build/);
  expect(serverErrors).toEqual([]);
});

test("Agents: Add Agent 로 이름만 적어 만들고, 칸을 채워 Save draft 하면 남는다. 빈 이름은 칸 옆에서 거절한다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await nav(page).getByRole("link", { name: /^Agents/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();
  await expect(page.getByTestId("agent-list").locator(".agent-item")).toHaveText([/Planner/, /Builder/, /Reviewer/]);
  await expect(page.getByTestId("agent-used-in")).toHaveCount(0); // Planner 는 Flow 에서 쓰이지 않는다

  await page.getByTestId("add-agent").locator("summary").click();
  await page.getByRole("textbox", { name: "New agent name" }).fill("Tester");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/agents\?agent=[a-z0-9]+&created=1$/);
  await expect(page.getByTestId("agent-saved")).toContainText("Created draft");
  const editor = page.getByTestId("agent-editor");
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Tester");
  const testerUrl = page.url().replace(/&created=1$/, "");

  await hydrated(page);
  await editor.getByRole("textbox", { name: /^What it does/ }).fill("시험을 먼저 쓴다.");
  await editor.getByRole("textbox", { name: /^Instructions/ }).fill("바꿀 코드의 시험을 먼저 쓴다.\n시험이 실패하는 것을 확인한다.");
  await editor.getByTestId("add-skill").locator("summary").click();
  await editor.getByTestId("add-skill").getByRole("checkbox", { name: "Code review" }).check();
  await editor.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByTestId("agent-saved")).toContainText("Saved draft");

  // 다른 초안을 봤다가 돌아와도 남아 있다
  await page.getByTestId("agent-item-planner").click();
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Planner");
  await page.getByTestId("agent-list").getByRole("link", { name: /Tester/ }).click();
  await expect(page).toHaveURL(testerUrl);
  await expect(editor.getByRole("textbox", { name: /^What it does/ })).toHaveValue("시험을 먼저 쓴다.");
  await expect(editor.getByRole("textbox", { name: /^Instructions/ })).toHaveValue("바꿀 코드의 시험을 먼저 쓴다.\n시험이 실패하는 것을 확인한다.");
  await expect(editor.getByTestId("agent-skills").getByRole("checkbox", { name: "Code review" })).toBeChecked();
  await expect(page.getByTestId("agent-list")).toContainText("시험을 먼저 쓴다."); // 소개는 목록에 보인다

  // 빈 이름(공백만) → 칸 옆 한 줄, 적은 소개는 되살린다, 저장된 이름은 그대로
  await hydrated(page);
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("   ");
  await editor.getByRole("textbox", { name: /^What it does/ }).fill("고친 소개");
  await editor.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByTestId("agent-problem-name")).toContainText("이름이 비어 있다");
  await expect(editor.getByRole("textbox", { name: /^What it does/ })).toHaveValue("고친 소개");
  await expect(page.getByTestId("agent-saved")).toHaveCount(0);
  await expect(page.getByTestId("agent-list").getByRole("link", { name: /Tester/ })).toContainText("시험을 먼저 쓴다.");
  await expectNoRun(page);
  expect(serverErrors).toEqual([]);
});

test.describe("휴대전화 폭", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("아래 탭은 다섯 칸이고 Connections 는 위쪽 줄 아이콘이다. Flow 의 설명 칸은 흐름도 아래에 온다", async ({ page }) => {
    const serverErrors = watchServerErrors(page);
    await page.goto("/");
    await expect(nav(page).getByRole("link")).toHaveCount(5);
    await nav(page).getByRole("link", { name: /^Flow/ }).click();
    await expect(page).toHaveURL(/\/works\/[a-z0-9]+\/flow$/);
    const [canvas, inspector] = [await page.getByTestId("flow-canvas").boundingBox(), await page.getByTestId("flow-inspector").boundingBox()];
    expect(inspector!.y).toBeGreaterThan(canvas!.y + canvas!.height - 1);
    await nav(page).getByRole("link", { name: /^Agents/ }).click();
    await expect(page.getByRole("combobox", { name: "AI model" })).toBeDisabled();
    await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Connections" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Connections" })).toBeVisible();
    expect(serverErrors).toEqual([]);
  });
});
