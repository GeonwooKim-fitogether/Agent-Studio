/**
 * 업무의 네 단계 — Goal · Build · Review · Finish on GitHub (결정 20, src/domain/work-path.ts).
 * Work details 의 Work path 와 Flow 화면이 같은 함수에서 상태를 받으므로, 상황마다 네 칸의 상태를 표로 못 박는다.
 */
import { describe, expect, it } from "vitest";
import { DEMO_REPO, demoStudioSeed } from "../../src/adapters/github/fixture/demo-scenario";
import { workPathOfSummary } from "../../src/application/flow";
import { getWorkDetail } from "../../src/application/queries";
import { syncAll } from "../../src/application/sync";
import { type PathDecision, type PathPr, workPathOf } from "../../src/domain/work-path";
import { setup } from "./helpers";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const pr = (fields: Partial<PathPr> = {}): PathPr => ({ repoId: 1, number: 12, headSha: HEAD, state: "open", checks: "passing", ...fields });
const decided = (fields: Partial<PathDecision> = {}): PathDecision => ({
  repoId: 1,
  number: 12,
  commitSha: HEAD,
  verdict: "changes_requested",
  decidedAt: "2026-09-25T00:00:00.000Z",
  ...fields,
});
const goal = { goal: "코치가 로그인한다", status: "in_progress" } as const;
const noGoal = { goal: "", status: "in_progress" } as const;

