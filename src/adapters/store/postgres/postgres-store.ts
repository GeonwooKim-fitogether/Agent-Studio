/**
 * PostgreSQL 저장 어댑터 — `StudioStore` 를 `pg` 드라이버 하나로 구현한다(ORM · 쿼리 빌더 없음).
 * 스키마는 db/migrations/ 의 파일이 정본이고, 적용은 `npm run db:migrate` 가 한다. 이 어댑터는 표를 만들지 않는다.
 *
 * - 복사본 규칙: 모든 조회가 데이터베이스 왕복이라 돌려주는 값은 늘 새 객체다.
 * - 한 PR 에 연결 하나: pr_link 의 기본 키 (repo_id, number) 가 데이터베이스 수준에서 지킨다.
 * - 업무 생성+연결, 연결, 연결 해제는 트랜잭션 하나로 한다. 확인과 쓰기 사이에 다른 요청이 끼어들어도
 *   기본 키 충돌이나 조건부 삭제로 결과가 하나로 정해진다.
 * - 시각은 timestamptz 로 저장하고, 돌려줄 때는 Date.toISOString() 형식(밀리초, Z)으로 맞춘다.
 */
import type { Pool, PoolClient } from "pg";
import {
  type MarkerPlace,
  type PreviewRecord,
  type PrLink,
  type PrRef,
  type PrSnapshot,
  type Project,
  type Repository,
  type ReviewDecision,
  StudioError,
  type UnlinkRecord,
  type Work,
  isValidPrRef,
  withoutNul,
} from "../../../domain/model";
import { isAcceptedMemoBody, type Memo } from "../../../domain/memo";
import { isPrEventKind, type PrEvent } from "../../../domain/pr-event";
import { isValidWorkId } from "../../../domain/work-marker";
import { isWorkStatus, type PrFingerprint, type StatusCause, type StatusChange, type StatusEvidence } from "../../../domain/work-status";
import type { StudioSeed, StudioStore } from "../../../ports/studio-store";

type Row = Record<string, unknown>;

const iso = (value: unknown): string => (value instanceof Date ? value : new Date(String(value))).toISOString();
const num = (value: unknown): number => Number(value);

const toProject = (r: Row): Project => ({
  id: String(r["id"]),
  name: String(r["name"]),
  repoIds: (r["repo_ids"] as unknown[]).map(num),
});
const toWork = (r: Row): Work => ({
  id: String(r["id"]),
  projectId: String(r["project_id"]),
  title: String(r["title"]),
  status: r["status"] as Work["status"],
  createdAt: iso(r["created_at"]),
});
const toSnapshot = (r: Row): PrSnapshot => ({
  repoId: num(r["repo_id"]),
  number: num(r["number"]),
  title: String(r["title"]),
  body: String(r["body"]),
  branch: String(r["branch"]),
  headRepoId: r["head_repo_id"] === null ? null : num(r["head_repo_id"]),
  headSha: String(r["head_sha"]),
  url: String(r["url"]),
  author: String(r["author"]),
  state: r["state"] as PrSnapshot["state"],
  checks: r["checks"] as PrSnapshot["checks"],
  review: r["review"] as PrSnapshot["review"],
  updatedAt: iso(r["updated_at"]),
});
const toLink = (r: Row): PrLink => {
  const base = { repoId: num(r["repo_id"]), number: num(r["number"]), workId: String(r["work_id"]), linkedAt: iso(r["linked_at"]) };
  return r["origin"] === "marker"
    ? { ...base, origin: "marker", markerFoundIn: r["marker_found_in"] as MarkerPlace[] }
    : { ...base, origin: "user" };
};
const toReview = (r: Row): ReviewDecision => ({
  id: String(r["id"]),
  workId: String(r["work_id"]),
  repoId: num(r["repo_id"]),
  number: num(r["number"]),
  commitSha: String(r["commit_sha"]),
  verdict: r["verdict"] as ReviewDecision["verdict"],
  decidedAt: iso(r["decided_at"]),
});
const toPreview = (r: Row): PreviewRecord => ({
  id: String(r["id"]),
  repoId: num(r["repo_id"]),
  number: num(r["number"]),
  commitSha: String(r["commit_sha"]),
  startedAt: iso(r["started_at"]),
});
const toUnlink = (r: Row): UnlinkRecord => ({
  repoId: num(r["repo_id"]),
  number: num(r["number"]),
  workId: String(r["work_id"]),
  unlinkedAt: iso(r["unlinked_at"]),
});

