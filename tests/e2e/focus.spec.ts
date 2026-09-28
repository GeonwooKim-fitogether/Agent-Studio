/**
 * Focus 시안의 핵심 흐름 (결정 18). 자기 서버(3104)를 직접 켜서 본다 — 이 시험은 "GitHub 에 새 커밋이 올라왔다" 를 흉내 내려고
 * PR 의 최신 커밋을 바꾸므로, 다른 파일이 쓰는 주 시험 서버(3100)의 시연 데이터를 건드리지 않기 위해서다. 저장은 늘 메모리다.
 *
 *   1. Workspace → Needs your attention 줄 → Up next → 업무 화면 → Open review → Request changes(빈 칸 거절 → 채워 저장 → 타임라인에 이유 · 기준 · 커밋)
 *   2. 검토하는 동안 새 커밋이 도착 → 저장 거절 문구와 새 커밋으로 다시 그린 패널(적은 이유는 되살림) → 새 커밋으로 다시 판단해 저장
 *   3. 목표를 적고 고친다 (Set goal · Edit goal)
 *   4. Connections 에 AI models — Not connected 가 보이고, Flow · Agents 는 메뉴에 없다
 */
import { type ChildProcess, spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { nav, openReview, openWork, watchServerErrors } from "./helpers";

const PORT = 3104;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADS = join(tmpdir(), "agent-studio-e2e-focus-heads.json");
const NEW_HEAD = "c0ffee".repeat(6) + "c0ff"; // 40자
const SHOTS = process.env.FOCUS_SHOTS;

test.describe("Focus 흐름 (서버 3104)", () => {
  test.use({ baseURL: BASE });
  test.describe.configure({ mode: "serial" });
  let server: ChildProcess | null = null;

  test.beforeAll(async () => {
    rmSync(HEADS, { force: true });
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(PORT), "--hostname", "127.0.0.1"], {
      env: {
        ...process.env,
        DATABASE_URL: "",
        APP_ENV: "local",
        SYNC_INTERVAL_SECONDS: "0",
        GITHUB_TOKEN: "",
        GITHUB_REPOS: "",
        GITHUB_TOKEN_ORGS: "",
        GITHUB_APP_ID: "",
        GITHUB_APP_INSTALLATION_ID: "",
        GITHUB_APP_PRIVATE_KEY_PATH: "",
        GITHUB_APP_PRIVATE_KEY: "",
        PREVIEW_WORKDIR: "",
        PREVIEW_LOCAL_REPOS_DIR: "",
        STUDIO_FIXTURE_HEADS_FILE: HEADS,
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 100; i += 1) {
      try {
        if ((await fetch(BASE)).status < 500) return;
      } catch {
        // 아직 켜지는 중
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("Focus 시험용 서버가 30초 안에 켜지지 않았다");
  });

  test.afterAll(async () => {
    rmSync(HEADS, { force: true });
    if (server === null || server.exitCode !== null) return;
    const exited = new Promise((r) => server?.once("exit", r));
    server.kill("SIGTERM");
    await exited;
  });

  test("Workspace → attention 줄 → 업무 화면 → Open review → Request changes: 빈 칸은 거절되고, 채우면 타임라인에 이유 · 수정 기준 · 본 커밋이 남는다", async ({
    page,
  }) => {
    const serverErrors = watchServerErrors(page);
    await page.goto("/");
    const row = page.locator('[data-testid="attention-row"][data-work="a1b2c3"]');
    await expect(row).toContainText("로그인 화면 만들기");
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, "desktop-workspace.png") });
    await openWork(page, "a1b2c3");
    // 업무 화면의 Next action 이 곧바로 그 PR 의 Review 패널을 연다
    await page.getByTestId("next-action").getByTestId("next-action-button").click();
    const panel = page.getByTestId("review-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("review-commit")).toHaveText("3c4d5e6");
    await expect(panel.getByTestId("host-offline-note")).toBeVisible();
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, "desktop-review.png") });

    await panel.getByRole("button", { name: "Request changes" }).click();
    await expect(panel.getByTestId("review-problem")).toHaveAttribute("data-problem", "reason_missing");
    await panel.getByRole("textbox", { name: "Reason" }).fill("비밀번호 오류 문구가 두 번 보인다");
    await panel.getByRole("textbox", { name: "Done when" }).fill("오류 문구가 입력칸 아래에 한 번만 보이고, 390px 에서도 줄바꿈이 없다");
    await panel.getByRole("button", { name: "Request changes" }).click();
    await expect(page).toHaveURL(/\/works\/a1b2c3#decision-/);
    const line = page.getByTestId("timeline").locator('[data-kind="review"]').last();
    await expect(line).toContainText("커밋 3c4d5e6 에 Request changes");
    await expect(line.getByTestId("decision-reason")).toHaveText("비밀번호 오류 문구가 두 번 보인다");
    await expect(line.getByTestId("decision-done-when")).toHaveText("오류 문구가 입력칸 아래에 한 번만 보이고, 390px 에서도 줄바꿈이 없다");
    await expect(line.getByTestId("decision-commit")).toHaveText("3c4d5e6");
    await expect(page.getByTestId("next-action")).toHaveAttribute("data-kind", "checks_failing");
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, "desktop-work.png") });
    expect(serverErrors).toEqual([]);
  });

  test("검토하는 동안 새 커밋이 오면 저장하지 않고, 새 커밋으로 다시 그린 패널에서 다시 판단한다", async ({ page }) => {
    const serverErrors = watchServerErrors(page);
    await page.goto("/");
    await openWork(page, "a1b2c3");
    const panel = await openReview(page, 710001, 12);
    await expect(panel.getByTestId("review-commit")).toHaveText("3c4d5e6"); // 사람이 본 커밋
    await panel.getByRole("textbox", { name: "Reason" }).fill("본 화면 기준으로는 괜찮다");

    // 패널을 열어 둔 사이 GitHub 에 새 커밋이 올라왔다 (아직 Sync 전 — Studio 의 스냅샷은 옛 커밋이다)
    writeFileSync(HEADS, JSON.stringify({ "710001#12": NEW_HEAD }));
    await panel.getByRole("button", { name: "Approve in Studio" }).click();
    await expect(page).toHaveURL(/review=710001:12&problem=stale/);
    await expect(panel.getByTestId("review-problem")).toHaveText("새 커밋 c0ffeec 이 도착해 저장하지 않았다. 최신 커밋을 확인한 뒤 다시 판단한다.");
    await expect(panel.getByTestId("review-commit")).toHaveText("c0ffeec"); // 새 커밋으로 다시 그렸다
    await expect(panel.getByTestId("viewed-sha")).toHaveValue(NEW_HEAD);
    await expect(panel.getByRole("textbox", { name: "Reason" })).toHaveValue("본 화면 기준으로는 괜찮다"); // 적은 글은 되살린다
    await expect(panel.locator('[data-testid="review-decision"][data-freshness="current"]')).toHaveCount(0); // 새 커밋에는 아직 결정이 없다
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, "desktop-review-stale.png") });

    // 새 커밋을 보고 다시 누르면 새 커밋으로 남는다
    await panel.getByRole("button", { name: "Approve in Studio" }).click();
    await expect(page).toHaveURL(/\/works\/a1b2c3#decision-/);
    const line = page.getByTestId("timeline").locator('[data-kind="review"]').last();
    await expect(line).toContainText("커밋 c0ffeec 에 Approve in Studio");
    await expect(line.getByTestId("decision-reason")).toHaveText("본 화면 기준으로는 괜찮다");
    // 앞 시험의 수정 요청은 이전 커밋 카드의 기록으로 남는다 (계약 §6)
    await expect(page.getByTestId("pr-card-old-710001-12-3c4d5e6")).toContainText("Internal: changes requested");
    expect(serverErrors).toEqual([]);
  });

  test("휴대전화 폭: 검토 중에 새 커밋이 오면 전체 화면 패널에 같은 거절 문구가 보인다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, "phone-workspace.png") });
    await openWork(page, "a1b2c3");
    await expect(page.getByTestId("next-action").getByTestId("next-action-button")).toBeInViewport();
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, "phone-work.png") });
    await page.getByTestId("pr-card-710001-12").getByTestId("open-review").click();
    const panel = page.getByTestId("review-panel");
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, "phone-review.png") });
    writeFileSync(HEADS, JSON.stringify({ "710001#12": "d".repeat(40) }));
    await panel.getByRole("button", { name: "Request changes" }).click();
    await expect(panel.getByTestId("review-problem")).toHaveAttribute("data-problem", "reason_missing"); // 빈 칸 검사가 먼저다
    await panel.getByRole("textbox", { name: "Reason" }).fill("문구");
    await panel.getByRole("textbox", { name: "Done when" }).fill("기준");
    await panel.getByRole("button", { name: "Request changes" }).click();
    await expect(panel.getByTestId("review-problem")).toHaveText("새 커밋 ddddddd 이 도착해 저장하지 않았다. 최신 커밋을 확인한 뒤 다시 판단한다.");
    await expect(panel).toBeInViewport();
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, "phone-review-stale.png") });
  });

  test("목표를 적고 고친다 — 대화 위에 고정되고, 할 일이 목표 적기였다면 다음 할 일로 넘어간다", async ({ page }) => {
    const serverErrors = watchServerErrors(page);
    await page.goto("/");
    await openWork(page, "b4c5d6"); // Inbox 도 New Work 도 거치지 않은 시연 업무 — 목표가 비어 있다
    await expect(page.getByTestId("goal-text")).toContainText("아직 목표가 없다");
    await expect(page.getByTestId("next-action")).toHaveAttribute("data-kind", "set_goal");
    await page.getByTestId("next-action").getByTestId("next-action-button").click();
    const goal = page.getByTestId("goal");
    await goal.getByRole("textbox", { name: "Goal" }).fill("   ");
    await goal.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByTestId("goal-problem")).toContainText("목표가 비어 있다");
    await page.getByTestId("goal").getByRole("textbox", { name: "Goal" }).fill("코치가 로그인 한 번으로 오늘 경기 명단까지 간다");
    await page.getByTestId("goal").getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByTestId("goal-text")).toHaveText("코치가 로그인 한 번으로 오늘 경기 명단까지 간다");
    await expect(page.getByTestId("goal-edit")).toHaveText("Edit goal");
    await expect(page.getByTestId("next-action")).toHaveAttribute("data-kind", "link_pr");
    await page.getByTestId("goal-edit").click();
    await page.getByTestId("goal").getByRole("textbox", { name: "Goal" }).fill("코치가 로그인 한 번으로 경기 명단까지 간다");
    await page.getByTestId("goal").getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByTestId("goal-text")).toHaveText("코치가 로그인 한 번으로 경기 명단까지 간다");
    expect(serverErrors).toEqual([]);
  });

  test("Connections 에 AI models 는 Not connected 로 보이고, Flow · Agents · 모델 선택은 어디에도 없다 (결정 7 · 13)", async ({ page }) => {
    await page.goto("/");
    await expect(nav(page).getByRole("link", { name: /Flow|Agents/ })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Connections" }).click();
    const ai = page.getByTestId("ai-models");
    await expect(ai.getByRole("heading", { name: "AI models" })).toBeVisible();
    await expect(ai.getByTestId("ai-models-state")).toHaveText("Not connected");
    await expect(ai).toContainText("3단계 첫 단위(실행 경로 시험) 전에는 모델 선택 · Flow · Agents 를 열지 않는다");
    await expect(page.getByRole("combobox", { name: /model/i })).toHaveCount(0);
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, "desktop-connections.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(nav(page).getByRole("link", { name: "Connections" })).toHaveAttribute("aria-current", "page");
    if (SHOTS !== undefined) await page.screenshot({ path: join(SHOTS, "phone-connections.png"), fullPage: true });
  });
});
