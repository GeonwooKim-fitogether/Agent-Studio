/**
 * 업무 상태 규칙 (계약 §5-1 R1 ~ R6, feature-plan §4 의 반례, 결정 14 · 16). 순수 함수만 시험한다 — 저장소도 GitHub 도 없다.
 * 규칙마다 "걸리는 경우" 와 기획서 표의 "반례" 를 하나 이상 둔다.
 */
import { describe, expect, it } from "vitest";
import type { PrSnapshot, ReviewDecision, WorkStatus } from "../../src/domain/model";
import { decideWorkStatus, fingerprintOf, type StatusInput } from "../../src/domain/work-status";

const sha = (c: string) => c.repeat(40);
function pr(number: number, fields: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    repoId: 1,
    number,
    title: `PR ${number}`,
    body: "",
    branch: `b${number}`,
    headRepoId: 1,
    headSha: sha("a"),
    url: "u",
    author: "x",
    state: "open",
    checks: "passing",
    review: "none",
    updatedAt: "2026-09-28T00:00:00.000Z",
    ...fields,
  };
}
let seq = 0;
function review(p: PrSnapshot, verdict: ReviewDecision["verdict"], commitSha = p.headSha): StatusInput["reviews"][number] {
  seq += 1;
  return { repoId: p.repoId, number: p.number, commitSha, verdict, decidedAt: `2026-09-28T00:00:${String(seq % 60).padStart(2, "0")}.${String(seq).padStart(3, "0")}Z` };
}
const decide = (status: WorkStatus, prs: PrSnapshot[], reviews: StatusInput["reviews"] = [], pin: StatusInput["pin"] = null) =>
  decideWorkStatus({ status, prs, reviews, pin });
/** 걸린 규칙과 도착 상태만 뽑는다 */
const steps = (d: ReturnType<typeof decide>) =>
  d.transitions.map((t) => `${t.cause.kind === "rule" ? t.cause.rule : "person"}:${t.from}->${t.to}`);

describe("R1 — 초안인 업무에 처음으로 PR 이 연결되면 진행 중", () => {
  it("검사가 진행 중인 PR 이 연결되면 진행 중에서 멈춘다", () => {
    const d = decide("draft", [pr(1, { checks: "pending" })]);
    expect(steps(d)).toEqual(["R1:draft->in_progress"]);
    expect(d.status).toBe("in_progress");
  });

  it("검사가 끝난 PR 이 연결되면 R1 다음 R2 로 이어서 검토 필요가 된다 (이력 두 줄)", () => {
    expect(steps(decide("draft", [pr(1, { checks: "none" })]))).toEqual(["R1:draft->in_progress", "R2:in_progress->needs_review"]);
  });

  it("이미 병합된 PR 이 첫 연결이면 R1 다음 R4 로 완료 후보가 된다", () => {
    expect(steps(decide("draft", [pr(1, { state: "merged" })]))).toEqual(["R1:draft->in_progress", "R4:in_progress->done_candidate"]);
  });

  it("반례: PR 이 모두 빠져도(Unlink) 초안으로 되돌리지 않는다 — 어느 상태든 그대로다", () => {
    for (const status of ["in_progress", "needs_review", "done_candidate", "done"] as const) {
      expect(decide(status, []).transitions).toEqual([]);
    }
    expect(decide("draft", []).status).toBe("draft");
  });
});

describe("R2 — 열린 PR 의 최신 커밋 검사가 끝났고 아직 판단하지 않았으면 검토 필요", () => {
  it("검사 통과 · 검사 없음 둘 다 '끝났다' 로 본다", () => {
    expect(decide("in_progress", [pr(1, { checks: "passing" })]).status).toBe("needs_review");
    expect(decide("in_progress", [pr(1, { checks: "none" })]).status).toBe("needs_review");
  });

  it("반례: 검사 실패는 검토 필요로 만들지 않는다 (작성자가 고칠 차례)", () => {
    expect(decide("in_progress", [pr(1, { checks: "failing" })]).transitions).toEqual([]);
  });

  it("반례: 검사가 한없이 진행 중이면 진행 중으로 남는다 (기다림은 판단거리가 아니다)", () => {
    expect(decide("in_progress", [pr(1, { checks: "pending" })]).transitions).toEqual([]);
  });

  it("검토 필요에서 새 커밋이 와 다시 검사 중이면 진행 중으로 돌아간다 (R2)", () => {
    const d = decide("needs_review", [pr(1, { headSha: sha("b"), checks: "pending" })]);
    expect(steps(d)).toEqual(["R2:needs_review->in_progress"]);
  });

  it("이전 커밋에 대한 결정은 지금 커밋의 판단이 아니다 — 새 커밋의 검사가 끝나면 다시 검토 필요", () => {
    const old = pr(1, { headSha: sha("a") });
    const now = pr(1, { headSha: sha("b") });
    expect(decide("in_progress", [now], [review(old, "changes_requested")]).status).toBe("needs_review");
  });

  it("닫히거나 병합된 PR 은 검사가 통과해도 검토 필요를 만들지 않는다", () => {
    expect(decide("in_progress", [pr(1, { checks: "pending" }), pr(2, { state: "closed", checks: "passing" })]).transitions).toEqual([]);
  });

  it("근거에는 검토를 기다리는 PR 과 그 커밋만 들어간다", () => {
    const d = decide("in_progress", [pr(1, { checks: "failing" }), pr(2, { headSha: sha("c") })]);
    expect(d.transitions[0]?.cause).toEqual({ kind: "rule", rule: "R2", evidence: [{ repoId: 1, number: 2, commitSha: sha("c") }] });
  });
});

