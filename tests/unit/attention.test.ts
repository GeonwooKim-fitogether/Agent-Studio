/**
 * Needs your attention (feature-plan F4) — 이미 있는 상태 넷(검토 필요 업무 · 검사 실패 PR · 이전 버전 미리보기 · Inbox 개수)을
 * 모으기만 하는 순수 함수. 시연 데이터(fixture)로 유스케이스를 돌린 뒤 Workspace 모양에서 모은다.
 *
 * 시연 데이터의 첫 모습에서 모이는 것은 둘이다.
 *   Checks failing  로그인 화면 만들기 · payments#12 (열림 · 검사 실패)
 *   Inbox           열린 PR 5개 (payments#18 복제본 · coach-web#12 · player-app#12 · player-app#9 · docs-site#12)
 */
import { describe, expect, it } from "vitest";
import { DEMO_REPO, DEMO_SHA } from "../../src/adapters/github/fixture/demo-scenario";
import { type AttentionItem, collectAttention, type RunningPreview } from "../../src/application/attention";
import { createWorkFromPr, unlinkPr } from "../../src/application/inbox-actions";
import { getWorkspace } from "../../src/application/queries";
import { syncAll } from "../../src/application/sync";
import { setWorkStatusByPerson } from "../../src/application/work-status";
import { ATTENTION_EMPTY, attentionText } from "../../src/app/components/labels";
import type { PrSnapshot } from "../../src/domain/model";
import { setup } from "./helpers";

const payments12 = { repoId: DEMO_REPO.payments, number: 12 };
const admin12 = { repoId: DEMO_REPO.adminConsole, number: 12 };
const docs12 = { repoId: DEMO_REPO.docsSite, number: 12 };
const OLD_SHA = "0123456789abcdef0123456789abcdef01234567";

type Deps = ReturnType<typeof setup>["deps"];

