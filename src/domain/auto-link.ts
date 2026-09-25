/**
 * 자동 연결 규칙 — "확실할 때만 자동, 아니면 Inbox" (계약 §4).
 *
 * 잘못 붙인 PR 은 놓친 PR 보다 해롭다. 사람이 그 오류를 발견할 방법이 없기 때문이다.
 * 그래서 자동 연결의 근거는 Studio 가 발급한 표식 하나뿐이고, 제목 유사도 · 작성자 · 파일 겹침 같은
 * 추정 근거는 쓰지 않는다. 이 함수가 PR 의 제목을 받지 않는 것은 그 때문이다.
 */
import type { MarkerPlace, PrSnapshot, Work } from "./model";
import { findMarkedWorkIds } from "./work-marker";

/** PR 이 Inbox 로 가는 이유. 화면이 사용자에게 이유를 설명할 때 쓴다. 앞에 적힌 것이 먼저 판정된다. */
export type InboxReason =
  | "unlinked_by_user" // 사람이 이 PR 의 연결을 푼 적이 있다 (결정 9)
  | "fork_head" // PR 의 브랜치가 다른 저장소(복제본)에 있다 (결정 10)
  | "unknown_head" // PR 의 브랜치가 어느 저장소에 있는지 알 수 없다 — 복제본으로 본다 (결정 10)
  | "no_marker" // 표식이 하나도 없다
  | "unknown_work" // 표식이 가리키는 업무가 없다
  | "other_project" // 표식이 다른 프로젝트의 업무를 가리킨다
  | "multiple_markers"; // 서로 다른 업무를 가리키는 표식이 둘 이상이다

export type LinkDecision =
  | { readonly kind: "auto"; readonly workId: string; readonly foundIn: readonly MarkerPlace[] }
  | { readonly kind: "inbox"; readonly reason: InboxReason; readonly markedWorkIds: readonly string[] };

/**
 * PR 하나를 어느 업무에 자동으로 붙일지, 아니면 Inbox 로 보낼지 정한다.
 *
 * 먼저 표식과 무관하게 Inbox 로 보내는 두 경우를 본다.
 *   a. 사람이 이 PR 의 연결을 푼 적이 있다. 사람이 다시 연결할 때까지 자동으로 붙이지 않는다.
 *   b. PR 의 브랜치가 그 저장소 자신에 있지 않다(복제본이거나 알 수 없다). 표식은 누구나 적을 수 있는 글자다.
 * 그다음 자동 연결은 세 조건이 모두 맞을 때만이다.
 *   1. PR 본문 또는 브랜치 이름에 표식이 있다.
 *   2. 표식들이 가리키는 업무가 정확히 하나다 (같은 표식이 본문과 브랜치에 둘 다 있는 것은 하나로 센다).
 *   3. 그 업무가 존재하고, PR 의 저장소가 속한 프로젝트와 같은 프로젝트에 있다.
 *
 * @param prProjectId PR 의 저장소가 연결된 프로젝트의 ID
 * @param works 판정에 쓸 전체 업무 목록 (다른 프로젝트의 업무도 포함해야 "다른 프로젝트" 를 가려낼 수 있다)
 * @param history.unlinkedByUser 사람이 이 PR 의 연결을 푼 기록이 있는가
 */
export function decideLink(
  pr: Pick<PrSnapshot, "repoId" | "headRepoId" | "body" | "branch">,
  prProjectId: string,
  works: readonly Work[],
  history: { readonly unlinkedByUser: boolean },
): LinkDecision {
  const inBody = findMarkedWorkIds(pr.body);
  const inBranch = findMarkedWorkIds(pr.branch);
  const markedWorkIds = [...new Set([...inBody, ...inBranch])];
  const inbox = (reason: InboxReason): LinkDecision => ({ kind: "inbox", reason, markedWorkIds });

  if (history.unlinkedByUser) return inbox("unlinked_by_user");
  if (pr.headRepoId === null) return inbox("unknown_head");
  if (pr.headRepoId !== pr.repoId) return inbox("fork_head");

  if (markedWorkIds.length === 0) return inbox("no_marker");
  if (markedWorkIds.length > 1) return inbox("multiple_markers");

  const work = works.find((w) => w.id === markedWorkIds[0]);
  if (work === undefined) return inbox("unknown_work");
  if (work.projectId !== prProjectId) return inbox("other_project");

  const foundIn = (["body", "branch"] as const).filter((place) =>
    (place === "body" ? inBody : inBranch).includes(work.id),
  );
  return { kind: "auto", workId: work.id, foundIn };
}
