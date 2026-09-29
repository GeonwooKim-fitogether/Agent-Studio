/**
 * Skills 탭 (결정 21 — Demo). 첫 화면에서 클릭으로만 간다. 칸 규칙(검증 · 같은 이름 · Used by 계산 · 순서)은 단위 시험(skill-draft.test.ts)이 본다.
 *
 *   1. Agents → Skills 탭 → New Skill → 이름 · 지시문 → Save draft → Agents 탭 Add Skill 에 그 Skill 이 보이고, 고르면 Used by 에 그 Agent 가 나온다
 *   2. 기본 Skill 은 칸이 읽기 전용이고 Save draft 가 없다. 어디에도 Run 버튼이 없다
 */
import { expect, type Page, test } from "@playwright/test";
import { hydrated, nav, watchServerErrors } from "./helpers";

async function expectNoRun(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /^\s*(Run|Test)\b/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^\s*(Run|Test)\b/ })).toHaveCount(0);
}

test("New Skill 로 만든 Skill 을 Agent 가 Add Skill 에서 고르면 그 Skill 의 Used by 에 그 Agent 가 나온다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await nav(page).getByRole("link", { name: /^Agents/ }).click();
  await page.getByTestId("tab-skills").click();
  await expect(page.getByTestId("tab-skills")).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("link", { name: /^Agents/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("demo-band")).toContainText("실행 연결 없음 — Skill 은 저장만 되고 아직 AI 에게 가지 않는다");

  await page.getByTestId("new-skill").click();
  await expect(page.getByTestId("skill-saved")).toContainText("Created draft");
  const editor = page.getByTestId("skill-editor");
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("새 Skill");
  await hydrated(page);
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Changelog");
  await editor.getByRole("textbox", { name: /^Instructions/ }).fill("병합된 변경을 한 줄씩 적는다.");
  await editor.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByTestId("skill-saved")).toContainText("Saved draft");
  await expect(editor.getByTestId("skill-used-by")).toHaveText("아직 쓰는 Agent 없음");
  await expect(page.getByTestId("skill-list")).toContainText("Changelog");
  await expectNoRun(page);

  await page.getByTestId("tab-agents").click();
  await page.getByTestId("agent-item-builder").click();
  const agent = page.getByTestId("agent-editor");
  await agent.getByTestId("add-skill").locator("summary").click();
  await agent.getByTestId("add-skill").getByRole("checkbox", { name: "Changelog" }).check();
  await agent.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByTestId("agent-saved")).toContainText("Saved draft");
  await expect(agent.getByTestId("agent-skills").getByRole("checkbox", { name: "Changelog" })).toBeChecked();

  await agent.getByTestId("add-skill").locator("summary").click();
  await agent.getByTestId("add-skill-to-skills").click();
  await page.getByTestId("skill-list").getByRole("link", { name: /Changelog/ }).click();
  const chip = page.getByTestId("skill-used-by").getByRole("link", { name: /Builder/ });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/\/agents\?agent=builder$/);
  await expect(page.getByTestId("agent-item-builder")).toHaveAttribute("aria-current", "true");
  expect(serverErrors).toEqual([]);
});

test("기본 Skill 은 칸이 읽기 전용이고 Save draft 가 없다", async ({ page }) => {
  const serverErrors = watchServerErrors(page);
  await page.goto("/");
  await nav(page).getByRole("link", { name: /^Agents/ }).click();
  await page.getByTestId("tab-skills").click();
  await page.getByTestId("skill-item-code_review").click();
  const editor = page.getByTestId("skill-editor");
  await expect(page.getByTestId("skill-locked")).toHaveText("기본 Skill — 고칠 수 없다");
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Code review");
  for (const name of [/^Name$/, /^What it does/, /^Instructions/]) await expect(editor.getByRole("textbox", { name })).not.toBeEditable();
  await expect(editor.getByRole("button", { name: "Save draft" })).toHaveCount(0);
  await expect(editor.getByTestId("skill-used-by")).toContainText("Reviewer");
  await expectNoRun(page);
  expect(serverErrors).toEqual([]);
});
