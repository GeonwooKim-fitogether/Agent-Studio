/**
 * 스레드 (docs/product/feature-plan.md F9). 한 단계만 · PR 카드의 스레드는 그 커밋의 카드에 · 메인 타임라인에는 개수만 · 스레드 조립.
 * 도메인 규칙(src/domain/memo.ts), 유스케이스(src/application/memo.ts writeReply), 조립(src/application/timeline.ts)을 함께 본다.
 */
import { describe, expect, it } from "vitest";
import { DEMO_REPO, DEMO_SHA } from "../../src/adapters/github/fixture/demo-scenario";
import { deleteMemo, editMemo, writeMemo, writeReply } from "../../src/application/memo";
import { getWorkChat } from "../../src/application/queries";
import { syncAll } from "../../src/application/sync";
import type { TimelineEntry } from "../../src/application/timeline";
import { isValidThreadTarget, type Memo, parseThreadKey, resolveThread, type ThreadTarget, threadKey } from "../../src/domain/memo";
import { setup } from "./helpers";

const WORK = "a1b2c3"; // 로그인 화면 만들기 — payments#12 의 이전 커밋(9f8e7d6) 카드와 최신 커밋(3c4d5e6) 카드가 있다
const PAYMENTS = DEMO_REPO.payments;
const latestCard: ThreadTarget = { kind: "card", repoId: PAYMENTS, number: 12, commitSha: DEMO_SHA.payments12Head };
const oldCard: ThreadTarget = { kind: "card", repoId: PAYMENTS, number: 12, commitSha: DEMO_SHA.payments12Reviewed };

async function ready() {
  const s = setup();
  await syncAll(s.deps);
  return s;
}
const chat = (deps: ReturnType<typeof setup>["deps"], thread: ThreadTarget | null = null) =>
  getWorkChat(deps, WORK, { now: "2026-09-25T00:00:00.000Z", thread }).then((c) => c!);
const cardOf = (timeline: readonly TimelineEntry[], sha: string) => timeline.find((e) => e.type === "card" && e.pr.number === 12 && e.commitSha === sha) as Extract<TimelineEntry, { type: "card" }>;
const ok = (r: { ok: true; memo: Memo } | { ok: false; problem: string }): Memo => {
  if (!r.ok) throw new Error(r.problem);
  return r.memo;
};

describe("스레드 이름과 대상의 모양", () => {
  it("threadKey 와 parseThreadKey 는 서로 되돌린다. 모양이 틀리면 null", () => {
    for (const t of [latestCard, { kind: "memo", memoId: "m1a2" } as const]) expect(parseThreadKey(threadKey(t))).toEqual(t);
    expect(threadKey(latestCard)).toBe(`card:${PAYMENTS}:12:${DEMO_SHA.payments12Head}`);
    for (const bad of ["", "memo:", "memo:A", "memo:a:b", "card:1:2", "card:x:2:abcdef1", "card:1:0:abcdef1", "card:1:2:ABCDEF1", "card:1:2:abc", "note:1"]) {
      expect(parseThreadKey(bad), bad).toBeNull();
    }
    expect(isValidThreadTarget({ kind: "card", repoId: 1, number: 1, commitSha: "abcdef1" })).toBe(true);
    expect(isValidThreadTarget({ kind: "card", repoId: 1.5, number: 1, commitSha: "abcdef1" })).toBe(false);
  });

  it("한 단계만: 답글을 대상으로 고르면 그 답글이 달린 항목의 스레드다", () => {
    const reply: Memo = { id: "r1", workId: "w", author: "me", body: "답", createdAt: "t", editedAt: null, deletedAt: null, thread: latestCard };
    expect(resolveThread({ kind: "memo", memoId: "r1" }, [reply])).toEqual(latestCard);
    expect(resolveThread({ kind: "memo", memoId: "m1" }, [reply])).toEqual({ kind: "memo", memoId: "m1" });
    expect(resolveThread(oldCard, [reply])).toEqual(oldCard);
  });
});

