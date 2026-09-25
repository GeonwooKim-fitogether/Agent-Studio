/**
 * 화면이 읽는 모양(view model). 화면은 도메인 객체를 직접 조합하지 않고 이것만 받는다.
 *
 * PR 카드는 두 묶음으로 갈라 둔다 — `github`(GitHub 소유, 읽기 전용)와 `studio`(Studio 소유).
 * 화면은 이 두 묶음을 다른 줄에 보여 주고 한 문장으로 합치지 않는다 (계약 §5).
 */
import { decideLink, type InboxReason } from "../domain/auto-link";
import { type Freshness, freshnessOf } from "../domain/freshness";
import {
  type ChecksState,
  type GitHubReviewState,
  type LinkOrigin,
  type MarkerPlace,
  type PreviewRecord,
  type PrLink,
  type PrRef,
  type PrSnapshot,
  type PrState,
  type Project,
  isValidPrRef,
  prKey,
  type Repository,
  samePr,
  type ReviewDecision,
  type ReviewVerdict,
  type UnlinkRecord,
  type Work,
} from "../domain/model";
import { markerFor } from "../domain/work-marker";
import type { StudioStore } from "../ports/studio-store";
import type { AppDeps } from "./deps";

export interface CommitRecordView {
  readonly id: string;
  readonly commitSha: string;
  readonly at: string;
  /** PR 의 최신 커밋에 대한 기록이면 "current", 이전 커밋에 대한 기록이면 "outdated"(이전 버전) */
  readonly freshness: Freshness;
}

export interface ReviewView extends CommitRecordView {
  readonly verdict: ReviewVerdict;
}

export interface PrCardView {
  readonly key: string;
  readonly repoId: number;
  readonly number: number;
  /** 저장소의 현재 이름. 표시용이다. */
  readonly repoName: string;
  readonly title: string;
  readonly branch: string;
  readonly headSha: string;
  readonly url: string;
  /** GitHub 소유 — Studio 는 받아 적기만 한다 */
  readonly github: {
    readonly state: PrState;
    readonly checks: ChecksState;
    readonly review: GitHubReviewState;
  };
  /** Studio 소유 */
  readonly studio: {
    readonly linkedWorkId: string | null;
    readonly linkOrigin: LinkOrigin | null;
    /** 표식으로 연결됐을 때 표식을 찾은 자리. 사람이 연결했거나 연결이 없으면 빈 목록 */
    readonly markerFoundIn: readonly MarkerPlace[];
    readonly reviews: readonly ReviewView[];
    readonly previews: readonly CommitRecordView[];
  };
}

export interface WorkSummaryView {
  readonly work: Work;
  readonly marker: string;
  readonly prs: readonly PrCardView[];
}

export interface WorkspaceView {
  readonly projects: readonly {
    readonly project: Project;
    readonly repositories: readonly Repository[];
    readonly works: readonly WorkSummaryView[];
  }[];
  readonly inboxCount: number;
}

export interface InboxItemView {
  readonly pr: PrCardView;
  /** 자동 연결하지 않은 이유. null 이면 표식이 확실해 다음 동기화에서 자동 연결된다. */
  readonly reason: InboxReason | null;
  readonly markedWorkIds: readonly string[];
  /** reason 이 "other_project" 일 때 표식이 가리키는 업무의 프로젝트 이름 */
  readonly markedProjectName: string | null;
  /** reason 이 "unlinked_by_user" 일 때, 연결이 풀리기 전에 붙어 있던 업무의 제목 (업무가 없으면 null) */
  readonly unlinkedFromWorkTitle: string | null;
}

export interface InboxView {
  readonly groups: readonly {
    readonly project: Project;
    /** 이 프로젝트의 PR 을 연결할 수 있는 업무 (같은 프로젝트의 업무만) */
    readonly candidates: readonly Work[];
    readonly items: readonly InboxItemView[];
  }[];
  /** Inbox 에 있는(= 연결 안 된 열린) PR 수 */
  readonly total: number;
  /** 연결 안 된 채 닫히거나 병합된 PR 수. 목록에는 두지 않고 개수만 알린다 (계약 §4, 결정 11) */
  readonly closedUnlinkedCount: number;
}

