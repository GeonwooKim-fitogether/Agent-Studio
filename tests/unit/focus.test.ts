/**
 * Focus 시안의 규칙 (결정 18) — 본 커밋으로만 결정을 남긴다, Request changes 에는 이유와 수정 기준이 있어야 한다,
 * 오래된 미리보기는 결정을 막고 미리보기 기기가 꺼진 것은 막지 않는다, Workspace 는 같은 업무를 두 번 보이지 않는다,
 * 업무의 목표를 적고 고친다, 저장 직전에 PR 하나의 최신 커밋을 다시 읽는다.
 */
import { describe, expect, it } from "vitest";
import { DEMO_REPO, DEMO_SHA } from "../../src/adapters/github/fixture/demo-scenario";
import { createFixtureReader } from "../../src/adapters/github/fixture/fixture-reader";
import { type AttentionItem, collectAttention, type RunningPreview } from "../../src/application/attention";
import { attentionRows, nextActionFor, workspaceFocus } from "../../src/application/focus";
import { createWorkFromPr } from "../../src/application/inbox-actions";
import { createEmptyWork } from "../../src/application/new-work";
import { getWorkDetail, getWorkChat, getWorkspace } from "../../src/application/queries";
import { decisionBlockOf, readFreshHead, recordReviewDecision } from "../../src/application/review";
import { syncAll } from "../../src/application/sync";
import { setWorkGoal } from "../../src/application/work-goal";
import { checkReviewNote } from "../../src/domain/review-note";
import { checkWorkGoal, isAcceptedWorkGoal, MAX_WORK_GOAL_LENGTH } from "../../src/domain/work-goal";
import { readHeadOverrides } from "../../src/server/container";
import { setup } from "./helpers";

const payments12 = { repoId: DEMO_REPO.payments, number: 12 };
const NEW_HEAD = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const running = (commitSha: string, ref: { repoId: number; number: number } = payments12): RunningPreview => ({ target: { ...ref, commitSha }, phase: "running" });

describe("본 커밋으로만 결정을 남긴다 (결정 18 · 계약 §5)", () => {
  it("본 커밋이 최신이면 그 커밋으로 남고, 그사이 새 커밋이 오면 stale_commit 으로 거절하고 아무것도 쓰지 않는다", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    const viewed = DEMO_SHA.payments12Head; // 사람이 Review 패널을 열었을 때 본 커밋
    data.pullRequests = data.pullRequests.map((p) => (p.repoId === DEMO_REPO.payments && p.number === 12 ? { ...p, headSha: NEW_HEAD } : p));
    await syncAll(deps); // 저장 전에 새 커밋이 왔다
    const before = await deps.store.listReviewDecisions();
    await expect(
      recordReviewDecision(deps, { ...payments12, workId: "a1b2c3", verdict: "internal_review_done", viewedSha: viewed }),
    ).rejects.toMatchObject({ code: "stale_commit" });
    expect(await deps.store.listReviewDecisions()).toEqual(before);
    // 새 커밋을 보고 다시 누르면 새 커밋으로 남는다
    const decision = await recordReviewDecision(deps, { ...payments12, workId: "a1b2c3", verdict: "internal_review_done", viewedSha: NEW_HEAD });
    expect(decision.commitSha).toBe(NEW_HEAD);
  });

  it("Request changes 는 이유와 수정 기준이 모두 있어야 남고, 남은 결정과 타임라인에 둘이 그대로 보인다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const base = { ...payments12, workId: "a1b2c3", verdict: "changes_requested" as const, viewedSha: DEMO_SHA.payments12Head };
    const before = (await deps.store.listReviewDecisions()).length;
    for (const note of [{}, { reason: "문구가 겹친다" }, { doneWhen: "문구가 하나만 보인다" }, { reason: "  ", doneWhen: "\n" }]) {
      await expect(recordReviewDecision(deps, { ...base, ...note })).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(await deps.store.listReviewDecisions()).toHaveLength(before);

    const decision = await recordReviewDecision(deps, { ...base, reason: " 오류 문구가 두 번 보인다 ", doneWhen: "오류 문구가 한 번만 보인다\r\n모바일에서도" });
    expect(decision).toMatchObject({ reason: "오류 문구가 두 번 보인다", doneWhen: "오류 문구가 한 번만 보인다\n모바일에서도", commitSha: DEMO_SHA.payments12Head });
    const chat = await getWorkChat(deps, "a1b2c3", { now: "2026-09-25T00:00:00.000Z" });
    expect(chat?.timeline.filter((e) => e.type === "review").at(-1)).toMatchObject({
      type: "review",
      verdict: "changes_requested",
      commitSha: DEMO_SHA.payments12Head,
      reason: "오류 문구가 두 번 보인다",
      doneWhen: "오류 문구가 한 번만 보인다\n모바일에서도",
    });
    // Approve in Studio 는 이유 칸을 선택 메모로 쓰고, 수정 기준은 남기지 않는다
    const approve = await recordReviewDecision(deps, { ...base, verdict: "internal_review_done", doneWhen: "무시된다" });
    expect(approve).toMatchObject({ reason: null, doneWhen: null });
  });

  it("글 규칙: 제어 문자 · 길이 상한을 넘는 글은 받지 않는다", () => {
    expect(checkReviewNote("changes_requested", { reason: "a\tb", doneWhen: "c" })).toEqual({ ok: false, problem: "control_char" });
    expect(checkReviewNote("changes_requested", { reason: "x".repeat(2001), doneWhen: "c" })).toEqual({ ok: false, problem: "too_long" });
    expect(checkReviewNote("changes_requested", { reason: "a" })).toEqual({ ok: false, problem: "done_when_missing" });
    expect(checkReviewNote("changes_requested", { doneWhen: "a" })).toEqual({ ok: false, problem: "reason_missing" });
    expect(checkReviewNote("internal_review_done", {})).toEqual({ ok: true, reason: null, doneWhen: null });
  });
});