const toStatusChange = (r: Row): StatusChange => {
  const cause: StatusCause =
    r["actor"] === "rule"
      ? {
          kind: "rule",
          rule: r["rule"] as Extract<StatusCause, { kind: "rule" }>["rule"],
          evidence: (r["evidence"] as StatusEvidence[]).map((e) => ({ repoId: num(e.repoId), number: num(e.number), commitSha: String(e.commitSha) })),
        }
      : { kind: "person", action: r["action"] as Extract<StatusCause, { kind: "person" }>["action"] };
  return {
    id: String(r["id"]),
    workId: String(r["work_id"]),
    from: r["from_status"] as StatusChange["from"],
    to: r["to_status"] as StatusChange["to"],
    cause,
    changedAt: iso(r["changed_at"]),
  };
};

const toPrEvent = (r: Row): PrEvent => {
  const base = {
    id: String(r["id"]),
    repoId: num(r["repo_id"]),
    number: num(r["number"]),
    workId: String(r["work_id"]),
    commitSha: String(r["commit_sha"]),
    at: iso(r["at"]),
  };
  switch (r["kind"]) {
    case "linked":
      return { ...base, kind: "linked", origin: r["origin"] as "marker" | "user" };
    case "new_commit":
      return { ...base, kind: "new_commit", previousSha: String(r["previous_sha"]) };
    case "checks":
      return { ...base, kind: "checks", checks: r["checks"] as PrSnapshot["checks"] };
    default:
      return { ...base, kind: r["kind"] as "unlinked" | "merged" | "closed" | "reopened" };
  }
};

const toMemo = (r: Row): Memo => ({
  id: String(r["id"]),
  workId: String(r["work_id"]),
  author: String(r["author"]),
  body: String(r["body"]),
  createdAt: iso(r["created_at"]),
  editedAt: r["edited_at"] === null ? null : iso(r["edited_at"]),
  deletedAt: r["deleted_at"] === null ? null : iso(r["deleted_at"]),
});

/** 메모 한 건을 쓴다. 같은 ID 가 이미 있으면 invalid_input (메모리 구현과 같다) */
async function insertMemo(db: Queryable, m: Memo): Promise<void> {
  const inserted = await db.query(
    `insert into memo (id, work_id, author, body, created_at, edited_at, deleted_at) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (id) do nothing`,
    [m.id, m.workId, m.author, m.body, m.createdAt, m.editedAt, m.deletedAt],
  );
  if ((inserted.rowCount ?? 0) === 0) throw new StudioError("invalid_input", "같은 ID 의 메모가 이미 있다.");
}

/** PR 이벤트 한 건을 쓴다. 같은 ID 가 이미 있으면 아무것도 하지 않는다(같은 변화는 한 번만) */
async function insertPrEvent(db: Queryable, e: PrEvent): Promise<void> {
  await db.query(
    `insert into pr_event (id, repo_id, number, work_id, kind, commit_sha, origin, previous_sha, checks, at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (id) do nothing`,
    [
      e.id,
      e.repoId,
      e.number,
      e.workId,
      e.kind,
      e.commitSha,
      e.kind === "linked" ? e.origin : null,
      e.kind === "new_commit" ? e.previousSha : null,
      e.kind === "checks" ? e.checks : null,
      e.at,
    ],
  );
}

/** 트랜잭션 하나 안에서 fn 을 돌린다. 던지면 되돌린다. */
async function inTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw translate(error);
  } finally {
    client.release();
  }
}

/**
 * PostgreSQL 의 제약 위반을 도메인 오류로 옮긴다. 원시 오류가 화면까지 올라가 500 이 되지 않게 한다.
 * (오류 메시지에는 값이나 연결 정보를 싣지 않는다.)
 */
function translate(error: unknown): unknown {
  if (error instanceof StudioError) return error;
  const code = (error as { code?: unknown }).code;
  if (code === "23503") return new StudioError("not_found", "가리키는 업무나 프로젝트가 없다.");
  // 23514 check 위반 · 23502 not null · 22003 범위 초과 · 22P02 형식 · 22021 NUL 같은 저장할 수 없는 글자
  if (code === "23514" || code === "23502" || code === "22003" || code === "22P02" || code === "22021") {
    return new StudioError("invalid_input", "저장할 수 없는 값이다.");
  }
  return error;
}