export interface WorkDetailView extends WorkSummaryView {
  readonly project: Project;
}

export async function getWorkspace(deps: Pick<AppDeps, "store">): Promise<WorkspaceView> {
  const s = await loadAll(deps.store);
  return {
    projects: s.projects.map((project) => ({
      project,
      repositories: project.repoIds.flatMap((id) => s.repositories.get(id) ?? []),
      works: s.works.filter((w) => w.projectId === project.id).map((work) => summarizeWork(s, work)),
    })),
    inboxCount: unlinkedInProjects(s).filter((u) => u.snapshot.state === "open").length,
  };
}

export async function getInbox(deps: Pick<AppDeps, "store">): Promise<InboxView> {
  const s = await loadAll(deps.store);
  const groups = s.projects
    .map((project) => ({
      project,
      candidates: s.works.filter((w) => w.projectId === project.id),
      items: unlinkedInProjects(s)
        .filter((u) => u.project.id === project.id && u.snapshot.state === "open")
        .map(({ snapshot }): InboxItemView => {
          const unlink = s.unlinks.get(prKey(snapshot));
          const decision = decideLink(snapshot, project.id, s.works, { unlinkedByUser: unlink !== undefined });
          const markedWorkIds = decision.kind === "inbox" ? decision.markedWorkIds : [decision.workId];
          const markedWork = s.works.find((w) => w.id === markedWorkIds[0]);
          const isOtherProject = decision.kind === "inbox" && decision.reason === "other_project";
          return {
            pr: toCard(s, snapshot),
            reason: decision.kind === "inbox" ? decision.reason : null,
            markedWorkIds,
            markedProjectName: isOtherProject ? (s.projects.find((p) => p.id === markedWork?.projectId)?.name ?? null) : null,
            unlinkedFromWorkTitle: unlink === undefined ? null : (s.works.find((w) => w.id === unlink.workId)?.title ?? null),
          };
        }),
    }))
    .filter((g) => g.items.length > 0);
  return {
    groups,
    total: groups.reduce((n, g) => n + g.items.length, 0),
    closedUnlinkedCount: unlinkedInProjects(s).filter((u) => u.snapshot.state !== "open").length,
  };
}

/** 서버 액션이 거절된 뒤 Inbox 에 사유를 보여 줄 때 쓰는, PR 하나의 현재 사정 */
export interface PrNoticeView {
  readonly repoName: string;
  readonly number: number;
  /** 지금 이 PR 이 연결돼 있는 업무. 연결이 없으면 null */
  readonly linkedWork: Work | null;
}

export async function getPrNotice(deps: Pick<AppDeps, "store">, ref: PrRef): Promise<PrNoticeView | undefined> {
  if (!isValidPrRef(ref)) return undefined; // 범위 밖의 값은 저장소에 묻지 않는다
  const [snapshot, link, repositories] = await Promise.all([
    deps.store.getSnapshot(ref),
    deps.store.getLink(ref),
    deps.store.listRepositories(),
  ]);
  if (snapshot === undefined) return undefined;
  return {
    repoName: repositories.find((r) => r.id === ref.repoId)?.fullName ?? `저장소 ${ref.repoId}`,
    number: ref.number,
    linkedWork: link === undefined ? null : ((await deps.store.getWork(link.workId)) ?? null),
  };
}

export async function getWorkDetail(deps: Pick<AppDeps, "store">, workId: string): Promise<WorkDetailView | undefined> {
  const s = await loadAll(deps.store);
  const work = s.works.find((w) => w.id === workId);
  const project = work && s.projects.find((p) => p.id === work.projectId);
  if (work === undefined || project === undefined) return undefined;
  return { ...summarizeWork(s, work), project };
}