describe("미리보기와 결정 (Q10)", () => {
  it("이 PR 의 미리보기가 이전 커밋을 실행 중이면 결정을 막는다. 최신 커밋이거나 · 준비 중이거나 · 다른 PR 이거나 · 없으면 막지 않는다", () => {
    const pr = { ...payments12, state: "open" as const, headSha: DEMO_SHA.payments12Head };
    expect(decisionBlockOf(pr, running(DEMO_SHA.payments12Reviewed))).toBe("outdated_preview");
    expect(decisionBlockOf(pr, running(DEMO_SHA.payments12Head))).toBeNull();
    expect(decisionBlockOf(pr, { target: { ...payments12, commitSha: DEMO_SHA.payments12Reviewed }, phase: "installing" })).toBeNull();
    expect(decisionBlockOf(pr, running(DEMO_SHA.payments12Reviewed, { repoId: DEMO_REPO.adminConsole, number: 12 }))).toBeNull();
    expect(decisionBlockOf(pr, null)).toBeNull(); // 미리보기 기기가 꺼져 있어도 검토는 된다
    expect(decisionBlockOf({ ...pr, state: "merged" }, null)).toBe("merged");
  });

  it("서버도 같은 판정으로 거절한다 — 오래된 미리보기를 보고 최신 커밋을 승인하지 못한다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await expect(
      recordReviewDecision(deps, {
        ...payments12,
        workId: "a1b2c3",
        verdict: "internal_review_done",
        viewedSha: DEMO_SHA.payments12Head,
        preview: running(DEMO_SHA.payments12Reviewed),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("Workspace 는 같은 업무를 두 번 보이지 않는다 (Q5)", () => {
  const itemsFor = (workId: string, workTitle: string): AttentionItem[] => [
    { kind: "needs_review", workId, workTitle, pr: null },
    { kind: "checks_failing", workId, workTitle, pr: { repoName: "r", number: 1, headSha: "a".repeat(40) } },
  ];

  it("한 업무에 이유가 여럿이면 한 줄로 합치고 가장 앞선 이유를 앞에 둔다. Inbox 줄은 맨 뒤에 한 줄이다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const view = await getWorkspace(deps);
    const rows = attentionRows([...itemsFor("a1b2c3", "로그인 화면 만들기"), { kind: "inbox", count: 5 }], view);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "work", workId: "a1b2c3", projectName: "결제 서비스" });
    expect(rows[0]?.kind === "work" && rows[0].reasons.map((r) => r.kind)).toEqual(["needs_review", "checks_failing"]);
    expect(rows[1]).toEqual({ kind: "inbox", count: 5 });
  });

  it("Needs your attention 에 있는 업무는 Other work 에 없다. 필터 · 프로젝트 · 초점(Up next)", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const view = await getWorkspace(deps);
    const rows = attentionRows(collectAttention(view, null), view);
    const attentionIds = rows.flatMap((r) => (r.kind === "work" ? [r.workId] : []));
    expect(attentionIds).toEqual(["a1b2c3"]); // 시연 데이터: 결제 서비스의 검사 실패
    const focus = workspaceFocus(view, rows, { filter: "open", projectId: null, focusId: null });
    const otherIds = focus.other.map((w) => w.summary.work.id);
    expect(otherIds).not.toContain("a1b2c3");
    expect(otherIds.sort()).toEqual(["b4c5d6", "c7d8e9", "d0e1f2"]);
    expect(focus.counts).toEqual({ open: 3, done_candidate: 0, done: 0 });
    expect(focus.focus?.workId).toBe("a1b2c3"); // 고르지 않았으면 첫 줄
    expect(workspaceFocus(view, rows, { filter: "open", projectId: null, focusId: "nope" }).focus?.workId).toBe("a1b2c3");

    // 프로젝트 필터: attention 도 Other work 도 그 프로젝트만 (Inbox 줄은 남는다)
    const admin = workspaceFocus(view, rows, { filter: "open", projectId: "admin", focusId: null });
    expect(admin.attention.map((r) => r.kind)).toEqual(["inbox"]);
    expect(admin.other.map((w) => w.summary.work.id)).toEqual(["d0e1f2"]);
    expect(admin.focus).toBeNull();
    expect(workspaceFocus(view, rows, { filter: "done", projectId: null, focusId: null }).other).toEqual([]);
  });
});

describe("업무 화면의 Next action (Q6)", () => {
  it("상황마다 할 일 하나를 고른다 — 검사 실패, 판단할 PR, 오래된 미리보기, 목표 없음, PR 없음", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const login = (await getWorkDetail(deps, "a1b2c3"))!;
    expect(nextActionFor(login, null)).toMatchObject({ kind: "checks_failing", pr: { number: 12 } });
    expect(nextActionFor(login, running(DEMO_SHA.payments12Reviewed))).toMatchObject({ kind: "outdated_preview" });

    const docs = await createWorkFromPr(deps, { repoId: DEMO_REPO.docsSite, number: 12 });
    expect(nextActionFor((await getWorkDetail(deps, docs.id))!, null)).toMatchObject({ kind: "review", pr: { number: 12 } });

    const coach = (await getWorkDetail(deps, "b4c5d6"))!; // 목표가 비었고 PR 이 없다
    expect(nextActionFor(coach, null)).toEqual({ kind: "set_goal" });
    await setWorkGoal(deps, { workId: "b4c5d6", goal: "코치가 로그인 없이 대시보드를 보지 않게 한다" });
    expect(nextActionFor((await getWorkDetail(deps, "b4c5d6"))!, null)).toEqual({ kind: "link_pr" });

    // 관리자 로그인 보안 점검: 최신 커밋에 Studio 승인 → GitHub 병합을 기다린다 (목표를 적은 뒤)
    await setWorkGoal(deps, { workId: "d0e1f2", goal: "관리자 로그인에 2단계 인증을 붙인다" });
    expect(nextActionFor((await getWorkDetail(deps, "d0e1f2"))!, null)).toMatchObject({ kind: "await_merge" });
  });
});

