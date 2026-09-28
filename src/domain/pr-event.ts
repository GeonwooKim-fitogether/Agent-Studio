/**
 * PR 이벤트 — Studio 가 GitHub 에서 **읽은 변화**와, Studio 의 연결 · 연결 해제를 업무의 기록으로 남긴 것 (feature-plan F7).
 * 순수 함수만 있다. 저장소 · 화면을 모른다.
 *
 * 지금까지 Studio 는 PR 의 **현재** 모습(스냅샷)만 받아 적었다. 업무 Chat 의 타임라인은 "무엇이 언제 바뀌었나" 가 필요하므로,
 * Sync 가 스냅샷을 새로 받아 적을 때 앞 모습과 비교해 바뀐 것을 이벤트로 남긴다(prChangeEvents).
 *
 *   linked     PR 이 이 업무에 연결됐다 (표식 또는 사람)          주인: Studio (연결은 Studio 가 소유한다)
 *   unlinked   사람이 이 업무에서 연결을 풀었다 (Unlink)           주인: Studio
 *   new_commit PR 의 최신 커밋이 바뀌었다                            주인: GitHub
 *   checks     그 커밋의 검사 결과가 바뀌었다(또는 새 커밋의 결과가 이미 나와 있다)  주인: GitHub
 *   merged · closed · reopened  PR 상태가 바뀌었다                  주인: GitHub
 *
 * 이벤트는 **그때 그 PR 이 연결돼 있던 업무**의 것이다. 연결되지 않은 PR 의 변화는 남기지 않는다 — 어느 업무의 이야기도 아니기 때문이다.
 * 시각은 GitHub 에서 바뀐 시각이 아니라 Studio 가 그 변화를 **읽은 시각**이다(웹훅 없이 Sync 로 읽는다, 결정 11).
 *
 * 같은 변화가 두 번 기록되지 않게, 이벤트 ID 는 변화의 내용에서 만든다(무작위가 아니다). 두 Sync 가 겹쳐 같은 변화를 읽어도
 * ID 가 같아 저장소가 한 번만 남긴다. 같은 Sync 를 다시 돌리면 앞 모습과 새 모습이 같아 애초에 이벤트가 생기지 않는다.
 */
import { type ChecksState, type LinkOrigin, type PrLink, type PrRef, prKey, type PrSnapshot } from "./model";

export type PrEventKind = "linked" | "unlinked" | "new_commit" | "checks" | "merged" | "closed" | "reopened";

export const PR_EVENT_KINDS: readonly PrEventKind[] = ["linked", "unlinked", "new_commit", "checks", "merged", "closed", "reopened"];

interface PrEventBase extends PrRef {
  /** 변화의 내용에서 만든 ID. 같은 변화는 같은 ID 다 */
  readonly id: string;
  /** 그때 이 PR 이 연결돼 있던 업무 */
  readonly workId: string;
  /** 이 변화가 가리키는 커밋. 새 커밋이면 새 커밋이고, 그 밖에는 그때의 최신 커밋이다 (계약 §3-2: "이 PR 의 이 커밋") */
  readonly commitSha: string;
  /** Studio 가 이 변화를 읽거나 만든 시각 */
  readonly at: string;
}

export type PrEvent = PrEventBase &
  (
    | { readonly kind: "linked"; readonly origin: LinkOrigin }
    | { readonly kind: "new_commit"; readonly previousSha: string }
    | { readonly kind: "checks"; readonly checks: ChecksState }
    | { readonly kind: "unlinked" | "merged" | "closed" | "reopened" }
  );

/** 이 변화의 주인. GitHub 가 알려 준 것인지, Studio 가 한 것인지 (계약 §5 — 화면은 둘을 다른 표시로 보인다) */
export function eventOwner(kind: PrEventKind): "github" | "studio" {
  return kind === "linked" || kind === "unlinked" ? "studio" : "github";
}

export function isPrEventKind(value: unknown): value is PrEventKind {
  return typeof value === "string" && (PR_EVENT_KINDS as readonly string[]).includes(value);
}

/** 이벤트 ID 가 비교에 쓰는 PR 의 모습 */
const shape = (s: Pick<PrSnapshot, "state" | "headSha" | "checks">) => `${s.state}:${s.headSha}:${s.checks}`;

/**
 * 앞 모습(previous)과 새 모습(next)을 비교해 바뀐 것을 이벤트로 만든다. 순서는 새 커밋 → 검사 → 상태다.
 *
 * - 앞 모습이 없으면(이 PR 을 처음 읽었다) 아무것도 만들지 않는다. 그전에 무엇이 바뀌었는지 모르기 때문이다.
 * - 새 커밋: 최신 커밋 SHA 가 다르면.
 * - 검사: 같은 커밋이면 결과가 달라졌을 때(다시 돌린 검사 포함). 새 커밋이면 그 커밋의 결과가 이미 나와 있을 때만
 *   (통과 · 실패). 새 커밋이 막 올라와 검사가 진행 중이거나 검사가 없으면 남길 결과가 아직 없다.
 * - 상태: 병합됨 · 닫힘 · 다시 열림.
 *
 * ID 에는 앞 모습 · 새 모습 · GitHub 의 갱신 시각을 넣는다. 같은 변화를 두 번 읽으면 같은 ID 가 된다.
 * (GitHub 의 갱신 시각까지 같은 채 같은 변화가 되풀이되는 일 — 예: 닫고 열고 다시 닫기가 갱신 시각 하나 안에 — 은 한 번으로 남는다.)
 */
export function prChangeEvents(previous: PrSnapshot | undefined, next: PrSnapshot, workId: string, at: string): PrEvent[] {
  if (previous === undefined) return [];
  const base = { repoId: next.repoId, number: next.number, workId, at };
  const id = (kind: PrEventKind) => `${kind}|${prKey(next)}|${workId}|${shape(previous)}>${shape(next)}|${next.updatedAt}`;
  const events: PrEvent[] = [];

  const newCommit = previous.headSha !== next.headSha;
  if (newCommit) events.push({ ...base, id: id("new_commit"), kind: "new_commit", commitSha: next.headSha, previousSha: previous.headSha });

  const finished = next.checks === "passing" || next.checks === "failing";
  if (newCommit ? finished : previous.checks !== next.checks) {
    events.push({ ...base, id: id("checks"), kind: "checks", commitSha: next.headSha, checks: next.checks });
  }

  if (previous.state !== next.state) {
    const kind = next.state === "merged" ? "merged" : next.state === "closed" ? "closed" : "reopened";
    events.push({ ...base, id: id(kind), kind, commitSha: next.headSha });
  }
  return events;
}

/** PR 이 업무에 연결됐다. commitSha 는 연결된 순간의 최신 커밋이다 */
export function linkedEvent(link: PrLink, commitSha: string): PrEvent {
  return {
    id: `linked|${prKey(link)}|${link.workId}|${link.linkedAt}`,
    repoId: link.repoId,
    number: link.number,
    workId: link.workId,
    kind: "linked",
    origin: link.origin,
    commitSha,
    at: link.linkedAt,
  };
}

/** 사람이 연결을 풀었다 (Unlink). commitSha 는 그 순간의 최신 커밋이다 */
export function unlinkedEvent(ref: PrRef & { readonly workId: string }, commitSha: string, at: string): PrEvent {
  return {
    id: `unlinked|${prKey(ref)}|${ref.workId}|${at}`,
    repoId: ref.repoId,
    number: ref.number,
    workId: ref.workId,
    kind: "unlinked",
    commitSha,
    at,
  };
}
