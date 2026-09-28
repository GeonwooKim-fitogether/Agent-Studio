/** 화면 라벨 — GitHub 와 Studio 의 표기가 겹치지 않는지, 연결 표기 · 사유 · 한국 시간이 맞는지. */
import { describe, expect, it } from "vitest";
import {
  allSameRepo,
  DONE_CANDIDATE_NOTE,
  formatAgo,
  formatKst,
  GITHUB_REVIEW,
  inboxReasonText,
  linkLabel,
  NO_INTERNAL_REVIEW,
  prEventText,
  prRef,
  reviewProblemText,
  statusChangeText,
  VERDICT,
  WORK_STATUS,
} from "../../src/app/components/labels";

describe("화면 라벨", () => {
  it("Studio 의 내부 검토 표기는 모두 Internal: 로 시작하고, GitHub 리뷰 표기와 하나도 겹치지 않는다", () => {
    const studio = [...Object.values(VERDICT), NO_INTERNAL_REVIEW];
    for (const label of studio) expect(label.startsWith("Internal:")).toBe(true);
    for (const label of Object.values(GITHUB_REVIEW)) expect(studio).not.toContain(label);
    expect(VERDICT.changes_requested).not.toBe(GITHUB_REVIEW.changes_requested);
  });

  it("연결 표기: 사람이 연결하면 Linked manually, 표식이면 표식을 찾은 자리를 함께", () => {
    expect(linkLabel("user", [])).toBe("Linked manually");
    expect(linkLabel("marker", ["body"])).toBe("Linked by marker (body)");
    expect(linkLabel("marker", ["branch"])).toBe("Linked by marker (branch)");
    expect(linkLabel("marker", ["body", "branch"])).toBe("Linked by marker (body, branch)");
    expect(linkLabel(null, [])).toBe("Not linked");
  });

  it("Inbox 사유: 다른 프로젝트의 표식에는 그 프로젝트 이름이 들어가고, 표식이 없어 온 보통의 PR 에는 사유가 없다", () => {
    expect(inboxReasonText("other_project", ["a1b2c3"], "결제 서비스")).toBe("표식 studio-work-a1b2c3 는 다른 프로젝트('결제 서비스')의 업무를 가리킨다");
    expect(inboxReasonText("no_marker", [])).toBeNull();
    expect(inboxReasonText("fork_head", [])).toContain("복제본");
    expect(inboxReasonText("unlinked_by_user", [], null, "로그인 화면 만들기")).toBe("사람이 연결을 풀었다('로그인 화면 만들기' 업무에서) · 자동으로 다시 붙지 않는다");
  });

  it("마지막 동기화 시각은 한국 시간(KST)으로 보인다", () => {
    expect(formatKst("2026-09-25T05:19:08.000Z")).toBe("2026-09-25 14:19:08 KST");
    expect(formatKst("2026-09-25T20:00:00.000Z")).toBe("2026-09-26 05:00:00 KST"); // 날짜가 넘어간다
  });

  it("업무 상태 이름은 시안 v2 와 같다 (Done candidate 포함)", () => {
    expect(Object.values(WORK_STATUS)).toEqual(["Draft", "In progress", "Needs review", "Done candidate", "Done"]);
    expect(DONE_CANDIDATE_NOTE).toContain("연결된 PR 이 모두 병합됐다. 업무는 PR 보다 클 수 있어 자동으로 완료하지 않는다");
  });

  it("상태 이력 한 줄: 규칙 번호 · 근거 PR 과 커밋 · 이유 · 한국 시간. 사람이 바꿨으면 그 사실과 R6 의 약속", () => {
    const at = "2026-09-28T01:02:00.000Z";
    expect(
      statusChangeText(
        { from: "in_progress", to: "needs_review", at, cause: { kind: "rule", rule: "R2", evidence: [{ repoName: "demo-org/docs-site", number: 12, commitSha: "6f7a8b9c0d" }] } },
        false,
      ),
    ).toBe("규칙 R2 · demo-org/docs-site#12 커밋 6f7a8b9 · 최신 커밋의 검사가 끝났고 아직 판단하지 않았다 · 2026-09-28 10:02:00 KST");
    expect(statusChangeText({ from: "needs_review", to: "in_progress", at, cause: { kind: "rule", rule: "R4", evidence: [] } }, false)).toContain(
      "모두 병합 없이 닫혔다",
    );
    expect(statusChangeText({ from: "done_candidate", to: "done", at, cause: { kind: "person", action: "mark_done" } }, true)).toBe(
      "사람이 Mark as Done 을 눌렀다 · 다음 PR 변화까지 규칙이 덮지 않는다 · 2026-09-28 10:02:00 KST",
    );
    expect(statusChangeText({ from: "draft", to: "in_progress", at, cause: { kind: "person", action: "set_status" } }, false)).toBe(
      "사람이 상태를 In progress 로 바꿨다 · 2026-09-28 10:02:00 KST",
    );
    expect(statusChangeText(null, false)).toBe("아직 규칙이나 사람이 상태를 바꾼 적이 없다");
  });

  it("마지막 동기화가 얼마 전인지: 1분 전까지는 방금, 그다음은 분, 한 시간부터는 시간", () => {
    const now = new Date("2026-09-28T01:00:00.000Z").getTime();
    expect(formatAgo("2026-09-28T00:59:30.000Z", now)).toBe("방금");
    expect(formatAgo("2026-09-28T00:57:00.000Z", now)).toBe("3분 전");
    expect(formatAgo("2026-09-27T22:30:00.000Z", now)).toBe("2시간 전");
  });

  it("PR 을 가리키는 글자: 한 업무의 PR 이 모두 같은 저장소면 #번호만, 섞여 있으면 짧은 저장소 이름을 붙인다 (결정 19)", () => {
    expect(allSameRepo(["demo-org/payments", "demo-org/payments"])).toBe(true);
    expect(allSameRepo([])).toBe(true);
    expect(allSameRepo(["demo-org/payments", "demo-org/docs-site"])).toBe(false);
    expect(prRef("demo-org/payments", 12, true)).toBe("#12");
    expect(prRef("demo-org/payments", 12, false)).toBe("payments#12");
  });

  it("타임라인 줄과 stale 문구에는 저장소 이름 · 커밋 번호가 없다 (결정 19 — 사실 하나는 한 자리에만)", () => {
    const base = { id: "e1", repoId: 1, number: 12, at: "2026-09-28T01:00:00.000Z", commitSha: "3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d" };
    const linked = prEventText({ ...base, kind: "linked", origin: "marker" } as Parameters<typeof prEventText>[0]);
    expect(linked).toBe("연결됨");
    expect(prEventText({ ...base, kind: "checks", checks: "failing" } as Parameters<typeof prEventText>[0])).toBe("검사 실패");
    expect(prEventText({ ...base, kind: "merged" } as Parameters<typeof prEventText>[0])).toBe("병합됨");
    const stale = reviewProblemText("stale");
    expect(stale).toBe("새 커밋이 도착해 저장하지 않았다 — 위의 커밋이 새 판단 대상이다. 확인한 뒤 다시 판단한다.");
    expect(stale).not.toMatch(/[0-9a-f]{7}/);
  });
});