describe("workPathOf — 네 칸의 상태 표", () => {
  const cases: {
    name: string;
    work: { goal: string; status: "draft" | "in_progress" | "needs_review" | "done_candidate" | "done" };
    prs: PathPr[];
    decisions: PathDecision[];
    steps: [string, string, string, string];
    current: string | null;
  }[] = [
    { name: "목표도 PR 도 없다 → Goal 이 지금", work: { ...noGoal, status: "draft" }, prs: [], decisions: [], steps: ["current", "todo", "todo", "todo"], current: "goal" },
    { name: "목표만 있다 → Build 가 지금(PR 을 기다린다)", work: { ...goal, status: "draft" }, prs: [], decisions: [], steps: ["done", "current", "todo", "todo"], current: "build" },
    { name: "목표 없이 PR 이 있다 → Goal 은 끝나지 않았고 Review 가 지금", work: noGoal, prs: [pr()], decisions: [], steps: ["todo", "done", "current", "todo"], current: "review" },
    { name: "검사 실패 → Build 가 지금(작성자가 고칠 차례)", work: goal, prs: [pr({ checks: "failing" })], decisions: [], steps: ["done", "current", "todo", "todo"], current: "build" },
    { name: "최신 커밋에 Request changes → Build", work: goal, prs: [pr()], decisions: [decided()], steps: ["done", "current", "todo", "todo"], current: "build" },
    { name: "이전 커밋에 Request changes, 새 커밋 도착 → Review", work: goal, prs: [pr()], decisions: [decided({ commitSha: OLD })], steps: ["done", "done", "current", "todo"], current: "review" },
    {
      name: "최신 커밋에 Approve in Studio → Finish 가 지금",
      work: goal,
      prs: [pr()],
      decisions: [decided({ commitSha: OLD }), decided({ verdict: "internal_review_done", decidedAt: "2026-09-26T00:00:00.000Z" })],
      steps: ["done", "done", "done", "current"],
      current: "finish",
    },
    {
      name: "이전 커밋에 Approve, 새 커밋 도착 → 다시 Review",
      work: goal,
      prs: [pr()],
      decisions: [decided({ commitSha: OLD, verdict: "internal_review_done" })],
      steps: ["done", "done", "current", "todo"],
      current: "review",
    },
    { name: "병합됨 → 모두 지나감", work: goal, prs: [pr({ state: "merged" })], decisions: [], steps: ["done", "done", "done", "done"], current: null },
    { name: "병합됐어도 목표가 비었으면 Goal 은 끝나지 않았다", work: noGoal, prs: [pr({ state: "merged" })], decisions: [], steps: ["todo", "done", "done", "done"], current: null },
    { name: "업무가 완료(done) → 모두 지나감", work: { ...goal, status: "done" }, prs: [pr()], decisions: [], steps: ["done", "done", "done", "done"], current: null },
    { name: "PR 이 닫혔다 → Build(새 PR 을 기다린다)", work: goal, prs: [pr({ state: "closed" })], decisions: [], steps: ["done", "current", "todo", "todo"], current: "build" },
    { name: "검사 진행 중 → Review (사람이 볼 수 있다)", work: goal, prs: [pr({ checks: "pending" })], decisions: [], steps: ["done", "done", "current", "todo"], current: "review" },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const path = workPathOf(c.work, c.prs, c.decisions);
      expect([path.steps.goal, path.steps.build, path.steps.review, path.steps.finish]).toEqual(c.steps);
      expect(path.current).toBe(c.current);
    });
  }

  it("업무의 최신 PR 은 첫 열린 PR 이고, 열린 PR 이 없으면 마지막 PR 이다", () => {
    const merged = pr({ number: 15, state: "merged" });
    expect(workPathOf(goal, [pr({ number: 12 }), merged], []).pr?.number).toBe(12);
    expect(workPathOf(goal, [merged, pr({ number: 12 })], []).pr?.number).toBe(12);
    expect(workPathOf(goal, [pr({ number: 3, state: "closed" }), merged], []).pr?.number).toBe(15);
    expect(workPathOf(goal, [], []).pr).toBeNull();
  });

  it("그 PR 의 마지막 결정과 그것이 이전 커밋인지, 고리를 지나간 적이 있는지를 함께 준다", () => {
    const path = workPathOf(goal, [pr()], [decided({ commitSha: OLD, decidedAt: "2026-09-23T05:00:00.000Z" }), decided({ number: 99, verdict: "internal_review_done" })]);
    expect(path.decision).toMatchObject({ verdict: "changes_requested", commitSha: OLD, onLatestCommit: false });
    expect(path.requestedChanges).toBe(true);
    expect(path.approved).toBe(true); // 다른 PR 의 Approve 도 이 업무가 그 선을 지나간 기록이다
    expect(workPathOf(goal, [pr()], []).requestedChanges).toBe(false);
  });

  it("같은 시각의 결정은 들어온 순서의 뒤의 것이 마지막이다", () => {
    const at = "2026-09-25T00:00:00.000Z";
    const path = workPathOf(goal, [pr()], [decided({ decidedAt: at }), decided({ decidedAt: at, verdict: "internal_review_done" })]);
    expect(path.decision?.verdict).toBe("internal_review_done");
    expect(path.current).toBe("finish");
  });
});

describe("시연 업무에서 — 업무 화면과 Flow 가 같은 요약을 읽는다", () => {
  it("로그인 화면 만들기: 목표 없음 · Build 가 지금(검사 실패) · Review 는 이전 커밋의 Request changes · Finish 대기", async () => {
    const { deps } = setup({ seed: demoStudioSeed() });
    await syncAll(deps);
    const detail = await getWorkDetail(deps, "a1b2c3");
    const path = workPathOfSummary(detail!);
    expect(path.steps).toEqual({ goal: "todo", build: "current", review: "todo", finish: "todo" });
    expect(path.pr).toMatchObject({ repoId: DEMO_REPO.payments, number: 12 }); // #15 는 병합됐다 — 열린 #12 가 최신 PR 이다
    expect(path.decision).toMatchObject({ verdict: "changes_requested", onLatestCommit: false });
    expect(path.requestedChanges).toBe(true);
    expect(path.merged).toBe(false);
  });

  it("관리자 로그인 보안 점검: 최신 커밋에 Approve in Studio → Finish on GitHub 이 지금", async () => {
    const { deps } = setup({ seed: demoStudioSeed() });
    await syncAll(deps);
    const path = workPathOfSummary((await getWorkDetail(deps, "d0e1f2"))!);
    expect(path.current).toBe("finish");
    expect(path.approved).toBe(true);
  });
});
