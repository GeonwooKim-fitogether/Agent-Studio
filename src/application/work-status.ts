/**
 * 업무 상태 자동 변화 (feature-plan F3). 규칙 자체는 도메인(src/domain/work-status.ts)에 있고, 여기서는
 * 저장소에서 재료를 모아 판정을 돌리고 결과를 한 번에 쓴다.
 *
 * 다시 판정하는 때: Sync 가 끝날 때, 그리고 사람이 연결 · 해제 · Review · Mark as Done · 상태 변경을 한 뒤.
 * 같은 입력이면 판정이 아무것도 바꾸지 않으므로 이력이 겹쳐 쌓이지 않는다. 판정과 쓰기 사이에 다른 요청이 상태를 바꿨으면
 * 저장소가 쓰기를 거절하고(updateWorkStatus 가 false), 그 업무는 다음 판정에서 새 상태로 다시 본다.
 */
import { prKey, StudioError, type WorkStatus } from "../domain/model";
import { isValidWorkId } from "../domain/work-marker";
import {
  decideWorkStatus,
  fingerprintOf,
  MANUAL_STATUSES,
  type StatusChange,
  type StatusTransition,
} from "../domain/work-status";
import type { AppDeps } from "./deps";

type Deps = Pick<AppDeps, "store" | "now" | "newId">;

/**
 * 업무들의 상태를 규칙으로 다시 판정한다. workIds 를 주면 그 업무만, 없으면 전부.
 * 돌려주는 것은 이번에 새로 쌓인 이력 수다.
 */
export async function refreshWorkStatuses(deps: Deps, workIds?: readonly string[]): Promise<number> {
  const { store } = deps;
  const [works, links, snapshots, reviews, pins] = await Promise.all([
    store.listWorks(),
    store.listLinks(),
    store.listSnapshots(),
    store.listReviewDecisions(),
    store.listStatusPins(),
  ]);
  const wanted = workIds === undefined ? null : new Set(workIds);
  const workOf = new Map(links.map((l) => [prKey(l), l.workId]));
  const at = deps.now().toISOString();
  let written = 0;

  for (const work of works) {
    if (wanted !== null && !wanted.has(work.id)) continue;
    const pin = pins[work.id] ?? null;
    const decision = decideWorkStatus({
      status: work.status,
      pin,
      prs: snapshots.filter((s) => workOf.get(prKey(s)) === work.id),
      reviews: reviews.filter((r) => r.workId === work.id),
    });
    const pinReleased = pin !== null && decision.pin === null;
    if (decision.transitions.length === 0 && !pinReleased) continue;
    const changes = decision.transitions.map((t) => toChange(deps, work.id, t, at));
    const ok = await store.updateWorkStatus({ workId: work.id, expected: work.status, status: decision.status, pin: decision.pin, changes });
    if (ok) written += changes.length;
  }
  return written;
}

/**
 * 사람이 상태를 바꾼다 — Mark as Done(action "mark_done") 또는 업무 화면의 상태 선택(action "set_status").
 * 이때의 PR 모습을 기준점으로 남겨, 다음 PR 변화가 올 때까지 규칙이 덮지 않게 한다(R6).
 * Mark as Done 은 완료 후보일 때만 받는다 — 오래된 화면에서 눌렀는데 그사이 PR 이 다시 열렸다면 거절한다.
 * 이미 그 상태면 아무것도 쓰지 않는다(버튼을 두 번 눌러도 이력이 한 줄).
 */
export async function setWorkStatusByPerson(
  deps: Deps,
  input: { readonly workId: string; readonly status: WorkStatus; readonly action: "mark_done" | "set_status" },
): Promise<void> {
  if (!isValidWorkId(input.workId)) throw new StudioError("invalid_input", "업무 ID 가 올바르지 않다.");
  if (!MANUAL_STATUSES.includes(input.status)) throw new StudioError("invalid_input", "사람이 고를 수 있는 상태가 아니다.");
  if (input.action === "mark_done" && input.status !== "done") throw new StudioError("invalid_input", "Mark as Done 은 완료로만 바꾼다.");

  // 다른 판정과 겹쳐 쓰기가 거절되면 새 상태를 읽고 다시 한다. 사람의 선택이므로 몇 번은 다시 시도한다.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const work = await deps.store.getWork(input.workId);
    if (work === undefined) throw new StudioError("not_found", "상태를 바꿀 업무가 없다.");
    if (input.action === "mark_done" && work.status !== "done_candidate") {
      if (work.status === "done") return;
      throw new StudioError("invalid_input", "완료 후보가 아닌 업무는 Mark as Done 으로 완료하지 않는다.");
    }
    if (work.status === input.status) return;
    const [links, snapshots] = await Promise.all([deps.store.listLinks(), deps.store.listSnapshots()]);
    const linked = new Set(links.filter((l) => l.workId === work.id).map(prKey));
    const pin = fingerprintOf(snapshots.filter((s) => linked.has(prKey(s))));
    const change = toChange(deps, work.id, { from: work.status, to: input.status, cause: { kind: "person", action: input.action } }, deps.now().toISOString());
    if (await deps.store.updateWorkStatus({ workId: work.id, expected: work.status, status: input.status, pin, changes: [change] })) return;
  }
  throw new StudioError("invalid_input", "업무 상태가 동시에 바뀌고 있어 바꾸지 못했다. 다시 시도한다.");
}

function toChange(deps: Deps, workId: string, t: StatusTransition, changedAt: string): StatusChange {
  // 이력은 리뷰 결정보다 훨씬 많이 쌓이므로 ID 두 개를 이어 겹칠 가능성을 줄인다
  return { id: `sc-${deps.newId()}${deps.newId()}`, workId, from: t.from, to: t.to, cause: t.cause, changedAt };
}