describe("R3 — 최신 커밋에 Request Changes 가 남으면 진행 중", () => {
  it("검토 필요에서 Request Changes 를 남기면 진행 중", () => {
    const p = pr(1);
    expect(steps(decide("needs_review", [p], [review(p, "changes_requested")]))).toEqual(["R3:needs_review->in_progress"]);
  });

  it("반례: PR 이 둘이고 하나만 수정 요청했으면, 다른 PR 이 R2 를 만족하는 동안 검토 필요로 남는다", () => {
    const a = pr(1);
    const b = pr(2);
    expect(decide("needs_review", [a, b], [review(a, "changes_requested")]).transitions).toEqual([]);
  });

  it("같은 커밋에 Approve 뒤 Request Changes 를 누르면 마지막 결정(R3)을 따른다", () => {
    const p = pr(1);
    const d = decide("needs_review", [p], [review(p, "internal_review_done"), review(p, "changes_requested")]);
    expect(steps(d)).toEqual(["R3:needs_review->in_progress"]);
  });
});

describe("R3b — 최신 커밋에 Approve(내부 검토 완료)가 남으면 진행 중 (결정 16)", () => {
  it("검토 필요에서 Approve 하면 진행 중 — GitHub 병합을 기다린다", () => {
    const p = pr(1);
    const d = decide("needs_review", [p], [review(p, "internal_review_done")]);
    expect(steps(d)).toEqual(["R3b:needs_review->in_progress"]);
    expect(d.transitions[0]?.cause).toEqual({ kind: "rule", rule: "R3b", evidence: [{ repoId: 1, number: 1, commitSha: p.headSha }] });
  });

  it("반례: 같은 업무에 아직 판단하지 않은 PR 이 남아 있으면 검토 필요를 유지한다", () => {
    const a = pr(1);
    const b = pr(2, { checks: "none" });
    expect(decide("needs_review", [a, b], [review(a, "internal_review_done")]).status).toBe("needs_review");
  });

  it("Approve 는 업무를 완료로 만들지 않는다 — 병합되기 전까지는 진행 중이다", () => {
    const p = pr(1);
    expect(decide("in_progress", [p], [review(p, "internal_review_done")]).transitions).toEqual([]);
  });
});

describe("R4 — 열린 PR 이 없고 하나 이상 병합됐으면 완료 후보 (자동 완료 없음)", () => {
  it("연결된 PR 이 모두 병합되면 완료 후보", () => {
    const d = decide("in_progress", [pr(1, { state: "merged" }), pr(2, { state: "merged" })]);
    expect(steps(d)).toEqual(["R4:in_progress->done_candidate"]);
  });

  it("병합된 것과 닫힌 것이 섞여도 병합이 하나 있으면 완료 후보", () => {
    expect(decide("needs_review", [pr(1, { state: "merged" }), pr(2, { state: "closed" })]).status).toBe("done_candidate");
  });

  it("자동으로 완료하지 않는다 — 완료 후보에서 다시 판정해도 완료 후보 그대로다", () => {
    const prs = [pr(1, { state: "merged" })];
    expect(decide("done_candidate", prs).transitions).toEqual([]);
    expect(decide("in_progress", prs).status).not.toBe("done");
  });

  it("반례: 모든 PR 이 병합 없이 닫혔으면 완료 후보가 아니다 — 진행 중으로 둔다", () => {
    expect(decide("in_progress", [pr(1, { state: "closed" })]).transitions).toEqual([]);
    const d = decide("needs_review", [pr(1, { state: "closed" }), pr(2, { state: "closed" })]);
    expect(steps(d)).toEqual(["R4:needs_review->in_progress"]);
  });

  it("열린 PR 이 하나라도 남아 있으면 완료 후보가 아니다", () => {
    expect(decide("in_progress", [pr(1, { state: "merged" }), pr(2, { checks: "pending" })]).transitions).toEqual([]);
  });

  it("완료 후보에 새 열린 PR 이 붙으면 다시 규칙대로(검사가 끝났으면 R2 검토 필요)", () => {
    expect(steps(decide("done_candidate", [pr(1, { state: "merged" }), pr(2)]))).toEqual(["R2:done_candidate->needs_review"]);
  });
});

