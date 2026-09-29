/**
 * 저장 계약 — PostgreSQL 저장소. TEST_DATABASE_URL 이 있을 때만 돈다(없으면 건너뛰었다고 출력한다).
 * 시험 전에 스키마를 지우고 적용 명령으로 처음부터 다시 만들며, 시험마다 데이터를 비운다.
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresStore, lockPr, seedIfEmpty } from "../../src/adapters/store/postgres/postgres-store";
import { demoStudioSeed } from "../../src/adapters/github/fixture/demo-scenario";
import { HAS_POSTGRES, recreateSchema, TEST_DATABASE_URL, truncateAll } from "./postgres-harness";
import { describeStoreContract } from "./store-contract";

describe.skipIf(!HAS_POSTGRES)("PostgreSQL", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    await recreateSchema(TEST_DATABASE_URL);
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
  });
  beforeEach(async () => truncateAll(pool));
  afterAll(async () => pool?.end());

  describeStoreContract("postgres", async (seed) => {
    await seedIfEmpty(pool, seed);
    return createPostgresStore(pool);
  });

  it("Agent 초안은 초안 표가 비어 있을 때만 심는다 — 프로젝트가 이미 있는 데이터베이스에도 심고, 이미 있으면 다시 심지 않는다 (결정 20)", async () => {
    await seedIfEmpty(pool, { projects: [{ id: "p", name: "p", repoIds: [1] }] }); // 초안 표가 생기기 전부터 쓰던 데이터베이스
    const seed = demoStudioSeed();
    expect(await seedIfEmpty(pool, seed)).toBe(false); // 프로젝트는 다시 심지 않는다
    const store = createPostgresStore(pool);
    expect((await store.listAgentDrafts()).map((a) => a.id)).toEqual(["planner", "builder", "reviewer"]);
    await store.saveAgentDraft({ id: "builder", name: "Builder", summary: "고친 소개", instructions: "", skills: [], updatedAt: "2026-09-28T01:00:00.000Z" });
    await seedIfEmpty(pool, seed);
    expect((await store.listAgentDrafts()).map((a) => a.id)).toEqual(["planner", "builder", "reviewer"]);
    expect((await store.getAgentDraft("builder"))?.summary).toBe("고친 소개"); // 사람이 고친 초안을 덮어쓰지 않는다
    // 표의 제약도 칸 규칙의 바깥 경계를 지킨다
    await expect(pool.query("insert into agent_draft (id, name, skills, created_at, updated_at) values ('x', '', '{}', now(), now())")).rejects.toThrow();
    await expect(pool.query("insert into agent_draft (id, name, skills, created_at, updated_at) values ('x', 'X', '{Deploy}', now(), now())")).rejects.toThrow(); // Skill id 의 모양이 아니다
  });

  it("Skill 초안도 Skill 표가 비어 있을 때만 심고, 사람이 고친 것을 덮어쓰지 않는다. 표도 같은 이름(대소문자 무시)을 막는다 (결정 21)", async () => {
    await seedIfEmpty(pool, { projects: [{ id: "p", name: "p", repoIds: [1] }] });
    const seed = demoStudioSeed();
    await seedIfEmpty(pool, seed);
    const store = createPostgresStore(pool);
    await store.saveSkillDraft({ id: "release-notes", name: "Release notes", summary: "고친 소개", instructions: "", updatedAt: "2026-09-29T01:00:00.000Z" });
    await seedIfEmpty(pool, seed);
    expect((await store.listSkillDrafts()).map((k) => [k.id, k.summary])).toEqual([["release-notes", "고친 소개"]]);
    await expect(pool.query("insert into skill_draft (id, name, created_at, updated_at) values ('x', 'RELEASE NOTES', now(), now())")).rejects.toThrow();
    await expect(pool.query("insert into skill_draft (id, name, created_at, updated_at) values ('read_context', 'Y', now(), now())")).rejects.toThrow();
    await pool.query("insert into agent_draft (id, name, skills, created_at, updated_at) values ('x', 'X', '{read_context,release-notes}', now(), now())"); // 사용자 Skill id 도 받는다
  });

  it("두 연결의 경쟁: 연결 해제가 커밋되기 전에 들어온 표식 연결은, 해제가 커밋된 뒤 해제 기록을 보고 거절된다", async () => {
    await seedIfEmpty(pool, {
      projects: [{ id: "p", name: "p", repoIds: [1] }],
      works: [{ id: "w1", projectId: "p", title: "업무", status: "draft", createdAt: "2026-09-25T00:00:00.000Z" }],
      links: [{ repoId: 1, number: 1, workId: "w1", origin: "user", linkedAt: "2026-09-25T00:00:00.000Z" }],
    });
    const store = createPostgresStore(pool);
    const ref = { repoId: 1, number: 1 };

    // 연결 1: 연결 해제를 저장소와 똑같이(PR 잠금 → 삭제 → 해제 기록) 진행하되 아직 커밋하지 않는다
    const unlinker = await pool.connect();
    await unlinker.query("begin");
    await lockPr(unlinker, ref);
    await unlinker.query("delete from pr_link where repo_id = 1 and number = 1");
    await unlinker.query("insert into pr_unlink (repo_id, number, work_id, unlinked_at) values (1, 1, 'w1', now())");

    // 연결 2: 그사이 표식 연결을 시도한다 — 잠금에서 기다려야 한다
    let settled = false;
    const marker = store
      .addLink({ ...ref, workId: "w1", origin: "marker", markerFoundIn: ["body"], linkedAt: "2026-09-25T00:00:01.000Z" })
      .finally(() => {
        settled = true;
      });
    const markerOutcome = marker.then(
      () => "linked",
      (e: { code?: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false); // 해제가 끝나기를 기다리고 있다

    await unlinker.query("commit");
    unlinker.release();

    expect(await markerOutcome).toBe("unlinked_by_user");
    expect(await store.listLinks()).toEqual([]); // 사람이 푼 연결이 되살아나지 않았다
    expect(await store.listUnlinks()).toHaveLength(1);
  });
});
