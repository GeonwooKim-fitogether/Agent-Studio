/**
 * 업무 Chat 의 타임라인 조립 (docs/product/feature-plan.md F7, src/application/timeline.ts).
 * 순서 · 날짜 구분선 · 주인(GitHub · Studio) · 커밋별 카드 · 버튼은 최신 카드에만 · 기록 시작 줄.
 */
import { describe, expect, it } from "vitest";
import { DEMO_REPO, DEMO_SHA } from "../../src/adapters/github/fixture/demo-scenario";
import { deleteMemo, editMemo, writeMemo } from "../../src/application/memo";
import { getWorkChat, pickChatWork, type PrCardView } from "../../src/application/queries";
import { recordReviewDecision } from "../../src/application/review";
import { syncAll } from "../../src/application/sync";
import { buildTimeline, type TimelineEntry, type TimelineInput } from "../../src/application/timeline";
import type { ReviewDecision, Work } from "../../src/domain/model";
import type { Memo } from "../../src/domain/memo";
import type { PrEvent } from "../../src/domain/pr-event";
import { setup } from "./helpers";

const sha = (c: string) => c.repeat(40);
const work: Work = { id: "w1", projectId: "p", title: "업무", status: "in_progress", createdAt: "2026-09-27T01:00:00.000Z" };
const card = (number: number, headSha: string): PrCardView =>
  ({
    key: `1#${number}`,
    repoId: 1,
    number,
    repoName: "org/repo",
    title: `PR ${number}`,
    branch: "b",
    headSha,
    url: "u",
    github: { state: "open", checks: "passing", review: "none" },
    studio: { linkedWorkId: "w1", linkOrigin: "marker", markerFoundIn: ["body"], reviews: [], previews: [] },
  }) as PrCardView;
const ev = (e: Partial<PrEvent> & Pick<PrEvent, "id" | "kind" | "at">): PrEvent =>
  ({ repoId: 1, number: 1, workId: "w1", commitSha: sha("a"), ...e }) as PrEvent;
const input = (fields: Partial<TimelineInput>): TimelineInput => ({
  work,
  cards: [],
  events: [],
  statusChanges: [],
  reviews: [],
  memos: [],
  repoName: () => "org/repo",
  now: "2026-09-28T12:00:00.000Z",
  ...fields,
});
/** 비교하기 쉬운 한 줄 모양 */
const line = (e: TimelineEntry): string => {
  switch (e.type) {
    case "note":
      return `note:${e.since}`;
    case "day":
      return `day:${e.day}`;
    case "work_created":
      return "created";
    case "pr_event":
      return `${e.owner}:${e.event.kind}`;
    case "review":
      return `studio:review:${e.commitSha.slice(0, 1)}`;
    case "status":
      return `studio:status:${e.change.to}`;
    case "card":
      return `card:${e.pr.number}@${e.commitSha.slice(0, 1)}${e.latest ? ":latest" : ":old"}`;
    case "memo":
      return `studio:memo:${e.memo.id}${e.memo.deletedAt !== null ? ":deleted" : e.memo.editedAt !== null ? ":edited" : ""}`;
  }
};