describe("R5 — 완료인 업무에 새 PR 이 연결되거나 연결된 PR 이 다시 열리면 진행 중", () => {
  it("완료 뒤에 열린 PR 이 생기면 R5 로 진행 중, 검사가 끝났으면 이어서 R2 검토 필요", () => {
    expect(steps(decide("done", [pr(1, { state: "merged" }), pr(2, { checks: "pending" })]))).toEqual(["R5:done->in_progress"]);
    expect(steps(decide("done", [pr(1, { state: "merged" }), pr(2)]))).toEqual(["R5:done->in_progress", "R2:in_progress->needs_review"]);
  });

  it("병합된 PR 이 다시 열린 것처럼 보이면(닫힘 → 열림) 진행 중", () => {
    expect(decide("done", [pr(1, { state: "open", checks: "failing" })]).status).toBe("in_progress");
  });

  it("완료인 업무는 열린 PR 이 없으면 그대로다 — 모두 닫혀도, PR 이 빠져도", () => {
    expect(decide("done", [pr(1, { state: "merged" })]).transitions).toEqual([]);
    expect(decide("done", [pr(1, { state: "closed" })]).transitions).toEqual([]);
    expect(decide("done", []).transitions).toEqual([]);
  });
});

describe("R6 — 사람이 손으로 바꾼 상태는 다음 PR 변화까지 규칙이 덮지 않는다", () => {
  const p = pr(1); // 검사 통과, 판단 없음 — 규칙대로면 검토 필요

  it("PR 이 그대로면 사람이 고른 상태(초안)를 유지하고 기준점도 그대로다", () => {
    const pin = fingerprintOf([p]);
    const d = decide("draft", [p], [], pin);
    expect(d).toEqual({ status: "draft", pin, transitions: [] });
  });

  it.each([
    ["새 커밋", [pr(1, { headSha: sha("b") })]],
    ["병합", [pr(1, { state: "merged" })]],
    ["닫힘", [pr(1, { state: "closed" })]],
    ["새 연결", [p, pr(2, { checks: "pending" })]],
  ])("%s 이 오면 기준점을 놓고 규칙이 다시 판단한다", (_, prs) => {
    const d = decide("draft", prs, [], fingerprintOf([p]));
    expect(d.pin).toBeNull();
    expect(d.transitions[0]?.cause).toMatchObject({ kind: "rule", rule: "R1" });
  });

  it("연결이 빠지기만 한 것은 PR 변화가 아니다 — 사람의 상태를 유지한다", () => {
    const pin = fingerprintOf([p, pr(2)]);
    expect(decide("in_progress", [p], [], pin)).toEqual({ status: "in_progress", pin, transitions: [] });
  });

  it("내부 검토 결정만 새로 남아도 PR 변화가 아니므로 사람의 상태를 유지한다", () => {
    const pin = fingerprintOf([p]);
    expect(decide("done", [p], [review(p, "changes_requested")], pin).transitions).toEqual([]);
  });

  it("기준점을 놓았는데 규칙의 결론이 지금 상태와 같으면 이력 없이 기준점만 사라진다", () => {
    const d = decide("needs_review", [pr(1, { headSha: sha("b") })], [], fingerprintOf([p]));
    expect(d).toEqual({ status: "needs_review", pin: null, transitions: [] });
  });
});

describe("같은 입력이면 두 번째 판정은 아무것도 바꾸지 않는다 (이력이 겹쳐 쌓이지 않는다)", () => {
  it.each<[WorkStatus, PrSnapshot[]]>([
    ["draft", [pr(1)]],
    ["draft", [pr(1, { state: "merged" })]],
    ["done", [pr(1), pr(2, { state: "merged" })]],
    ["needs_review", [pr(1, { state: "closed" })]],
  ])("%s 에서 시작해 한 번 판정한 결과를 다시 넣으면 transitions 가 비어 있다", (status, prs) => {
    const first = decide(status, prs);
    expect(first.transitions.length).toBeGreaterThan(0);
    expect(decide(first.status, prs, [], first.pin).transitions).toEqual([]);
  });
});