type Queryable = Pick<PoolClient, "query">;

/**
 * PR 하나 단위의 잠금을 트랜잭션이 끝날 때까지 잡는다. 연결 쓰기(writeLink)와 연결 해제(unlink)가 같은 잠금을 쓰므로
 * 같은 PR 에 대한 둘은 차례로만 실행된다. 그래서 "해제 기록 확인 → 연결 쓰기" 사이에 해제가 끼어들 수 없다.
 * (READ COMMITTED 에서는 잠금을 얻은 뒤의 문장이 그전에 커밋된 해제를 본다.)
 */
export async function lockPr(db: Queryable, ref: PrRef): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`pr:${ref.repoId}#${ref.number}`]);
}

const assertRef = (ref: PrRef) => {
  if (!isValidPrRef(ref)) throw new StudioError("invalid_input", "PR 을 가리키는 값이 올바르지 않다.");
};

/**
 * 연결 한 건을 쓴다. 호출하는 쪽의 트랜잭션 안에서, PR 잠금을 잡은 뒤에 부른다.
 * 확인 순서(메모리 구현과 같다): 이미 연결됨 → 없는 업무 → 사람이 푼 PR(표식의 연결일 때).
 * 사람의 연결은 해제 기록을 함께 지운다.
 */
async function writeLink(db: Queryable, link: PrLink): Promise<void> {
  const linked = await db.query("select 1 from pr_link where repo_id = $1 and number = $2", [link.repoId, link.number]);
  if ((linked.rowCount ?? 0) > 0) throw new StudioError("already_linked", "이 PR 은 이미 업무에 연결돼 있다.");
  const work = await db.query("select 1 from work where id = $1", [link.workId]);
  if ((work.rowCount ?? 0) === 0) throw new StudioError("not_found", "연결하려는 업무가 없다.");
  if (link.origin === "marker") {
    const blocked = await db.query("select 1 from pr_unlink where repo_id = $1 and number = $2", [link.repoId, link.number]);
    if ((blocked.rowCount ?? 0) > 0) {
      throw new StudioError("unlinked_by_user", "사람이 연결을 푼 PR 은 표식으로 다시 연결하지 않는다.");
    }
  }
  const inserted = await db.query(
    `insert into pr_link (repo_id, number, work_id, origin, marker_found_in, linked_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (repo_id, number) do nothing`,
    [link.repoId, link.number, link.workId, link.origin, link.origin === "marker" ? link.markerFoundIn : null, link.linkedAt],
  );
  if ((inserted.rowCount ?? 0) === 0) throw new StudioError("already_linked", "이 PR 은 이미 업무에 연결돼 있다.");
  if (link.origin === "user") {
    await db.query("delete from pr_unlink where repo_id = $1 and number = $2", [link.repoId, link.number]);
  }
}