describe("답글 쓰기 (writeReply)", () => {
  it("메모에 답글을 달면 메인 타임라인에는 나타나지 않고, 그 메모에 답글 개수가 붙는다. 스레드에는 대상과 답글이 시간순으로 보인다", async () => {
    const { deps } = await ready();
    const root = ok(await writeMemo(deps, { workId: WORK, body: "문구 확인 필요" }));
    const target: ThreadTarget = { kind: "memo", memoId: root.id };
    const first = ok(await writeReply(deps, { workId: WORK, thread: target, body: "  인증 코드로 통일  " }));
    const second = ok(await writeReply(deps, { workId: WORK, thread: target, body: "둘째 답글" }));
    expect(first).toMatchObject({ body: "인증 코드로 통일", author: "me", thread: target });

    const view = await chat(deps, target);
    const memos = view.timeline.filter((e) => e.type === "memo");
    expect(memos.map((e) => e.memo.id)).toEqual([root.id]); // 답글은 메인 타임라인에 없다
    expect(memos[0]).toMatchObject({ replies: 2 });
    expect(view.thread).toMatchObject({ target, root: { type: "memo", memo: { id: root.id } }, closed: null });
    expect(view.thread!.replies.map((r) => r.id)).toEqual([first.id, second.id]);
  });

  it("답글에 답글은 같은 스레드에 들어간다 (한 단계만)", async () => {
    const { deps } = await ready();
    const root = ok(await writeMemo(deps, { workId: WORK, body: "메모" }));
    const reply = ok(await writeReply(deps, { workId: WORK, thread: { kind: "memo", memoId: root.id }, body: "답글" }));
    const nested = ok(await writeReply(deps, { workId: WORK, thread: { kind: "memo", memoId: reply.id }, body: "답글의 답글" }));
    expect(nested.thread).toEqual({ kind: "memo", memoId: root.id });
    const view = await chat(deps, { kind: "memo", memoId: reply.id }); // 답글을 골라 열어도 최상위 메모의 스레드가 열린다
    expect(view.thread!.target).toEqual({ kind: "memo", memoId: root.id });
    expect(view.thread!.replies.map((r) => r.body)).toEqual(["답글", "답글의 답글"]);
  });

  it("답글도 메모 규칙을 따른다 — 본문 검사 · 고치기 · 지우기. 지운 답글은 개수에서 빠지고 스레드에는 자리가 남는다", async () => {
    const { deps } = await ready();
    const root = ok(await writeMemo(deps, { workId: WORK, body: "메모" }));
    const target: ThreadTarget = { kind: "memo", memoId: root.id };
    expect(await writeReply(deps, { workId: WORK, thread: target, body: " \n " })).toEqual({ ok: false, problem: "empty" });
    expect(await writeReply(deps, { workId: WORK, thread: target, body: "탭\t가운데" })).toEqual({ ok: false, problem: "control_char" });
    const reply = ok(await writeReply(deps, { workId: WORK, thread: target, body: "답글" }));
    expect(await editMemo(deps, { workId: WORK, id: reply.id, body: "고친 답글" })).toEqual({ ok: true });
    expect((await chat(deps, target)).thread!.replies[0]).toMatchObject({ body: "고친 답글", editedAt: "2026-09-25T00:00:00.000Z" });
    expect(await deleteMemo(deps, { workId: WORK, id: reply.id })).toEqual({ ok: true });
    const view = await chat(deps, target);
    expect(view.timeline.find((e) => e.type === "memo")).toMatchObject({ replies: 0 });
    expect(view.thread!.replies).toMatchObject([{ id: reply.id, body: "", deletedAt: "2026-09-25T00:00:00.000Z" }]);
  });

  it("지운 메모의 스레드는 읽기만 한다 — 남은 답글은 보이고 새 답글은 no_thread", async () => {
    const { deps } = await ready();
    const root = ok(await writeMemo(deps, { workId: WORK, body: "메모" }));
    const target: ThreadTarget = { kind: "memo", memoId: root.id };
    ok(await writeReply(deps, { workId: WORK, thread: target, body: "답글" }));
    await deleteMemo(deps, { workId: WORK, id: root.id });
    expect(await writeReply(deps, { workId: WORK, thread: target, body: "또" })).toEqual({ ok: false, problem: "no_thread" });
    const view = await chat(deps, target);
    expect(view.thread).toMatchObject({ closed: "deleted_memo" });
    expect(view.thread!.replies).toHaveLength(1);
    expect(view.timeline.find((e) => e.type === "memo")).toMatchObject({ replies: 1 });
  });

  it("없는 업무는 no_work, 없는 메모 · 다른 업무의 메모 · 연결 안 된 PR · 다른 업무의 PR 은 no_thread 이고 아무것도 쓰지 않는다", async () => {
    const { deps } = await ready();
    const elsewhere = ok(await writeMemo(deps, { workId: "d0e1f2", body: "다른 업무의 메모" }));
    expect(await writeReply(deps, { workId: "ghost", thread: latestCard, body: "x" })).toEqual({ ok: false, problem: "no_work" });
    expect(await writeReply(deps, { workId: WORK, thread: { kind: "memo", memoId: "nope" }, body: "x" })).toEqual({ ok: false, problem: "no_thread" });
    expect(await writeReply(deps, { workId: WORK, thread: { kind: "memo", memoId: elsewhere.id }, body: "x" })).toEqual({ ok: false, problem: "no_thread" });
    expect(await writeReply(deps, { workId: "d0e1f2", thread: latestCard, body: "x" })).toEqual({ ok: false, problem: "no_thread" }); // 이 PR 은 a1b2c3 의 것
    expect(await writeReply(deps, { workId: WORK, thread: { ...latestCard, number: 999 }, body: "x" })).toEqual({ ok: false, problem: "no_thread" });
    expect(await deps.store.listMemos(WORK)).toEqual([]);
  });
});

