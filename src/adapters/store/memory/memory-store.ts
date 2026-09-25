/**
 * 서버 메모리에 담는 저장 어댑터. 서버를 다시 켜면 처음 상태(seed)로 돌아간다.
 * 화면은 이 사실을 사용자에게 표시한다. PostgreSQL 어댑터는 다음 단위에서 같은 포트로 붙는다.
 */
import {
  type PreviewRecord,
  type PrLink,
  type PrRef,
  type PrSnapshot,
  type Project,
  prKey,
  type Repository,
  type ReviewDecision,
  StudioError,
  type Work,
} from "../../../domain/model";
import type { StudioStore } from "../../../ports/studio-store";

/** 서버가 켜질 때의 처음 상태. GitHub 에서 받아 적는 것(저장소, PR 스냅샷)은 넣지 않는다 — 동기화가 채운다. */
export interface StudioSeed {
  readonly projects?: readonly Project[];
  readonly works?: readonly Work[];
  readonly links?: readonly PrLink[];
  readonly reviews?: readonly ReviewDecision[];
  readonly previews?: readonly PreviewRecord[];
}

export function createMemoryStore(seed: StudioSeed = {}): StudioStore {
  const copy = <T>(value: T): T => structuredClone(value);
  const projects = new Map((seed.projects ?? []).map((p) => [p.id, copy(p)]));
  const works = new Map((seed.works ?? []).map((w) => [w.id, copy(w)]));
  const repositories = new Map<number, Repository>();
  const snapshots = new Map<string, PrSnapshot>();
  const links = new Map((seed.links ?? []).map((l) => [prKey(l), copy(l)]));
  const reviews: ReviewDecision[] = (seed.reviews ?? []).map(copy);
  const previews: PreviewRecord[] = (seed.previews ?? []).map(copy);

  return {
    async listProjects() {
      return [...projects.values()];
    },
    async saveProject(project) {
      projects.set(project.id, copy(project));
    },

    async listWorks() {
      return [...works.values()];
    },
    async getWork(id) {
      return works.get(id);
    },
    async saveWork(work) {
      works.set(work.id, copy(work));
    },

    async listRepositories() {
      return [...repositories.values()];
    },
    async saveRepository(repository) {
      repositories.set(repository.id, copy(repository));
    },

    async listSnapshots() {
      return [...snapshots.values()];
    },
    async getSnapshot(ref: PrRef) {
      return snapshots.get(prKey(ref));
    },
    async saveSnapshot(snapshot) {
      snapshots.set(prKey(snapshot), copy(snapshot));
    },

    async listLinks() {
      return [...links.values()];
    },
    async getLink(ref: PrRef) {
      return links.get(prKey(ref));
    },
    async addLink(link) {
      const key = prKey(link);
      if (links.has(key)) throw new StudioError("already_linked", "이 PR 은 이미 업무에 연결돼 있다.");
      links.set(key, copy(link));
    },

    async listReviewDecisions() {
      return [...reviews];
    },
    async addReviewDecision(decision) {
      reviews.push(copy(decision));
    },

    async listPreviewRecords() {
      return [...previews];
    },
  };
}
