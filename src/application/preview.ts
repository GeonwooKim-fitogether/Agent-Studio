/**
 * 미리보기 유스케이스 (2단계, docs/plan/04-remote-preview.md).
 *
 * 화면은 여기서 만든 모양만 받는다. 규칙은 셋이다.
 *   1. 미리보기를 열 수 있는지는 "실행기가 연결됐나" 와 "이 PR 을 실행해도 되나(대상 제한)" 로 정한다.
 *      열 수 없으면 버튼을 없애지 않고 비활성으로 두고 이유를 보인다 (결정 7).
 *   2. 실행 대상은 언제나 PR 의 **지금** 최신 커밋이다. 화면에서 온 SHA 를 믿지 않고 저장된 PR 스냅샷에서 다시 읽는다.
 *   3. 실행 중인 미리보기가 PR 의 최신 커밋과 다르면 "이전 버전" 이다 (계약 §6). 검토 근거로 쓰지 않는다.
 */
import type { Freshness } from "../domain/freshness";
import { type PrRef, prKey, type Repository, samePr, StudioError } from "../domain/model";
import {
  BUSY_PHASES,
  type PreviewBlock,
  previewBlockOf,
  previewFreshness,
  type PreviewPhase,
  type PreviewSession,
  previewTargetOf,
} from "../domain/preview";
import type { PreviewRunner } from "../ports/preview-runner";
import type { AppDeps } from "./deps";

/** 이 PR 의 미리보기를 지금 열 수 있나 */
export type PreviewAvailability =
  | { readonly kind: "available" }
  | { readonly kind: "runner_offline"; readonly reason: string }
  | { readonly kind: "blocked"; readonly block: PreviewBlock };

export interface PreviewSessionView {
  readonly phase: PreviewPhase;
  readonly busy: boolean;
  readonly url: string | null;
  readonly commitSha: string;
  /** PR 의 최신 커밋을 보여 주고 있으면 "current", 아니면 "outdated"(이전 버전) */
  readonly freshness: Freshness;
  readonly failure: string | null;
  readonly logTail: readonly string[];
  /** 이 미리보기를 열면서 종료한 이전 미리보기 */
  readonly replaced: { readonly repoName: string; readonly number: number; readonly commitSha: string } | null;
}

export interface PreviewCardView {
  readonly availability: PreviewAvailability;
  /** 실행기가 들고 있는 미리보기가 이 PR 의 것이면 그 상태. 아니면 null */
  readonly session: PreviewSessionView | null;
  /** 실행기가 **다른** PR 의 미리보기를 준비 중이거나 실행 중이면 그 PR. 이 PR 을 열면 그것이 꺼진다 */
  readonly otherActive: { readonly repoName: string; readonly number: number } | null;
}

/** 화면 위쪽 띠의 "미리보기 기기" 한 칸 */
export interface PreviewDeviceView {
  readonly online: boolean;
  /** online 이면 기기 설명, 아니면 연결되지 않은 이유 */
  readonly text: string;
  /** 지금 준비 중이거나 실행 중인 미리보기 */
  readonly active: { readonly repoName: string; readonly number: number; readonly phase: PreviewPhase } | null;
}

const isLive = (session: PreviewSession | null): session is PreviewSession =>
  session !== null && (session.phase === "running" || BUSY_PHASES.includes(session.phase));

const repoNameOf = (repositories: readonly Repository[], repoId: number) =>
  repositories.find((r) => r.id === repoId)?.fullName ?? `저장소 ${repoId}`;

export async function getPreviewDevice(deps: Pick<AppDeps, "store">, runner: PreviewRunner): Promise<PreviewDeviceView> {
  const status = runner.status();
  const session = runner.current();
  const repositories = isLive(session) ? await deps.store.listRepositories() : [];
  return {
    online: status.online,
    text: status.online ? status.label : status.reason,
    active: isLive(session) ? { repoName: repoNameOf(repositories, session.target.repoId), number: session.target.number, phase: session.phase } : null,
  };
}

/** PR 카드들의 미리보기 칸. 열쇠는 prKey. */
export async function getPreviewCards(
  deps: Pick<AppDeps, "store">,
  runner: PreviewRunner,
  refs: readonly PrRef[],
): Promise<Map<string, PreviewCardView>> {
  const status = runner.status();
  const session = runner.current();
  const [repositories, snapshots] = await Promise.all([deps.store.listRepositories(), deps.store.listSnapshots()]);
  const cards = new Map<string, PreviewCardView>();
  for (const ref of refs) {
    const snapshot = snapshots.find((s) => samePr(s, ref));
    const repository = repositories.find((r) => r.id === ref.repoId);
    if (snapshot === undefined || repository === undefined) continue;

    const block = previewBlockOf(snapshot, repository);
    const availability: PreviewAvailability = !status.online
      ? { kind: "runner_offline", reason: status.reason }
      : block !== null
        ? { kind: "blocked", block }
        : { kind: "available" };

    const mine = session !== null && samePr(session.target, ref) ? session : null;
    cards.set(prKey(ref), {
      availability,
      session:
        mine === null
          ? null
          : {
              phase: mine.phase,
              busy: BUSY_PHASES.includes(mine.phase),
              url: mine.phase === "running" ? mine.url : null,
              commitSha: mine.target.commitSha,
              freshness: previewFreshness(mine, snapshot.headSha),
              failure: mine.failure,
              logTail: mine.logTail,
              replaced:
                mine.replaced === null
                  ? null
                  : { repoName: repoNameOf(repositories, mine.replaced.repoId), number: mine.replaced.number, commitSha: mine.replaced.commitSha },
            },
      otherActive:
        isLive(session) && !samePr(session.target, ref)
          ? { repoName: repoNameOf(repositories, session.target.repoId), number: session.target.number }
          : null,
    });
  }
  return cards;
}

/**
 * 이 PR 의 **지금** 최신 커밋으로 미리보기를 연다. 이전 미리보기가 있으면 실행기가 끈다.
 * 실행기가 오프라인이거나 대상 제한에 걸리면 StudioError(invalid_input) 로 거절한다 — 화면은 이미 버튼을 막고 있으므로,
 * 여기서 걸리는 것은 오래된 화면에서 누른 경우다.
 */
export async function startPreview(deps: Pick<AppDeps, "store">, runner: PreviewRunner, ref: PrRef): Promise<PreviewSession> {
  const status = runner.status();
  if (!status.online) throw new StudioError("invalid_input", status.reason);
  const [snapshot, repositories] = await Promise.all([deps.store.getSnapshot(ref), deps.store.listRepositories()]);
  const repository = repositories.find((r) => r.id === ref.repoId);
  if (snapshot === undefined || repository === undefined) throw new StudioError("not_found", "그 PR 을 찾지 못했다.");
  const target = previewTargetOf(snapshot, repository);
  if (target === undefined) throw new StudioError("invalid_input", "이 PR 은 미리보기로 실행하지 않는다.");
  return runner.start(target);
}

export async function stopPreview(runner: PreviewRunner): Promise<void> {
  await runner.stop();
}
