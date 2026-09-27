/**
 * 업무 상태가 스스로 바뀌는 규칙 (계약 §5-1 의 R1 ~ R6, 결정 14 · 16). 순수 함수만 있다.
 *
 * 판단의 재료는 두 가지뿐이다 — 업무에 연결된 PR 의 GitHub 상태(스냅샷)와, 이 업무에 남은 내부 검토 결정.
 * 업무 상태는 "사람이 볼 PR 이 하나라도 있는가" 로 정한다(R3 의 반례).
 *
 *   R1  초안인 업무에 PR 이 연결된다                       → 진행 중. PR 이 모두 빠져도 초안으로 되돌리지 않는다
 *   R1b 검토 필요인 업무에서 PR 이 모두 빠진다(Unlink)      → 진행 중. 볼 PR 이 없는데 검토 필요로 남지 않게 한다 (결정 17)
 *   R2  열린 PR 하나라도 최신 커밋의 검사가 끝났고(통과 · 검사 없음) 그 커밋에 결정이 없다 → 검토 필요
 *       (검사 실패 · 진행 중은 검토 필요로 만들지 않는다. 검토 필요에서 새 커밋이 와 다시 검사 중이면 진행 중으로 돌아간다)
 *   R3  최신 커밋에 Request Changes                          → 진행 중 (다른 PR 이 R2 면 검토 필요 유지)
 *   R3b 최신 커밋에 Approve(내부 검토 완료)                  → 진행 중, GitHub 병합을 기다린다 (다른 PR 이 R2 면 검토 필요 유지)
 *   R4  열린 PR 이 없고 하나 이상 병합                       → 완료 후보. 자동으로 완료하지 않는다.
 *       모두 병합 없이 닫혔으면 완료 후보가 아니다 → 진행 중
 *   R5  완료인 업무에 열린 PR 이 생긴다(새 연결 · 다시 열림) → 진행 중
 *   R6  사람이 손으로 바꾼 상태는 다음 PR 변화(새 커밋 · 새 연결 · 병합 · 닫힘)가 올 때까지 규칙이 덮지 않는다
 *
 * 한 번의 판정에서 규칙이 이어서 걸릴 수 있다(예: 이미 병합된 PR 이 첫 연결이면 R1 다음 R4).
 * 그래서 바뀌지 않을 때까지 되풀이하고, 바뀐 걸음마다 이력 한 줄을 돌려준다. 같은 입력이면 두 번째 판정은 아무것도 바꾸지 않는다.
 */
import { prKey, type PrRef, type PrSnapshot, type ReviewDecision, type WorkStatus } from "./model";

export const WORK_STATUSES: readonly WorkStatus[] = ["draft", "in_progress", "needs_review", "done_candidate", "done"];

/** 사람이 손으로 고를 수 있는 상태. 완료 후보는 규칙이 붙이는 표시라 고르지 않는다 */
export const MANUAL_STATUSES: readonly WorkStatus[] = ["draft", "in_progress", "needs_review", "done"];

export function isWorkStatus(value: unknown): value is WorkStatus {
  return typeof value === "string" && (WORK_STATUSES as readonly string[]).includes(value);
}

export type StatusRule = "R1" | "R1b" | "R2" | "R3" | "R3b" | "R4" | "R5";

/** 규칙이 근거로 삼은 PR 과 그때의 최신 커밋 */
export interface StatusEvidence extends PrRef {
  readonly commitSha: string;
}

/** 누가 상태를 바꿨나 — 규칙(번호와 근거 PR) 또는 사람(Mark as Done · 손으로 고르기) */
export type StatusCause =
  | { readonly kind: "rule"; readonly rule: StatusRule; readonly evidence: readonly StatusEvidence[] }
  | { readonly kind: "person"; readonly action: "mark_done" | "set_status" };

export interface StatusTransition {
  readonly from: WorkStatus;
  readonly to: WorkStatus;
  readonly cause: StatusCause;
}

/**
 * R6 의 기준점 — 사람이 상태를 바꾼 순간 연결돼 있던 PR 들의 모습. PR 열쇠(prKey) → "상태:최신 커밋".
 * 이것과 달라진 PR(새로 연결됨, 새 커밋, 병합, 닫힘, 다시 열림)이 생기면 사람의 상태를 놓아 주고 규칙이 다시 판단한다.
 * 연결이 빠지기만 한 것은 변화로 보지 않는다(계약의 목록에 없다).
 */
export type PrFingerprint = Readonly<Record<string, string>>;

export function fingerprintOf(prs: readonly PrSnapshot[]): PrFingerprint {
  return Object.fromEntries([...prs].sort(byRef).map((p) => [prKey(p), `${p.state}:${p.headSha}`]));
}

export function prChangedSince(pin: PrFingerprint, prs: readonly PrSnapshot[]): boolean {
  return prs.some((p) => pin[prKey(p)] !== `${p.state}:${p.headSha}`);
}

