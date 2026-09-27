/**
 * 미리보기 규칙 — 2단계 원격 미리보기 (docs/plan/04-remote-preview.md, 계약 §6).
 *
 * 미리보기는 "PR 하나의 커밋 하나" 를 실행한 것이다. 그래서 실행 대상은 언제나 (저장소 숫자 ID, PR 번호, 전체 커밋 SHA) 로 고정된다.
 * 이 파일은 두 가지만 정한다.
 *   1. 무엇을 실행하면 안 되나 (대상 제한) — 복제본(fork)에서 온 PR, 전체 SHA 가 아닌 커밋.
 *   2. 실행 중인 미리보기가 PR 의 최신 커밋을 보여 주고 있나 (신선도) — freshness.ts 를 그대로 쓴다.
 * 실제로 프로세스를 띄우는 일은 포트(src/ports/preview-runner.ts) 뒤의 어댑터가 한다.
 */
import { type Freshness, freshnessOf } from "./freshness";
import type { PrRef, PrSnapshot, Repository } from "./model";

/**
 * 전체 커밋 SHA. 40자(SHA-1) 또는 64자(SHA-256) 소문자 16진수.
 * 짧은 SHA 는 저장소 안에서 둘 이상의 커밋을 가리킬 수 있으므로 실행 대상으로 받지 않는다.
 */
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function isFullSha(sha: string): boolean {
  return FULL_SHA.test(sha);
}

/** owner/name. 코드를 받을 주소 · 폴더 이름을 만드는 데 쓰이므로 글자를 좁게 제한한다. */
const REPO_FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export function isSafeRepoFullName(fullName: string): boolean {
  if (!REPO_FULL_NAME.test(fullName)) return false;
  const name = fullName.split("/")[1] ?? "";
  return name !== "." && name !== "..";
}

/**
 * 미리보기를 열 수 없는 이유 (PR 쪽 사정만. 미리보기 기기가 연결됐는지는 실행기가 알려 준다).
 *   fork        복제본의 브랜치에서 온 PR. 팀 밖 사람의 코드를 사용자 컴퓨터에서 돌리지 않는다 (결정 10 과 같은 이유)
 *   sha_not_full 최신 커밋이 전체 SHA 로 오지 않았다. 무엇을 실행하는지 하나로 고정할 수 없다
 *   bad_repo    저장소 이름이 코드를 받을 수 있는 모양이 아니다
 */
export type PreviewBlock = "fork" | "sha_not_full" | "bad_repo";

/** 이 PR 의 최신 커밋을 미리보기로 실행해도 되나. 되면 null, 안 되면 이유. 복제본 여부를 모르면(headRepoId null) 복제본으로 본다. */
export function previewBlockOf(snapshot: Pick<PrSnapshot, "repoId" | "headRepoId" | "headSha">, repository: Repository): PreviewBlock | null {
  if (snapshot.headRepoId !== snapshot.repoId) return "fork";
  if (!isFullSha(snapshot.headSha)) return "sha_not_full";
  if (!isSafeRepoFullName(repository.fullName)) return "bad_repo";
  return null;
}

/** 실행 대상. 저장소 이름은 코드를 받을 곳을 찾는 데만 쓰고, 같은 PR 인지는 (repoId, number) 로만 판단한다. */
export interface PreviewTarget extends PrRef {
  readonly repoFullName: string;
  /** 실행할 커밋의 전체 SHA */
  readonly commitSha: string;
}

/** PR 의 **지금** 최신 커밋을 실행 대상으로 고정한다. 대상 제한에 걸리면 undefined. */
export function previewTargetOf(snapshot: PrSnapshot, repository: Repository): PreviewTarget | undefined {
  if (previewBlockOf(snapshot, repository) !== null) return undefined;
  return { repoId: snapshot.repoId, number: snapshot.number, repoFullName: repository.fullName, commitSha: snapshot.headSha };
}

/**
 * 미리보기 한 번의 진행 단계.
 *   fetching   커밋의 코드를 격리 폴더에 받는 중
 *   installing 의존성 설치 중 (npm ci)
 *   starting   앱을 켜고 주소가 응답하기를 기다리는 중
 *   running    주소가 응답한다. 열어 볼 수 있다
 *   failed     실패했다. 이유와 로그 꼬리가 있다
 *   stopped    사람이 끄거나, 다른 PR 의 미리보기를 열어 꺼졌다
 */
export type PreviewPhase = "fetching" | "installing" | "starting" | "running" | "failed" | "stopped";

export const BUSY_PHASES: readonly PreviewPhase[] = ["fetching", "installing", "starting"];

/** 실행기가 들고 있는 미리보기 한 번. 첫 버전은 동시에 하나뿐이다 (계약 §6). */
export interface PreviewSession {
  readonly id: string;
  readonly target: PreviewTarget;
  readonly phase: PreviewPhase;
  readonly startedAt: string;
  /** running 일 때 열 주소 */
  readonly url: string | null;
  /** failed 일 때 사람이 읽는 이유 (비밀 값이 없는 문장) */
  readonly failure: string | null;
  /** 설치 · 실행 로그의 마지막 몇 줄 (비밀처럼 보이는 값은 가려져 있다) */
  readonly logTail: readonly string[];
  /** 이 미리보기를 열면서 종료한 이전 미리보기 (없으면 null). 화면이 "이전 것을 껐다" 고 알린다 */
  readonly replaced: PreviewTarget | null;
}

/** 실행 중(또는 준비 중)인 미리보기가 PR 의 최신 커밋을 보여 주고 있나. 아니면 "이전 버전" 이고 검토 근거로 쓰지 않는다. */
export function previewFreshness(session: Pick<PreviewSession, "target">, latestHeadSha: string): Freshness {
  return freshnessOf(session.target, latestHeadSha);
}