async function attention(deps: Deps, preview: RunningPreview | null = null): Promise<AttentionItem[]> {
  return collectAttention(await getWorkspace(deps), preview);
}
const summary = (items: readonly AttentionItem[]) =>
  items.map((i) => (i.kind === "inbox" ? `inbox:${i.count}` : `${i.kind}:${i.workId}${i.pr === null ? "" : `:${i.pr.repoName}#${i.pr.number}`}`));
function changePr(data: ReturnType<typeof setup>["data"], ref: { repoId: number; number: number }, fields: Partial<PrSnapshot>) {
  data.pullRequests = data.pullRequests.map((p) => (p.repoId === ref.repoId && p.number === ref.number ? { ...p, ...fields } : p));
}
const running = (ref: { repoId: number; number: number }, commitSha: string, phase: RunningPreview["phase"] = "running"): RunningPreview => ({
  target: { ...ref, commitSha },
  phase,
});

describe("Needs your attention — 이미 있는 상태를 모으기만 한다", () => {
  it("시연 데이터의 첫 모습: 검사 실패 한 줄과 Inbox 개수 한 줄. 검사 진행 중인 PR 과 판단이 끝난 PR 은 오르지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const items = await attention(deps);
    expect(summary(items)).toEqual(["checks_failing:a1b2c3:demo-org/payments#12", "inbox:5"]);
    const failing = items[0];
    expect(failing?.kind === "checks_failing" && failing.pr.headSha).toBe(DEMO_SHA.payments12Head);
  });

  it("검토 필요 업무는 아직 판단하지 않은(검사가 끝난 열린) PR 과 함께 오른다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const work = await createWorkFromPr(deps, docs12); // 검사 없음 · 결정 없음 → R2 로 검토 필요
    const items = await attention(deps);
    expect(summary(items)).toEqual([`needs_review:${work.id}:demo-org/docs-site#12`, "checks_failing:a1b2c3:demo-org/payments#12", "inbox:4"]);
    expect(attentionText(items[0]!).detail).toBe("demo-org/docs-site#12 최신 커밋 6f7a8b9 의 검사가 끝났다. 아직 판단하지 않았다.");
  });

  it("사람이 손으로 검토 필요를 골라 판단할 PR 이 없으면, PR 없이 업무만 오른다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await setWorkStatusByPerson(deps, { workId: "b4c5d6", status: "needs_review", action: "set_status" }); // PR 이 없는 초안 업무
    const items = await attention(deps);
    expect(summary(items)[0]).toBe("needs_review:b4c5d6");
    expect(attentionText(items[0]!).detail).toContain("업무 상태가 Needs review 다");
  });

  it("실행 중인 미리보기가 PR 의 이전 커밋이면 오르고, 최신 커밋이거나 아직 준비 중이거나 연결 안 된 PR 이면 오르지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    expect(summary(await attention(deps, running(admin12, OLD_SHA)))).toContain("outdated_preview:d0e1f2:demo-org/admin-console#12");
    const outdated = (await attention(deps, running(admin12, OLD_SHA))).find((i) => i.kind === "outdated_preview");
    expect(outdated && attentionText(outdated).detail).toBe("미리보기가 커밋 0123456 에서 돌고 있다. 최신은 9e28961. 검토 근거로 쓰지 않는다.");

    const kinds = async (preview: RunningPreview) => (await attention(deps, preview)).map((i) => i.kind);
    expect(await kinds(running(admin12, DEMO_SHA.admin12Head))).not.toContain("outdated_preview");
    expect(await kinds(running(admin12, OLD_SHA, "installing"))).not.toContain("outdated_preview");
    expect(await kinds(running(admin12, OLD_SHA, "stopped"))).not.toContain("outdated_preview");
    expect(await kinds(running(docs12, OLD_SHA))).not.toContain("outdated_preview"); // docs-site#12 는 Inbox 에 있다
  });

  it("완료 후보는 올리지 않는다 (결정 16 의 4) — 남은 PR 이 병합되면 검사 실패 줄도 함께 사라진다", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    changePr(data, payments12, { state: "merged" });
    await syncAll(deps);
    expect((await deps.store.getWork("a1b2c3"))?.status).toBe("done_candidate");
    expect(summary(await attention(deps))).toEqual(["inbox:5"]);
  });

  it("모을 것이 없으면 빈 목록이다 — 화면은 '지금 판단할 일이 없다' 를 보인다", async () => {
    const { data, deps } = setup();
    // 검사 실패가 고쳐지는 중이고(진행 중), Inbox 에서 기다리는 열린 PR 이 없는 모습
    changePr(data, payments12, { checks: "pending" });
    const keep = new Set(["710001#12", "710001#15", "710004#12", "710002#7"]);
    data.pullRequests = data.pullRequests.filter((p) => keep.has(`${p.repoId}#${p.number}`));
    await syncAll(deps);
    expect(await attention(deps)).toEqual([]);
    expect(ATTENTION_EMPTY.startsWith("지금 판단할 일이 없다.")).toBe(true);
  });

  it("순서는 종류(검토 필요 → 검사 실패 → 이전 버전 미리보기 → Inbox)이고, 같은 종류 안에서는 Workspace 의 순서를 따른다", async () => {
    const { data, deps } = setup();
    changePr(data, admin12, { checks: "failing" });
    await syncAll(deps);
    await setWorkStatusByPerson(deps, { workId: "c7d8e9", status: "needs_review", action: "set_status" });
    await setWorkStatusByPerson(deps, { workId: "b4c5d6", status: "needs_review", action: "set_status" });
    // 사람이 연결을 풀어도 Inbox 줄은 하나이고 개수만 는다
    await unlinkPr(deps, { ...payments12, workId: "a1b2c3" });
    const items = await attention(deps, running(admin12, OLD_SHA));
    expect(summary(items)).toEqual([
      "needs_review:b4c5d6", // 코치 대시보드가 선수 앱보다 먼저 보인다 (Workspace 의 프로젝트 순서)
      "needs_review:c7d8e9",
      "checks_failing:d0e1f2:demo-org/admin-console#12",
      "outdated_preview:d0e1f2:demo-org/admin-console#12",
      "inbox:6",
    ]);
    // 같은 입력이면 언제나 같은 목록
    expect(summary(await attention(deps, running(admin12, OLD_SHA)))).toEqual(summary(items));
  });
});
