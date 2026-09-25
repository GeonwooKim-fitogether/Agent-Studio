/**
 * PostgreSQL 시험 준비. 시험 전용 변수 TEST_DATABASE_URL 이 있을 때만 쓴다.
 *
 * 이 시험들은 스키마를 지우고 다시 만든다. 그래서 개발용 DATABASE_URL 은 쓰지 않고, 데이터베이스 이름에
 * "test" 가 들어 있지 않으면 거부한다 — 실수로 쓰던 데이터베이스를 지우지 않기 위해서다.
 */
import { execFileSync } from "node:child_process";
import pg from "pg";

export const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"]?.trim() ?? "";
export const HAS_POSTGRES = TEST_DATABASE_URL !== "";

export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.includes("test")) {
    throw new Error(`시험용 데이터베이스 이름에는 "test" 가 들어가야 한다 (지금: "${name}"). 스키마를 지우는 시험이라 거부한다.`);
  }
}

/** 스키마를 통째로 지우고, 적용 명령(npm run db:migrate 와 같은 스크립트)으로 처음부터 다시 만든다. 출력을 돌려준다. */
export async function recreateSchema(url: string): Promise<string> {
  assertTestDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("drop schema public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }
  return runMigrate(url, "test");
}

/** db/migrate.mjs 를 따로 된 프로세스로 돌린다. 실패하면 출력과 함께 던진다. */
export function runMigrate(url: string, appEnv: string): string {
  return execFileSync(process.execPath, ["db/migrate.mjs"], {
    env: { ...process.env, APP_ENV: appEnv, DATABASE_URL: url },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** 스키마는 두고 데이터만 비운다. 시험 하나하나가 빈 저장소에서 시작하도록. */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(
    "truncate project, work, repository, pr_snapshot, pr_link, pr_unlink, review_decision, preview_record restart identity cascade",
  );
}