// ── 내부 도우미 ─────────────────────────────────────────────────────────────

interface Loaded {
  readonly projects: readonly Project[];
  readonly works: readonly Work[];
  readonly repositories: ReadonlyMap<number, Repository>;
  readonly snapshots: readonly PrSnapshot[];
  readonly links: ReadonlyMap<string, PrLink>;
  readonly reviews: readonly ReviewDecision[];
  readonly previews: readonly PreviewRecord[];
  readonly unlinks: ReadonlyMap<string, UnlinkRecord>;
}

async function loadAll(store: StudioStore): Promise<Loaded> {
  const [projects, works, repositories, snapshots, links, reviews, previews, unlinks] = await Promise.all([
    store.listProjects(),
    store.listWorks(),
    store.listRepositories(),
    store.listSnapshots(),
    store.listLinks(),
    store.listReviewDecisions(),
    store.listPreviewRecords(),
    store.listUnlinks(),
  ]);
  return {
    projects,
    works: [...works].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    repositories: new Map(repositories.map((r) => [r.id, r])),
    snapshots,
    links: new Map(links.map((l) => [prKey(l), l])),
    reviews,
    previews,
    unlinks: new Map(unlinks.map((u) => [prKey(u), u])),
  };
}

function summarizeWork(s: Loaded, work: Work): WorkSummaryView {
  const prs = s.snapshots
    .filter((snapshot) => s.links.get(prKey(snapshot))?.workId === work.id)
    .map((snapshot) => toCard(s, snapshot))
    .sort(byRepoThenNumber);
  return { work, marker: markerFor(work.id), prs };
}

function unlinkedInProjects(s: Loaded): { snapshot: PrSnapshot; project: Project }[] {
  return s.snapshots
    .filter((snapshot) => !s.links.has(prKey(snapshot)))
    .flatMap((snapshot) => {
      const project = s.projects.find((p) => p.repoIds.includes(snapshot.repoId));
      return project === undefined ? [] : [{ snapshot, project }];
    })
    .sort((a, b) => byRepoThenNumber(toKeyParts(s, a.snapshot), toKeyParts(s, b.snapshot)));
}

function toKeyParts(s: Loaded, snapshot: PrSnapshot): { repoName: string; number: number } {
  return { repoName: s.repositories.get(snapshot.repoId)?.fullName ?? "", number: snapshot.number };
}

function byRepoThenNumber(a: { repoName: string; number: number }, b: { repoName: string; number: number }): number {
  return a.repoName.localeCompare(b.repoName) || a.number - b.number;
}

function toCard(s: Loaded, snapshot: PrSnapshot): PrCardView {
  const key = prKey(snapshot);
  const link = s.links.get(key);
  return {
    key,
    repoId: snapshot.repoId,
    number: snapshot.number,
    repoName: s.repositories.get(snapshot.repoId)?.fullName ?? `저장소 ${snapshot.repoId}`,
    title: snapshot.title,
    branch: snapshot.branch,
    headSha: snapshot.headSha,
    url: snapshot.url,
    github: { state: snapshot.state, checks: snapshot.checks, review: snapshot.review },
    studio: {
      linkedWorkId: link?.workId ?? null,
      linkOrigin: link?.origin ?? null,
      markerFoundIn: link?.origin === "marker" ? link.markerFoundIn : [],
      reviews: s.reviews
        .filter((r) => samePr(r, snapshot) && r.workId === link?.workId)
        .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
        .map((r) => ({
          id: r.id,
          verdict: r.verdict,
          commitSha: r.commitSha,
          at: r.decidedAt,
          freshness: freshnessOf(r, snapshot.headSha),
        })),
      previews: s.previews
        .filter((p) => samePr(p, snapshot))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((p) => ({ id: p.id, commitSha: p.commitSha, at: p.startedAt, freshness: freshnessOf(p, snapshot.headSha) })),
    },
  };
}
