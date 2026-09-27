/**
 * PostgreSQL 통합 시험 — 마이그레이션 적용 명령(통과 기준 1 · 7)과 재시작을 넘는 유지(통과 기준 3).
 * 적용 명령의 APP_ENV 거부는 데이터베이스 없이도 돈다. 나머지는 TEST_DATABASE_URL 이 있을 때만 돈다.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_REPO } from "../../src/adapters/github/fixture/demo-scenario";
import { createWorkFromPr, linkPrToWork, unlinkPr } from "../../src/application/inbox-actions";
import { getInbox, getWorkDetail, getWorkspace } from "../../src/application/queries";
import { createContainer } from "../../src/server/container";
import { HAS_POSTGRES, recreateSchema, runMigrate, TEST_DATABASE_URL } from "./postgres-harness";

/** 적용 명령을 돌려 종료 코드와 출력을 받는다(실패해도 던지지 않는다). */
function migrate(env: Record<string, string>): { code: number; output: string } {
  try {
    const out = execFileSync(process.execPath, ["db/migrate.mjs"], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("마이그레이션 적용 명령 — 환경 거부 (데이터베이스 없이)", () => {
  it.each(["production", "staging", "development", "", " local", "local ", "Local", "TEST", "local\n"])("APP_ENV=%j 이면 연결하기 전에 거부하고 아무것도 적용하지 않는다", (appEnv) => {
    const result = migrate({ APP_ENV: appEnv, DATABASE_URL: "postgresql://someone:NEVER_PRINT_ME@db.example.invalid:5432/prod" });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("local 또는 test 일 때만");
    expect(result.output).toContain("아무것도 적용하지 않았다");
    expect(result.output).not.toContain("NEVER_PRINT_ME");
  });
});

describe("마이그레이션 적용 명령 — 잘못된 연결 문자열 (데이터베이스 없이)", () => {
  it("형식이 잘못된 DATABASE_URL 이면 스택 대신 안내 문장을 내고, 비밀번호를 싣지 않는다", () => {
    const result = migrate({ APP_ENV: "test", DATABASE_URL: "postgres://someone:TOPSECRET_PW@[bad" });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("DATABASE_URL 의 형식을 해석할 수 없다");
    expect(result.output).not.toContain("TOPSECRET_PW");
    expect(result.output).not.toMatch(/\n\s+at /); // 스택 추적이 없다
  });
});

/** 저장소에 있는 마이그레이션 전부 (만든 순서) */
const MIGRATIONS = ["20260925070338_initial_schema", "20260927224929_work_status_history", "20260927232653_status_rule_r1b"];

describe.skipIf(!HAS_POSTGRES)("PostgreSQL 통합", () => {
  const tables = async () => {
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const r = await client.query(
        "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' order by 1, 2",
      );
      const m = await client.query("select name, applied_at from schema_migrations order by name");
      return { columns: r.rows, migrations: m.rows };
    } finally {
      await client.end();
    }
  };

  it("빈 데이터베이스에 처음부터 적용할 수 있고, 두 번째 실행은 아무것도 바꾸지 않는다", async () => {
    const first = await recreateSchema(TEST_DATABASE_URL);
    expect(first).toContain(`새로 적용 ${MIGRATIONS.length}개`);
    const before = await tables();
    expect(before.migrations.map((m) => m.name)).toEqual(MIGRATIONS);

    const second = runMigrate(TEST_DATABASE_URL, "test");
    for (const name of MIGRATIONS) expect(second).toContain(`건너뜀 (이미 적용됨) ${name}.sql`);
    expect(second).toContain("새로 적용 0개");
    expect(await tables()).toEqual(before); // 표 · 칸 · 적용 이력(시각 포함) 모두 그대로
  });

  it("상태 이력 마이그레이션은 이미 쓰던 데이터베이스에 얹혀도 기존 업무를 그대로 두고, 완료 후보를 받아들인다", async () => {
    // 첫 스키마만 있던 데이터베이스(= 이 단위 전의 로컬 데이터베이스)를 흉내 낸다
    await recreateSchema(TEST_DATABASE_URL);
    const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query("drop schema public cascade");
      await client.query("create schema public");
      await client.query(readFileSync("db/migrations/20260925070338_initial_schema.sql", "utf8"));
      await client.query("create table schema_migrations (name text primary key, applied_at timestamptz not null default now())");
      await client.query("insert into schema_migrations (name) values ('20260925070338_initial_schema')");
      await client.query("insert into project (id, name, repo_ids) values ('p', 'p', '{1}')");
      await client.query("insert into work (id, project_id, title, status, created_at) values ('w1', 'p', '업무', 'needs_review', now())");
      await expect(client.query("update work set status = 'done_candidate'")).rejects.toThrow(); // 옛 스키마는 모른다

      const out = runMigrate(TEST_DATABASE_URL, "test");
      expect(out).toContain("적용함 20260927224929_work_status_history.sql");
      expect(out).toContain("적용함 20260927232653_status_rule_r1b.sql");
      expect(out).toContain("새로 적용 2개");
      const row = (await client.query("select status, status_pin from work where id = 'w1'")).rows[0];
      expect(row).toEqual({ status: "needs_review", status_pin: null });
      await client.query("update work set status = 'done_candidate'");
      await expect(client.query("update work set status = 'finished'")).rejects.toThrow();
      expect(runMigrate(TEST_DATABASE_URL, "test")).toContain("새로 적용 0개");
    } finally {
      await client.end();
    }
  });

  it("출력에는 비밀번호도 연결 문자열 전체도 없다 (호스트 · 포트 · 데이터베이스 이름만)", () => {
    const withPassword = new URL(TEST_DATABASE_URL);
    withPassword.password = "SECRET_PASSWORD_123";
    const result = migrate({ APP_ENV: "test", DATABASE_URL: withPassword.href });
    expect(result.output).not.toContain("SECRET_PASSWORD_123");
    expect(result.output).not.toContain(withPassword.href);
    expect(result.output).toContain(`${withPassword.hostname}:`);
  });

  describe("서버를 다시 켜도 남는다", () => {
    beforeAll(async () => {
      await recreateSchema(TEST_DATABASE_URL);
    });

    it("사람이 만든 연결 · 업무 · 해제가 새 컨테이너(= 다시 켠 서버)에서도 그대로 보이고, 시연 데이터는 다시 심지 않는다", async () => {
      const env = { DATABASE_URL: TEST_DATABASE_URL };
      const first = createContainer(env);
      expect(first.storage).toBe("postgres");
      await first.ensureSynced();
      expect(first.status().lastError).toBeNull();
      await linkPrToWork(first.deps, { repoId: DEMO_REPO.coachWeb, number: 12, workId: "b4c5d6" });
      const created = await createWorkFromPr(first.deps, { repoId: DEMO_REPO.docsSite, number: 12 });
      await unlinkPr(first.deps, { repoId: DEMO_REPO.payments, number: 12, workId: "a1b2c3" });
      const worksBefore = (await first.deps.store.listWorks()).length;
      await first.close(); // 서버를 끈다

      const second = createContainer(env); // 서버를 다시 켠다 — 새 연결, 새 메모리
      await second.ensureSynced();
      expect(second.status().lastError).toBeNull();

      expect((await getWorkDetail(second.deps, "b4c5d6"))?.prs.map((p) => p.key)).toEqual([`${DEMO_REPO.coachWeb}#12`]);
      expect((await getWorkDetail(second.deps, created.id))?.prs.map((p) => p.key)).toEqual([`${DEMO_REPO.docsSite}#12`]);
      const unlinked = (await getInbox(second.deps)).groups.flatMap((g) => g.items).find((i) => i.pr.key === `${DEMO_REPO.payments}#12`);
      expect(unlinked?.reason).toBe("unlinked_by_user"); // 다시 켠 뒤의 동기화에서도 자동으로 붙지 않았다
      expect(await second.deps.store.listWorks()).toHaveLength(worksBefore); // 시연 업무가 두 번 심기지 않았다
      expect((await getWorkspace(second.deps)).projects).toHaveLength(5);
      await second.close();
    });
  });
});