export function createPostgresStore(pool: Pool): StudioStore {
  /** 쿼리 하나. 제약 위반은 도메인 오류로 옮긴다. */
  const run = async (sql: string, params: unknown[] = []) => {
    try {
      return await pool.query(sql, params);
    } catch (error) {
      throw translate(error);
    }
  };
  const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await run(sql, params)).rows as Row[];
  const byRef = (ref: PrRef) => [ref.repoId, ref.number];

  return {
    async listProjects() {
      return (await rows("select id, name, repo_ids from project order by ord")).map(toProject);
    },
    async saveProject(project) {
      await run(
        `insert into project (id, name, repo_ids) values ($1, $2, $3)
         on conflict (id) do update set name = excluded.name, repo_ids = excluded.repo_ids`,
        [project.id, project.name, project.repoIds],
      );
    },

    async listWorks() {
      return (await rows("select * from work order by created_at, id")).map(toWork);
    },
    async getWork(id) {
      const [row] = await rows("select * from work where id = $1", [id]);
      return row && toWork(row);
    },
    async createWorkWithLink(work, link) {
      // 확인 순서는 메모리 구현과 같다: 범위 → 연결 대상 → 업무 ID 형식 → 이미 연결됨 → 없는 프로젝트 → 사람이 푼 PR → 업무 ID 중복
      assertRef(link);
      if (link.workId !== work.id) throw new StudioError("invalid_input", "연결이 새 업무를 가리키지 않는다.");
      if (!isValidWorkId(work.id)) throw new StudioError("invalid_input", "업무 ID 는 영문 소문자와 숫자로만 이뤄진다.");
      await inTransaction(pool, async (db) => {
        await lockPr(db, link);
        const linked = await db.query("select 1 from pr_link where repo_id = $1 and number = $2", [link.repoId, link.number]);
        if ((linked.rowCount ?? 0) > 0) throw new StudioError("already_linked", "이 PR 은 이미 업무에 연결돼 있다.");
        const project = await db.query("select 1 from project where id = $1", [work.projectId]);
        if ((project.rowCount ?? 0) === 0) throw new StudioError("not_found", "업무를 둘 프로젝트가 없다.");
        if (link.origin === "marker") {
          const blocked = await db.query("select 1 from pr_unlink where repo_id = $1 and number = $2", [link.repoId, link.number]);
          if ((blocked.rowCount ?? 0) > 0) throw new StudioError("unlinked_by_user", "사람이 연결을 푼 PR 은 표식으로 다시 연결하지 않는다.");
        }
        const inserted = await db.query(
          `insert into work (id, project_id, title, status, created_at) values ($1, $2, $3, $4, $5)
           on conflict (id) do nothing`,
          [work.id, work.projectId, work.title, work.status, work.createdAt],
        );
        if ((inserted.rowCount ?? 0) === 0) throw new StudioError("invalid_input", "같은 ID 의 업무가 이미 있다.");
        await writeLink(db, link); // 이미 연결된 PR 이면 여기서 던지고, 위의 업무도 함께 되돌려진다
      });
    },

    async createWork(work) {
      // 확인 순서는 메모리 구현과 같다: 업무 ID 형식 → 없는 프로젝트 → 업무 ID 중복
      if (!isValidWorkId(work.id)) throw new StudioError("invalid_input", "업무 ID 는 영문 소문자와 숫자로만 이뤄진다.");
      await inTransaction(pool, async (db) => {
        const project = await db.query("select 1 from project where id = $1 for share", [work.projectId]);
        if ((project.rowCount ?? 0) === 0) throw new StudioError("not_found", "업무를 둘 프로젝트가 없다.");
        const inserted = await db.query(
          `insert into work (id, project_id, title, status, created_at) values ($1, $2, $3, $4, $5)
           on conflict (id) do nothing`,
          [work.id, work.projectId, work.title, work.status, work.createdAt],
        );
        if ((inserted.rowCount ?? 0) === 0) throw new StudioError("invalid_input", "같은 ID 의 업무가 이미 있다.");
      });
    },

    async listRepositories() {
      return (await rows("select id, full_name from repository order by id")).map((r) => ({
        id: num(r["id"]),
        fullName: String(r["full_name"]),
      }));
    },
    async saveRepository(repository: Repository) {
      await run(
        `insert into repository (id, full_name) values ($1, $2)
         on conflict (id) do update set full_name = excluded.full_name`,
        [repository.id, repository.fullName],
      );
    },

    async listSnapshots() {
      return (await rows("select * from pr_snapshot order by repo_id, number")).map(toSnapshot);
    },
    async getSnapshot(ref) {
      if (!isValidPrRef(ref)) return undefined; // 범위 밖의 값은 있을 수 없으므로 묻지 않는다 (메모리 구현과 같은 결과)
      const [row] = await rows("select * from pr_snapshot where repo_id = $1 and number = $2", byRef(ref));
      return row && toSnapshot(row);
    },
    async saveSnapshot(snapshot) {
      assertRef(snapshot);
      const s = withoutNul(snapshot); // PostgreSQL 은 글 칸에 NUL 을 저장하지 못한다
      await run(
        `insert into pr_snapshot
           (repo_id, number, title, body, branch, head_repo_id, head_sha, url, author, state, checks, review, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (repo_id, number) do update set
           title = excluded.title, body = excluded.body, branch = excluded.branch, head_repo_id = excluded.head_repo_id,
           head_sha = excluded.head_sha, url = excluded.url, author = excluded.author, state = excluded.state,
           checks = excluded.checks, review = excluded.review, updated_at = excluded.updated_at`,
        [s.repoId, s.number, s.title, s.body, s.branch, s.headRepoId, s.headSha, s.url, s.author, s.state, s.checks, s.review, s.updatedAt],
      );
    },

    async listLinks() {
      return (await rows("select * from pr_link order by repo_id, number")).map(toLink);
    },
    async getLink(ref) {
      if (!isValidPrRef(ref)) return undefined;
      const [row] = await rows("select * from pr_link where repo_id = $1 and number = $2", byRef(ref));
      return row && toLink(row);
    },
    async addLink(link) {
      assertRef(link);
      await inTransaction(pool, async (db) => {
        await lockPr(db, link);
        await writeLink(db, link);
      });
    },
    async unlink(ref, unlinkedAt) {
      assertRef(ref);
      await inTransaction(pool, async (db) => {
        await lockPr(db, ref);
        const deleted = await db.query("delete from pr_link where repo_id = $1 and number = $2 and work_id = $3", [
          ref.repoId,
          ref.number,
          ref.workId,
        ]);
        if ((deleted.rowCount ?? 0) === 0) throw new StudioError("not_linked", "이 PR 은 이 업무에 연결돼 있지 않다.");
        await db.query(
          `insert into pr_unlink (repo_id, number, work_id, unlinked_at) values ($1, $2, $3, $4)
           on conflict (repo_id, number) do update set work_id = excluded.work_id, unlinked_at = excluded.unlinked_at`,
          [ref.repoId, ref.number, ref.workId, unlinkedAt],
        );
      });
    },
    async listUnlinks() {
      return (await rows("select * from pr_unlink order by repo_id, number")).map(toUnlink);
    },

    async listReviewDecisions() {
      return (await rows("select * from review_decision order by decided_at, id")).map(toReview);
    },
    async addReviewDecision(d) {
      assertRef(d);
      await run(
        `insert into review_decision (id, work_id, repo_id, number, commit_sha, verdict, decided_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [d.id, d.workId, d.repoId, d.number, d.commitSha, d.verdict, d.decidedAt],
      );
    },

    async updateWorkStatus(update) {
      // 확인 순서는 메모리 구현과 같다: 상태 값 → 없는 업무 → 지금 상태가 expected 와 같은가
      const statuses = [update.expected, update.status, ...update.changes.flatMap((c) => [c.from, c.to])];
      if (!statuses.every(isWorkStatus)) throw new StudioError("invalid_input", "업무 상태 값이 올바르지 않다.");
      if (update.changes.some((c) => c.workId !== update.workId)) throw new StudioError("invalid_input", "이력이 다른 업무를 가리킨다.");
      return inTransaction(pool, async (db) => {
        // 업무 행을 잠근 뒤 지금 상태를 본다 — 두 판정이 겹쳐도 한쪽만 쓰고, 이력이 두 번 쌓이지 않는다
        const current = await db.query("select status from work where id = $1 for update", [update.workId]);
        const row = current.rows[0] as Row | undefined;
        if (row === undefined) throw new StudioError("not_found", "상태를 바꿀 업무가 없다.");
        if (row["status"] !== update.expected) return false;
        await db.query("update work set status = $2, status_pin = $3 where id = $1", [
          update.workId,
          update.status,
          update.pin === null ? null : JSON.stringify(update.pin),
        ]);
        for (const c of update.changes) {
          const rule = c.cause.kind === "rule" ? c.cause : null;
          await db.query(
            `insert into work_status_change (id, work_id, from_status, to_status, actor, rule, evidence, action, changed_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              c.id,
              c.workId,
              c.from,
              c.to,
              c.cause.kind,
              rule?.rule ?? null,
              rule === null ? null : JSON.stringify(rule.evidence),
              c.cause.kind === "person" ? c.cause.action : null,
              c.changedAt,
            ],
          );
        }
        return true;
      });
    },
    async listStatusPins() {
      const pins = await rows("select id, status_pin from work where status_pin is not null order by id");
      return Object.fromEntries(pins.map((r) => [String(r["id"]), r["status_pin"] as PrFingerprint]));
    },
    async listStatusChanges() {
      return (await rows("select * from work_status_change order by ord")).map(toStatusChange);
    },

    async addPrEvents(events) {
      // 확인 순서는 메모리 구현과 같다: 범위 · 종류 → 없는 업무(외래 키 위반 → not_found)
      for (const e of events) {
        assertRef(e);
        if (!isPrEventKind(e.kind)) throw new StudioError("invalid_input", "PR 이벤트 종류가 올바르지 않다.");
      }
      if (events.length === 0) return;
      await inTransaction(pool, async (db) => {
        for (const e of events) await insertPrEvent(db, e);
      });
    },
    async listPrEvents(workId) {
      return (await rows("select * from pr_event where work_id = $1 order by ord", [workId])).map(toPrEvent);
    },

    async addMemo(memo) {
      // 확인 순서는 메모리 구현과 같다: 값 → 없는 업무(외래 키 위반 → not_found) → 같은 ID
      if (!isAcceptedMemoBody(memo.body) || memo.author === "" || memo.editedAt !== null || memo.deletedAt !== null) {
        throw new StudioError("invalid_input", "메모 값이 올바르지 않다.");
      }
      try {
        await insertMemo(pool, memo);
      } catch (error) {
        throw translate(error);
      }
    },
    async listMemos(workId) {
      return (await rows("select * from memo where work_id = $1 order by ord", [workId])).map(toMemo);
    },
    async editMemo(edit) {
      if (!isAcceptedMemoBody(edit.body)) throw new StudioError("invalid_input", "메모 값이 올바르지 않다.");
      const updated = await run("update memo set body = $3, edited_at = $4 where work_id = $1 and id = $2 and deleted_at is null", [
        edit.workId,
        edit.id,
        edit.body,
        edit.editedAt,
      ]);
      if ((updated.rowCount ?? 0) > 0) return;
      const [row] = await rows("select deleted_at from memo where work_id = $1 and id = $2", [edit.workId, edit.id]);
      if (row === undefined) throw new StudioError("not_found", "고칠 메모가 없다.");
      throw new StudioError("invalid_input", "지운 메모는 고치지 않는다.");
    },
    async deleteMemo(target) {
      const updated = await run("update memo set body = '', deleted_at = $3 where work_id = $1 and id = $2 and deleted_at is null", [
        target.workId,
        target.id,
        target.deletedAt,
      ]);
      if ((updated.rowCount ?? 0) > 0) return;
      const [row] = await rows("select 1 from memo where work_id = $1 and id = $2", [target.workId, target.id]);
      if (row === undefined) throw new StudioError("not_found", "지울 메모가 없다.");
    },

    async listPreviewRecords() {
      return (await rows("select * from preview_record order by started_at, id")).map(toPreview);
    },
  };
}