describe("타임라인 조립 — 시간순 · 날짜 구분 · 주인", () => {
  it("업무 생성 → 연결 → 카드 → 새 커밋 → 새 카드 → 검사 → 검토 → 상태 순서로, 날짜가 바뀌면 구분선이 들어간다", () => {
    const events = [
      ev({ id: "l", kind: "linked", origin: "marker", commitSha: sha("a"), at: "2026-09-27T02:00:00.000Z" }),
      ev({ id: "n", kind: "new_commit", previousSha: sha("a"), commitSha: sha("b"), at: "2026-09-28T03:00:00.000Z" }),
      ev({ id: "c", kind: "checks", checks: "passing", commitSha: sha("b"), at: "2026-09-28T03:00:00.000Z" }),
    ];
    const reviews: ReviewDecision[] = [
      { id: "r", workId: "w1", repoId: 1, number: 1, commitSha: sha("b"), verdict: "internal_review_done", decidedAt: "2026-09-28T04:00:00.000Z" },
    ];
    const statusChanges = [
      { from: "draft", to: "in_progress", at: "2026-09-27T02:00:00.000Z", cause: { kind: "rule", rule: "R1", evidence: [] } },
      { from: "needs_review", to: "in_progress", at: "2026-09-28T04:00:00.000Z", cause: { kind: "rule", rule: "R3b", evidence: [] } },
    ] as const;
    const out = buildTimeline(input({ cards: [card(1, sha("b"))], events, reviews, statusChanges }));
    expect(out.map(line)).toEqual([
      "day:2026-09-27",
      "created",
      "studio:linked",
      "card:1@a:old",
      "studio:status:in_progress",
      "day:2026-09-28",
      "github:new_commit",
      "github:checks",
      "card:1@b:latest",
      "studio:review:b",
      "studio:status:in_progress",
    ]);
    expect(out.some((e) => e.type === "note")).toBe(false); // 모든 카드가 기록에서 왔다
  });

  it("날짜는 화면이 넘긴 시간대로 가른다 (dayOf)", () => {
    const out = buildTimeline(input({ dayOf: (iso) => (iso < "2026-09-27T15:00:00.000Z" ? "D1" : "D2") }));
    expect(out.map(line)).toEqual(["day:D1", "created"]);
  });
});

describe("PR 카드는 커밋 단위 — 버튼은 최신 카드에만", () => {
  it("같은 PR 의 새 커밋마다 카드가 쌓이고, 지금 커밋의 카드 하나만 최신이다. 이전 카드에는 그 커밋의 검사 기록이 붙는다", () => {
    const events = [
      ev({ id: "l", kind: "linked", origin: "user", commitSha: sha("a"), at: "2026-09-27T02:00:00.000Z" }),
      ev({ id: "ca", kind: "checks", checks: "failing", commitSha: sha("a"), at: "2026-09-27T02:30:00.000Z" }),
      ev({ id: "n1", kind: "new_commit", previousSha: sha("a"), commitSha: sha("b"), at: "2026-09-27T03:00:00.000Z" }),
      ev({ id: "n2", kind: "new_commit", previousSha: sha("b"), commitSha: sha("c"), at: "2026-09-27T04:00:00.000Z" }),
    ];
    const cards = buildTimeline(input({ cards: [card(1, sha("c"))], events })).filter((e) => e.type === "card");
    expect(cards.map((c) => [c.commitSha, c.latest, c.several, c.recordedChecks])).toEqual([
      [sha("a"), false, true, "failing"],
      [sha("b"), false, true, null],
      [sha("c"), true, true, null],
    ]);
  });

  it("카드가 하나뿐인 PR 은 several 이 아니고, 지금 연결되지 않은 PR(풀린 PR)의 이벤트는 줄로만 남고 카드가 없다", () => {
    const events = [
      ev({ id: "l2", kind: "linked", origin: "marker", number: 2, commitSha: sha("d"), at: "2026-09-27T02:00:00.000Z" }),
      ev({ id: "u2", kind: "unlinked", number: 2, commitSha: sha("d"), at: "2026-09-27T03:00:00.000Z" }),
      ev({ id: "l3", kind: "linked", origin: "marker", number: 3, commitSha: sha("e"), at: "2026-09-27T02:00:00.000Z" }),
    ];
    const out = buildTimeline(input({ cards: [card(3, sha("e"))], events }));
    expect(out.map(line)).toEqual(["day:2026-09-27", "created", "studio:linked", "studio:linked", "card:3@e:latest", "studio:unlinked"]);
    expect(out.find((e) => e.type === "card")).toMatchObject({ several: false });
  });

  it("기록이 생기기 전부터 연결된 PR(이벤트 없음)은 맨 위에 지금 모습의 카드가 오고, '기록은 지금부터' 줄이 먼저 온다", () => {
    const out = buildTimeline(input({ cards: [card(1, sha("a"))] }));
    expect(out.map(line)).toEqual(["note:2026-09-28T12:00:00.000Z", "card:1@a:latest", "day:2026-09-27", "created"]);
  });

  it("이벤트 없이 내부 검토 결정만 가리키는 이전 커밋은 그 결정 바로 앞에 카드가 되고, 기록 시작 줄은 첫 이벤트의 시각이다", () => {
    const reviews: ReviewDecision[] = [
      { id: "r", workId: "w1", repoId: 1, number: 1, commitSha: sha("z"), verdict: "changes_requested", decidedAt: "2026-09-27T05:00:00.000Z" },
    ];
    const events = [ev({ id: "l", kind: "linked", origin: "marker", commitSha: sha("a"), at: "2026-09-28T01:00:00.000Z" })];
    const out = buildTimeline(input({ cards: [card(1, sha("a"))], events, reviews }));
    expect(out.map(line)).toEqual([
      "note:2026-09-28T01:00:00.000Z",
      "day:2026-09-27",
      "created",
      "card:1@z:old",
      "studio:review:z",
      "day:2026-09-28",
      "studio:linked",
      "card:1@a:latest",
    ]);
  });
});

