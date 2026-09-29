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
import { type AgentDraft, isAcceptedAgentDraft } from "../../../domain/agent-draft";
import { isAcceptedSkillDraft, isDuplicateSkillName, type SkillDraft } from "../../../domain/skill-draft";
import { isAcceptedMemoBody, isValidThreadTarget, type Memo } from "../../../domain/memo";
import { isPrEventKind, type PrEvent } from "../../../domain/pr-event";
import { isValidWorkId } from "../../../domain/work-marker";
import { isWorkStatus, type PrFingerprint, type StatusChange } from "../../../domain/work-status";
import { isAcceptedReviewNoteField } from "../../../domain/review-note";
import { isAcceptedWorkGoal } from "../../../domain/work-goal";
import { reviewFromSeed, type StudioSeed, type StudioStore, workFromSeed } from "../../../ports/studio-store";

export type { StudioSeed } from "../../../ports/studio-store";

const copy = <T>(value: T): T => structuredClone(value);
const copies = <T>(values: Iterable<T>): T[] => [...values].map(copy);

export function createMemoryStore(seed: StudioSeed = {}): StudioStore {
  const projects = new Map((seed.projects ?? []).map((p) => [p.id, copy(p)]));
  const works = new Map((seed.works ?? []).map((w) => [w.id, copy(workFromSeed(w))]));
  const repositories = new Map<number, Repository>();
  const snapshots = new Map<string, PrSnapshot>();
  const links = new Map((seed.links ?? []).map((l) => [prKey(l), copy(l)]));
  const reviews: ReviewDecision[] = copies((seed.reviews ?? []).map(reviewFromSeed));
  const previews: PreviewRecord[] = copies(seed.previews ?? []);
  const unlinks = new Map((seed.unlinks ?? []).map((u) => [prKey(u), copy(u)]));
  const statusPins = new Map<string, PrFingerprint>();
  const statusChanges: StatusChange[] = [];
  const events: PrEvent[] = copies(seed.events ?? []);
  const memos: Memo[] = copies(seed.memos ?? []);
  const agents = new Map((seed.agents ?? []).map((a) => [a.id, copy(a)]));
  const skillDrafts = new Map((seed.skills ?? []).map((k) => [k.id, copy(k)]));
  const byCreated = (a: AgentDraft | SkillDraft, b: AgentDraft | SkillDraft) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const memoIn = (workId: string, id: string) => memos.findIndex((m) => m.workId === workId && m.id === id);

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
      if (!isAcceptedWorkGoal(work.goal)) throw new StudioError("invalid_input", "업무 목표가 올바르지 않다.");
      rejectIfLinked(link);
      if (!projects.has(work.projectId)) throw new StudioError("not_found", "업무를 둘 프로젝트가 없다.");
      rejectIfUnlinkedByUser(link);
      if (works.has(work.id)) throw new StudioError("invalid_input", "같은 ID 의 업무가 이미 있다.");
      works.set(work.id, copy(work));
      writeLink(link);
    },

    async createWork(work) {
      if (!isValidWorkId(work.id)) throw new StudioError("invalid_input", "업무 ID 는 영문 소문자와 숫자로만 이뤄진다.");
      if (!isAcceptedWorkGoal(work.goal)) throw new StudioError("invalid_input", "업무 목표가 올바르지 않다.");
      if (!projects.has(work.projectId)) throw new StudioError("not_found", "업무를 둘 프로젝트가 없다.");
      if (works.has(work.id)) throw new StudioError("invalid_input", "같은 ID 의 업무가 이미 있다.");
      works.set(work.id, copy(work));
    },
    async setWorkGoal(update) {
      if (!isAcceptedWorkGoal(update.goal) || update.goal === "") throw new StudioError("invalid_input", "업무 목표가 올바르지 않다.");
      const work = works.get(update.workId);
      if (work === undefined) throw new StudioError("not_found", "목표를 적을 업무가 없다.");
      works.set(work.id, { ...work, goal: update.goal });
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
      if (!isAcceptedReviewNoteField(decision.reason) || !isAcceptedReviewNoteField(decision.doneWhen)) {
        throw new StudioError("invalid_input", "검토 결정의 이유 · 수정 기준이 올바르지 않다.");
      }
      if (!works.has(decision.workId)) throw new StudioError("not_found", "검토 결정을 남길 업무가 없다.");
      reviews.push(copy(decision));
    },

    async updateWorkStatus(update) {
      // 확인 순서는 PostgreSQL 구현과 같다: 상태 값 → 없는 업무 → 지금 상태가 expected 와 같은가
      const statuses = [update.expected, update.status, ...update.changes.flatMap((c) => [c.from, c.to])];
      if (!statuses.every(isWorkStatus)) throw new StudioError("invalid_input", "업무 상태 값이 올바르지 않다.");
      const work = works.get(update.workId);
      if (work === undefined) throw new StudioError("not_found", "상태를 바꿀 업무가 없다.");
      if (update.changes.some((c) => c.workId !== update.workId)) throw new StudioError("invalid_input", "이력이 다른 업무를 가리킨다.");
      if (work.status !== update.expected) return false;
      works.set(work.id, { ...work, status: update.status });
      if (update.pin === null) statusPins.delete(work.id);
      else statusPins.set(work.id, copy(update.pin));
      statusChanges.push(...copies(update.changes));
      return true;
    },
    async listStatusPins() {
      return Object.fromEntries(copies(statusPins.entries()));
    },
    async listStatusChanges() {
      return copies(statusChanges);
    },

    async addPrEvents(batch) {
      // 확인을 모두 마친 뒤에 쓴다. 확인 순서는 PostgreSQL 구현과 같다: 범위 · 종류 → 없는 업무
      for (const e of batch) {
        rejectIfBadRef(e);
        if (!isPrEventKind(e.kind)) throw new StudioError("invalid_input", "PR 이벤트 종류가 올바르지 않다.");
      }
      if (batch.some((e) => !works.has(e.workId))) throw new StudioError("not_found", "PR 이벤트를 남길 업무가 없다.");
      const seen = new Set(events.map((e) => e.id));
      for (const e of batch) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        events.push(copy(e));
      }
    },
    async listPrEvents(workId) {
      return copies(events.filter((e) => e.workId === workId));
    },

    async addMemo(memo) {
      // 확인 순서는 PostgreSQL 구현과 같다: 값 → 없는 업무 → 같은 ID → 답글의 대상
      if (
        !isAcceptedMemoBody(memo.body) ||
        memo.author === "" ||
        memo.editedAt !== null ||
        memo.deletedAt !== null ||
        (memo.thread !== null && !isValidThreadTarget(memo.thread))
      ) {
        throw new StudioError("invalid_input", "메모 값이 올바르지 않다.");
      }
      if (!works.has(memo.workId)) throw new StudioError("not_found", "메모를 남길 업무가 없다.");
      if (memos.some((m) => m.id === memo.id)) throw new StudioError("invalid_input", "같은 ID 의 메모가 이미 있다.");
      if (memo.thread?.kind === "memo") {
        const { memoId } = memo.thread;
        // 스레드는 한 단계만: 답글의 대상은 같은 업무의 최상위 메모여야 한다
        if (!memos.some((m) => m.id === memoId && m.workId === memo.workId && m.thread === null)) {
          throw new StudioError("invalid_input", "답글은 같은 업무의 최상위 메모에만 단다.");
        }
      }
      memos.push(copy(memo));
    },
    async listMemos(workId) {
      return copies(memos.filter((m) => m.workId === workId));
    },
    async editMemo(edit) {
      if (!isAcceptedMemoBody(edit.body)) throw new StudioError("invalid_input", "메모 값이 올바르지 않다.");
      const i = memoIn(edit.workId, edit.id);
      if (i < 0) throw new StudioError("not_found", "고칠 메모가 없다.");
      const memo = memos[i]!;
      if (memo.deletedAt !== null) throw new StudioError("invalid_input", "지운 메모는 고치지 않는다.");
      memos[i] = { ...memo, body: edit.body, editedAt: edit.editedAt };
    },
    async deleteMemo(target) {
      const i = memoIn(target.workId, target.id);
      if (i < 0) throw new StudioError("not_found", "지울 메모가 없다.");
      const memo = memos[i]!;
      if (memo.deletedAt === null) memos[i] = { ...memo, body: "", deletedAt: target.deletedAt };
    },

    async listAgentDrafts() {
      return copies([...agents.values()].sort(byCreated));
    },
    async getAgentDraft(id) {
      const draft = agents.get(id);
      return draft && copy(draft);
    },
    async createAgentDraft(draft) {
      // 확인 순서는 PostgreSQL 구현과 같다: 칸 · 시각 → 같은 ID
      if (!isAcceptedAgentDraft(draft, [...skillDrafts.values()]) || draft.createdAt === "" || draft.updatedAt === "") {
        throw new StudioError("invalid_input", "Agent 초안의 값이 올바르지 않다.");
      }
      if (agents.has(draft.id)) throw new StudioError("invalid_input", "같은 ID 의 Agent 초안이 이미 있다.");
      agents.set(draft.id, copy(draft));
    },
    async saveAgentDraft(update) {
      // 확인 순서는 PostgreSQL 구현과 같다: 칸 · 시각 → 없는 초안
      if (!isAcceptedAgentDraft(update, [...skillDrafts.values()]) || update.updatedAt === "") throw new StudioError("invalid_input", "Agent 초안의 값이 올바르지 않다.");
      const draft = agents.get(update.id);
      if (draft === undefined) throw new StudioError("not_found", "고칠 Agent 초안이 없다.");
      const { name, summary, instructions, skills, updatedAt } = update;
      agents.set(draft.id, copy({ ...draft, name, summary, instructions, skills, updatedAt }));
    },

    async listSkillDrafts() {
      return copies([...skillDrafts.values()].sort(byCreated));
    },
    async getSkillDraft(id) {
      const draft = skillDrafts.get(id);
      return draft && copy(draft);
    },
    async createSkillDraft(draft) {
      // 확인 순서는 PostgreSQL 구현과 같다: 칸 · 시각 → 같은 ID → 같은 이름
      if (!isAcceptedSkillDraft(draft) || draft.createdAt === "" || draft.updatedAt === "") {
        throw new StudioError("invalid_input", "Skill 초안의 값이 올바르지 않다.");
      }
      if (skillDrafts.has(draft.id)) throw new StudioError("invalid_input", "같은 ID 의 Skill 초안이 이미 있다.");
      if (isDuplicateSkillName(draft, [...skillDrafts.values()])) throw new StudioError("duplicate_name", "같은 이름의 Skill 이 이미 있다.");
      skillDrafts.set(draft.id, copy(draft));
    },
    async saveSkillDraft(update) {
      // 확인 순서는 PostgreSQL 구현과 같다: 칸 · 시각 → 없는 초안 → 같은 이름
      if (!isAcceptedSkillDraft(update) || update.updatedAt === "") throw new StudioError("invalid_input", "Skill 초안의 값이 올바르지 않다.");
      const draft = skillDrafts.get(update.id);
      if (draft === undefined) throw new StudioError("not_found", "고칠 Skill 초안이 없다.");
      if (isDuplicateSkillName(update, [...skillDrafts.values()])) throw new StudioError("duplicate_name", "같은 이름의 Skill 이 이미 있다.");
      const { name, summary, instructions, updatedAt } = update;
      skillDrafts.set(draft.id, copy({ ...draft, name, summary, instructions, updatedAt }));
    },

    async listPreviewRecords() {
      return copies(previews);
    },
  };
}