/**
 * 저장소가 비어 있을 때만(프로젝트가 하나도 없을 때만) 처음 상태를 한 번 심는다. 트랜잭션 하나로 한다.
 * 조립부가 fixture 모드에서 시연 데이터를 심을 때 쓴다. 이미 데이터가 있으면 아무것도 하지 않고 false 를 돌려준다.
 */
export async function seedIfEmpty(pool: Pool, seed: StudioSeed): Promise<boolean> {
  return inTransaction(pool, async (db) => {
    await db.query("lock table project in exclusive mode");
    const existing = await db.query("select 1 from project limit 1");
    if ((existing.rowCount ?? 0) > 0) return false;
    for (const p of seed.projects ?? []) {
      await db.query("insert into project (id, name, repo_ids) values ($1, $2, $3)", [p.id, p.name, p.repoIds]);
    }
    for (const w of seed.works ?? []) {
      await db.query("insert into work (id, project_id, title, status, created_at) values ($1, $2, $3, $4, $5)", [
        w.id,
        w.projectId,
        w.title,
        w.status,
        w.createdAt,
      ]);
    }
    for (const l of seed.links ?? []) await writeLink(db, l);
    for (const u of seed.unlinks ?? []) {
      await db.query("insert into pr_unlink (repo_id, number, work_id, unlinked_at) values ($1, $2, $3, $4)", [
        u.repoId,
        u.number,
        u.workId,
        u.unlinkedAt,
      ]);
    }
    for (const d of seed.reviews ?? []) {
      await db.query(
        `insert into review_decision (id, work_id, repo_id, number, commit_sha, verdict, decided_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [d.id, d.workId, d.repoId, d.number, d.commitSha, d.verdict, d.decidedAt],
      );
    }
    for (const e of seed.events ?? []) await insertPrEvent(db, e);
    for (const m of seed.memos ?? []) await insertMemo(db, m);
    for (const p of seed.previews ?? []) {
      await db.query("insert into preview_record (id, repo_id, number, commit_sha, started_at) values ($1, $2, $3, $4, $5)", [
        p.id,
        p.repoId,
        p.number,
        p.commitSha,
        p.startedAt,
      ]);
    }
    return true;
  });
}