describe("시연 데이터로 — 업무 화면이 받는 모양 (getWorkChat)", () => {
  it("결제 서비스 업무: payments#12 는 검토 결정이 가리키는 이전 커밋 카드와 지금 커밋의 최신 카드, #15 는 최신 카드 하나", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const chat = await getWorkChat(deps, "a1b2c3", { now: "2026-09-25T00:00:00.000Z" });
    const cards = chat!.timeline.filter((e) => e.type === "card");
    expect(cards.map((c) => [c.pr.number, c.commitSha, c.latest])).toEqual([
      [12, DEMO_SHA.payments12Reviewed, false],
      [12, DEMO_SHA.payments12Head, true],
      [15, expect.any(String), true],
    ]);
    expect(chat!.timeline[0]).toMatchObject({ type: "note" });
    expect(chat!.channels.map((g) => g.project.id)).toEqual(["payments", "coach", "player", "admin", "docs"]);
    expect(chat!.channels[0]!.works).toEqual([{ id: "a1b2c3", title: "로그인 화면 만들기", status: "in_progress" }]);
  });

  it("Approve 하면 최신 카드 뒤에 검토 줄과 상태 줄이 쌓이고, 카드 수는 그대로다(같은 커밋)", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const before = (await getWorkChat(deps, "a1b2c3", { now: "2026-09-25T00:00:00.000Z" }))!.timeline;
    await recordReviewDecision(deps, { repoId: DEMO_REPO.payments, number: 12, workId: "a1b2c3", verdict: "internal_review_done" });
    const after = (await getWorkChat(deps, "a1b2c3", { now: "2026-09-25T00:00:00.000Z" }))!.timeline;
    expect(after.filter((e) => e.type === "card")).toHaveLength(before.filter((e) => e.type === "card").length);
    expect(after.at(-1)).toMatchObject({ type: "review", verdict: "internal_review_done", commitSha: DEMO_SHA.payments12Head });
  });

  it("없는 업무면 undefined. Chat 메뉴는 기억해 둔 업무가 있으면 그것, 없거나 사라졌으면 Workspace 의 첫 업무를 연다", async () => {
    const { deps } = setup();
    expect(await getWorkChat(deps, "nope", { now: "2026-09-25T00:00:00.000Z" })).toBeUndefined();
    expect(await pickChatWork(deps, "d0e1f2")).toBe("d0e1f2");
    expect(await pickChatWork(deps, "gone")).toBe("a1b2c3");
    expect(await pickChatWork(deps, null)).toBe("a1b2c3");
    const empty = setup({ seed: {} });
    expect(await pickChatWork(empty.deps, null)).toBeNull();
  });
});