describe("업무의 목표 (Q4)", () => {
  it("New Work 는 목표를 반드시 받는다. Set goal 로 적고 Edit goal 로 고치되 비울 수는 없다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    expect(await createEmptyWork(deps, { projectId: "coach", title: "검색 필터", goal: "  " })).toEqual({ ok: false, problem: "goal_empty" });
    expect(await createEmptyWork(deps, { projectId: "coach", title: "검색 필터", goal: "x".repeat(MAX_WORK_GOAL_LENGTH + 1) })).toEqual({
      ok: false,
      problem: "goal_too_long",
    });
    const made = await createEmptyWork(deps, { projectId: "coach", title: "검색 필터", goal: " 코치가 선수를 이름으로 찾는다\r\n3초 안에 " });
    expect(made.ok && made.work.goal).toBe("코치가 선수를 이름으로 찾는다\n3초 안에");

    // Inbox 의 PR 로 만든 업무는 목표가 비어 있다
    const fromPr = await createWorkFromPr(deps, { repoId: DEMO_REPO.docsSite, number: 12 });
    expect(fromPr.goal).toBe("");
    expect(await setWorkGoal(deps, { workId: fromPr.id, goal: "로그인 안내 문서를 한 쪽으로 줄인다" })).toMatchObject({ ok: true });
    expect((await deps.store.getWork(fromPr.id))?.goal).toBe("로그인 안내 문서를 한 쪽으로 줄인다");
    expect(await setWorkGoal(deps, { workId: fromPr.id, goal: "" })).toEqual({ ok: false, problem: "empty" });
    expect(await setWorkGoal(deps, { workId: "nowork", goal: "목표" })).toEqual({ ok: false, problem: "no_work" });
    expect((await deps.store.getWork(fromPr.id))?.goal).toBe("로그인 안내 문서를 한 쪽으로 줄인다");
  });

  it("글 규칙", () => {
    expect(checkWorkGoal("a\tb")).toEqual({ ok: false, problem: "control_char" });
    expect(isAcceptedWorkGoal("")).toBe(true);
    expect(isAcceptedWorkGoal(" 앞 공백")).toBe(false);
  });
});