export interface StatusInput {
  readonly status: WorkStatus;
  /** 사람이 손으로 바꾼 뒤 아직 PR 변화가 없으면 그때의 기준점, 아니면 null */
  readonly pin: PrFingerprint | null;
  /** 이 업무에 연결된 PR */
  readonly prs: readonly PrSnapshot[];
  /** 이 업무에 남은 내부 검토 결정 (순서는 상관없다 — 안에서 시각순으로 본다) */
  readonly reviews: readonly Pick<ReviewDecision, "repoId" | "number" | "commitSha" | "verdict" | "decidedAt">[];
}

export interface StatusDecision {
  readonly status: WorkStatus;
  readonly pin: PrFingerprint | null;
  /** 바뀐 걸음들. 비어 있으면 아무것도 바뀌지 않았다 */
  readonly transitions: readonly StatusTransition[];
}

export function decideWorkStatus(input: StatusInput): StatusDecision {
  if (input.pin !== null && !prChangedSince(input.pin, input.prs)) {
    return { status: input.status, pin: input.pin, transitions: [] }; // R6: 사람의 판단을 덮지 않는다
  }
  const transitions: StatusTransition[] = [];
  let status = input.status;
  // 가장 긴 사슬은 완료 → R5 진행 중 → R2 검토 필요 의 두 걸음이다. 넉넉히 4번에서 멈춘다(규칙이 잘못돼도 무한 반복하지 않게).
  for (let i = 0; i < 4; i += 1) {
    const next = step(status, input);
    if (next === null) break;
    transitions.push(next);
    status = next.to;
  }
  return { status, pin: null, transitions };
}

function step(status: WorkStatus, input: StatusInput): StatusTransition | null {
  const prs = [...input.prs].sort(byRef);
  if (prs.length === 0) {
    // R1 의 반례: PR 이 모두 빠져도 초안으로 되돌리지 않는다. 다만 검토 필요는 볼 PR 이 없으므로 진행 중으로 내린다(R1b)
    return status === "needs_review" ? rule(status, "in_progress", "R1b", []) : null;
  }
  const open = prs.filter((p) => p.state === "open");
  if (status === "draft") return rule(status, "in_progress", "R1", prs);
  if (status === "done") return open.length === 0 ? null : rule(status, "in_progress", "R5", open);

  const target = derive(prs, open, latestVerdicts(input.reviews));
  return target.to === status ? null : rule(status, target.to, target.rule, target.evidence);
}

function derive(
  prs: readonly PrSnapshot[],
  open: readonly PrSnapshot[],
  verdicts: ReadonlyMap<string, ReviewDecision["verdict"]>,
): { to: WorkStatus; rule: StatusRule; evidence: readonly PrSnapshot[] } {
  const verdictOf = (p: PrSnapshot) => verdicts.get(`${prKey(p)}@${p.headSha}`);
  const awaiting = open.filter((p) => (p.checks === "passing" || p.checks === "none") && verdictOf(p) === undefined);
  if (awaiting.length > 0) return { to: "needs_review", rule: "R2", evidence: awaiting };
  if (open.length > 0) {
    const changes = open.filter((p) => verdictOf(p) === "changes_requested");
    if (changes.length > 0) return { to: "in_progress", rule: "R3", evidence: changes };
    const approved = open.filter((p) => verdictOf(p) === "internal_review_done");
    if (approved.length > 0) return { to: "in_progress", rule: "R3b", evidence: approved };
    return { to: "in_progress", rule: "R2", evidence: open }; // 검사 진행 중 · 실패 — 기다리거나 작성자가 고칠 차례
  }
  const merged = prs.filter((p) => p.state === "merged");
  if (merged.length > 0) return { to: "done_candidate", rule: "R4", evidence: merged };
  return { to: "in_progress", rule: "R4", evidence: prs }; // 모두 병합 없이 닫혔다 — 완료 후보가 아니다
}

/** "PR 열쇠@커밋" → 그 커밋에 대한 마지막 결정 */
function latestVerdicts(reviews: StatusInput["reviews"]): Map<string, ReviewDecision["verdict"]> {
  const sorted = [...reviews].sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  return new Map(sorted.map((r) => [`${prKey(r)}@${r.commitSha}`, r.verdict]));
}

function rule(from: WorkStatus, to: WorkStatus, name: StatusRule, evidence: readonly PrSnapshot[]): StatusTransition {
  return {
    from,
    to,
    cause: { kind: "rule", rule: name, evidence: evidence.map((p) => ({ repoId: p.repoId, number: p.number, commitSha: p.headSha })) },
  };
}

const byRef = (a: PrRef, b: PrRef) => a.repoId - b.repoId || a.number - b.number;

/** 상태 이력 한 줄 — 누가 또는 어느 규칙이, 언제, 무엇에서 무엇으로 바꿨나 (계약 §5-1 마지막 문단) */
export interface StatusChange {
  readonly id: string;
  readonly workId: string;
  readonly from: WorkStatus;
  readonly to: WorkStatus;
  readonly cause: StatusCause;
  readonly changedAt: string;
}