describe("메모 (feature-plan F8)", () => {
  const memo = (id: string, createdAt: string, fields: Partial<Memo> = {}): Memo => ({
    id,
    workId: "w1",
    author: "me",
    body: `메모 ${id}`,
    createdAt,
    editedAt: null,
    deletedAt: null,
    thread: null,
    ...fields,
  });

  it("메모는 쓴 시각의 자리에 Studio 줄로 놓인다. 고쳐도 자리는 그대로이고, 지운 메모도 자리를 지킨다. 같은 시각이면 상태 변화 뒤다", () => {
    const statusChanges = [{ from: "draft", to: "in_progress", at: "2026-09-27T03:00:00.000Z", cause: { kind: "rule", rule: "R1", evidence: [] } }] as const;
    const memos = [
      memo("a", "2026-09-27T03:00:00.000Z", { editedAt: "2026-09-28T09:00:00.000Z" }),
      memo("b", "2026-09-27T02:00:00.000Z", { body: "", deletedAt: "2026-09-28T09:00:00.000Z" }),
      memo("c", "2026-09-28T01:00:00.000Z"),
    ];
    const out = buildTimeline(input({ statusChanges, memos }));
    expect(out.map(line)).toEqual([
      "day:2026-09-27",
      "created",
      "studio:memo:b:deleted",
      "studio:status:in_progress",
      "studio:memo:a:edited",
      "day:2026-09-28",
      "studio:memo:c",
    ]);
    expect(out.filter((e) => e.type === "memo").every((e) => e.owner === "studio")).toBe(true);
  });

  it("쓰고 · 고치고 · 지우면 업무 화면의 타임라인 끝에 그대로 보인다. 작성자는 me, 지운 메모의 본문은 남지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const written = await writeMemo(deps, { workId: "a1b2c3", body: "  로그인 화면 문구 다시 확인 필요\r\n둘째 줄  \n" });
    if (!written.ok) throw new Error(written.problem);
    expect(written.memo).toMatchObject({ workId: "a1b2c3", author: "me", body: "로그인 화면 문구 다시 확인 필요\n둘째 줄", editedAt: null, deletedAt: null });
    const last = async () => (await getWorkChat(deps, "a1b2c3", { now: "2026-09-25T00:00:00.000Z" }))!.timeline.at(-1);
    expect(await last()).toMatchObject({ type: "memo", memo: { id: written.memo.id, body: "로그인 화면 문구 다시 확인 필요\n둘째 줄" } });

    expect(await editMemo(deps, { workId: "a1b2c3", id: written.memo.id, body: "문구는 인증 코드로 통일" })).toEqual({ ok: true });
    expect(await last()).toMatchObject({ memo: { body: "문구는 인증 코드로 통일", editedAt: "2026-09-25T00:00:00.000Z" } });

    expect(await deleteMemo(deps, { workId: "a1b2c3", id: written.memo.id })).toEqual({ ok: true });
    expect(await last()).toMatchObject({ memo: { body: "", deletedAt: "2026-09-25T00:00:00.000Z" } });
    expect(await deleteMemo(deps, { workId: "a1b2c3", id: written.memo.id })).toEqual({ ok: true }); // 두 번 눌러도 된다
  });

  it("규칙에 걸리면 쓰지 않고 이유를 돌려준다. 지운 메모 · 없는 메모 · 다른 업무의 메모는 고치거나 지울 수 없다(no_memo), 없는 업무는 no_work", async () => {
    const { deps } = setup();
    await syncAll(deps);
    expect(await writeMemo(deps, { workId: "a1b2c3", body: " \n " })).toEqual({ ok: false, problem: "empty" });
    expect(await writeMemo(deps, { workId: "ghost", body: "메모" })).toEqual({ ok: false, problem: "no_work" });
    expect(await deps.store.listMemos("a1b2c3")).toEqual([]);

    const written = await writeMemo(deps, { workId: "a1b2c3", body: "메모" });
    if (!written.ok) throw new Error(written.problem);
    expect(await editMemo(deps, { workId: "a1b2c3", id: written.memo.id, body: "탭\t가운데" })).toEqual({ ok: false, problem: "control_char" });
    expect(await editMemo(deps, { workId: "d0e1f2", id: written.memo.id, body: "남의 업무" })).toEqual({ ok: false, problem: "no_memo" });
    expect(await deleteMemo(deps, { workId: "d0e1f2", id: written.memo.id })).toEqual({ ok: false, problem: "no_memo" });
    expect(await editMemo(deps, { workId: "a1b2c3", id: "nope", body: "x" })).toEqual({ ok: false, problem: "no_memo" });
    await deleteMemo(deps, { workId: "a1b2c3", id: written.memo.id });
    expect(await editMemo(deps, { workId: "a1b2c3", id: written.memo.id, body: "되살리기" })).toEqual({ ok: false, problem: "no_memo" });
    expect((await deps.store.listMemos("a1b2c3"))[0]).toMatchObject({ body: "", editedAt: null });
  });
});