describe("PR 카드의 스레드는 그 커밋의 카드에 붙는다", () => {
  it("최신 카드에만 새 답글을 단다. 이전 커밋 카드의 스레드는 읽기만 한다(no_thread · closed old_card)", async () => {
    const { deps } = await ready();
    const reply = ok(await writeReply(deps, { workId: WORK, thread: latestCard, body: "미리보기 확인했다" }));
    expect(reply.thread).toEqual(latestCard);
    expect(await writeReply(deps, { workId: WORK, thread: oldCard, body: "옛 카드에" })).toEqual({ ok: false, problem: "no_thread" });

    const view = await chat(deps, latestCard);
    expect(cardOf(view.timeline, DEMO_SHA.payments12Head)).toMatchObject({ latest: true, replies: 1 });
    expect(cardOf(view.timeline, DEMO_SHA.payments12Reviewed)).toMatchObject({ latest: false, replies: 0 });
    expect(view.thread).toMatchObject({ root: { type: "card", commitSha: DEMO_SHA.payments12Head, latest: true }, closed: null });
    expect((await chat(deps, oldCard)).thread).toMatchObject({ root: { type: "card", latest: false }, replies: [], closed: "old_card" });
  });

  it("새 커밋이 오면 새 카드가 0 에서 시작하고, 옛 답글은 옛 카드에 남는다 — 옛 카드의 스레드는 열어 읽을 수 있다", async () => {
    const { deps, data } = await ready();
    ok(await writeReply(deps, { workId: WORK, thread: latestCard, body: "코드 입력칸이 5칸으로 보인다" }));
    // GitHub 에 새 커밋이 올라온다
    const i = data.pullRequests.findIndex((p) => p.repoId === PAYMENTS && p.number === 12);
    const next = "e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3";
    data.pullRequests[i] = { ...data.pullRequests[i]!, headSha: next, updatedAt: "2026-09-25T01:00:00Z" };
    await syncAll(deps);

    const view = await chat(deps, latestCard);
    expect(cardOf(view.timeline, next)).toMatchObject({ latest: true, replies: 0 });
    expect(cardOf(view.timeline, DEMO_SHA.payments12Head)).toMatchObject({ latest: false, replies: 1 });
    expect(view.thread).toMatchObject({ closed: "old_card" });
    expect(view.thread!.replies.map((r) => r.body)).toEqual(["코드 입력칸이 5칸으로 보인다"]);
    // 옛 카드에는 새 답글을 달지 않고, 새 카드에는 단다
    expect(await writeReply(deps, { workId: WORK, thread: latestCard, body: "x" })).toEqual({ ok: false, problem: "no_thread" });
    ok(await writeReply(deps, { workId: WORK, thread: { ...latestCard, commitSha: next }, body: "새 커밋에서 6칸 확인" }));
    const after = await chat(deps);
    expect(cardOf(after.timeline, next)).toMatchObject({ replies: 1 });
    expect(cardOf(after.timeline, DEMO_SHA.payments12Head)).toMatchObject({ replies: 1 });
    expect(after.thread).toBeNull();
  });

  it("이 업무의 타임라인에 없는 대상의 스레드는 열리지 않는다(null)", async () => {
    const { deps } = await ready();
    expect((await chat(deps, { ...latestCard, number: 999 })).thread).toBeNull();
    expect((await chat(deps, { kind: "memo", memoId: "nope" })).thread).toBeNull();
  });
});