describe("저장 직전에 PR 하나의 최신 커밋을 다시 읽는다 (Q9)", () => {
  it("리더가 단건 읽기를 알면 지금 최신 커밋을, 모르거나 · 저장소를 모르거나 · 실패하면 null 을 준다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    expect(await readFreshHead(deps, payments12)).toBeNull(); // 시험용 감싼 리더는 단건 읽기를 모른다
    const heads: Record<string, string> = {};
    const fixture = createFixtureReader({ repositories: await deps.store.listRepositories(), pullRequests: await deps.store.listSnapshots() }, {
      headOverrides: () => heads,
    });
    const withHead = { ...deps, reader: fixture };
    expect(await readFreshHead(withHead, payments12)).toBe(DEMO_SHA.payments12Head);
    heads[`${DEMO_REPO.payments}#12`] = NEW_HEAD; // GitHub 에 새 커밋이 올라왔다 (Sync 전)
    expect(await readFreshHead(withHead, payments12)).toBe(NEW_HEAD);
    expect(await readFreshHead(withHead, { repoId: 42, number: 1 })).toBeNull();
    expect(await readFreshHead(withHead, { repoId: DEMO_REPO.payments, number: 999 })).toBeNull();
  });

  it("고정 데이터의 커밋 덮기 파일은 모양이 맞는 줄만 읽고, 없거나 틀리면 아무것도 덮지 않는다", () => {
    const file = (text: string) => () => text;
    expect(readHeadOverrides("x", file(JSON.stringify({ "710001#12": NEW_HEAD, bad: NEW_HEAD, "1#2": "short" })))).toEqual({ "710001#12": NEW_HEAD });
    expect(readHeadOverrides("x", file("not json"))).toEqual({});
    expect(
      readHeadOverrides("x", () => {
        throw new Error("없다");
      }),
    ).toEqual({});
  });
});
