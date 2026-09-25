/**
 * 서버 메모리에 담는 저장 어댑터. 서버를 다시 켜면 처음 상태(seed)로 돌아간다.
 * 화면은 이 사실을 사용자에게 표시한다. PostgreSQL 어댑터는 다음 단위에서 같은 포트로 붙는다.
 *
 * 저장할 때도, 돌려줄 때도 복사본(structuredClone)을 쓴다. 밖에서 돌려받은 객체를 고쳐도
 * 저장된 값(특히 GitHub 에서 받아 적은 스냅샷)은 바뀌지 않는다.
 *
 * 원자성: 이 저장소의 메서드는 안에서 await 하지 않는다. 그래서 확인과 쓰기 사이에 다른 요청이 끼어들 수 없고,
 * createWorkWithLink 같은 두 단계 연산이 하나의 연산으로 끝난다.
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
  isValidPrRef,
  StudioError,
  type UnlinkRecord,
  withoutNul,
  type Work,
} from "../../../domain/model";
import { isValidWorkId } from "../../../domain/work-marker";
import type { StudioSeed, StudioStore } from "../../../ports/studio-store";

export type { StudioSeed } from "../../../ports/studio-store";

const copy = <T>(value: T): T => structuredClone(value);
const copies = <T>(values: Iterable<T>): T[] => [...values].map(copy);

export function createMemoryStore(seed: StudioSeed = {}): StudioStore {
  const projects = new Map((seed.projects ?? []).map((p) => [p.id, copy(p)]));
  const works = new Map((seed.works ?? []).map((w) => [w.id, copy(w)]));
  const repositories = new Map<number, Repository>();
  const snapshots = new Map<string, PrSnapshot>();
  const links = new Map((seed.links ?? []).map((l) => [prKey(l), copy(l)]));
  const reviews: ReviewDecision[] = copies(seed.reviews ?? []);
  const previews: PreviewRecord[] = copies(seed.previews ?? []);
  const unlinks = new Map((seed.unlinks ?? []).map((u) => [prKey(u), copy(u)]));

  const rejectIfBadRef = (ref: PrRef) => {
    if (!isValidPrRef(ref)) throw new StudioError("invalid_input", "PR 을 가리키는 값이 올바르지 않다.");
  };
  const rejectIfLinked = (ref: PrRef) => {
    if (links.has(prKey(ref))) throw new StudioError("already_linked", "이 PR 은 이미 업무에 연결돼 있다.");
  };
  /** 표식의 연결은 사람이 연결을 푼 PR 에 쓰지 않는다. */
  const rejectIfUnlinkedByUser = (link: PrLink) => {
    if (link.origin === "marker" && unlinks.has(prKey(link))) {
      throw new StudioError("unlinked_by_user", "사람이 연결을 푼 PR 은 표식으로 다시 연결하지 않는다.");
    }
  };
  /** 확인이 끝난 연결을 쓴다. 사람의 연결이면 해제 기록을 함께 지운다. */
  const writeLink = (link: PrLink) => {
    links.set(prKey(link), copy(link));
    if (link.origin === "user") unlinks.delete(prKey(link));
  };

  return {
    async listProjects() {
      return copies(projects.values());
    },
    async saveProject(project) {
      projects.set(project.id, copy(project));
    },

    async listWorks() {
      return copies(works.values());
    },
    async getWork(id) {
      const work = works.get(id);
      return work && copy(work);
    },
    async createWorkWithLink(work, link) {
      // 확인을 모두 마친 뒤에 쓴다. 하나라도 걸리면 아무것도 쓰지 않는다. 확인 순서는 포트 주석과 PostgreSQL 구현과 같다.
      rejectIfBadRef(link);
      if (link.workId !== work.id) throw new StudioError("invalid_input", "연결이 새 업무를 가리키지 않는다.");
      if (!isValidWorkId(work.id)) throw new StudioError("invalid_input", "업무 ID 는 영문 소문자와 숫자로만 이뤄진다.");
      rejectIfLinked(link);
      if (!projects.has(work.projectId)) throw new StudioError("not_found", "업무를 둘 프로젝트가 없다.");
      rejectIfUnlinkedByUser(link);
      if (works.has(work.id)) throw new StudioError("invalid_input", "같은 ID 의 업무가 이미 있다.");
      works.set(work.id, copy(work));
      writeLink(link);
    },

    async listRepositories() {
      return copies(repositories.values());
    },
    async saveRepository(repository) {
      repositories.set(repository.id, copy(repository));
    },

    async listSnapshots() {
      return copies(snapshots.values());
    },
    async getSnapshot(ref: PrRef) {
      const snapshot = snapshots.get(prKey(ref));
      return snapshot && copy(snapshot);
    },
    async saveSnapshot(snapshot) {
      rejectIfBadRef(snapshot);
      snapshots.set(prKey(snapshot), copy(withoutNul(snapshot)));
    },

    async listLinks() {
      return copies(links.values());
    },
    async getLink(ref: PrRef) {
      const link = links.get(prKey(ref));
      return link && copy(link);
    },
    async addLink(link) {
      rejectIfBadRef(link);
      rejectIfLinked(link);
      if (!works.has(link.workId)) throw new StudioError("not_found", "연결하려는 업무가 없다.");
      rejectIfUnlinkedByUser(link);
      writeLink(link);
    },
    async unlink(ref, unlinkedAt) {
      rejectIfBadRef(ref);
      const key = prKey(ref);
      if (links.get(key)?.workId !== ref.workId) {
        throw new StudioError("not_linked", "이 PR 은 이 업무에 연결돼 있지 않다.");
      }
      links.delete(key);
      unlinks.set(key, { repoId: ref.repoId, number: ref.number, workId: ref.workId, unlinkedAt });
    },
    async listUnlinks() {
      return copies(unlinks.values());
    },

    async listReviewDecisions() {
      return copies(reviews);
    },
    async addReviewDecision(decision) {
      rejectIfBadRef(decision);
      if (!works.has(decision.workId)) throw new StudioError("not_found", "검토 결정을 남길 업무가 없다.");
      reviews.push(copy(decision));
    },

    async listPreviewRecords() {
      return copies(previews);
    },
  };
}
