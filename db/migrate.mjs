#!/usr/bin/env node
// 마이그레이션 적용 명령 — `npm run db:migrate`
//
// db/migrations/ 의 YYYYMMDDHHMMSS_이름.sql 파일을 이름 순서(= 만든 순서)로 적용한다.
//   - 적용 이력은 schema_migrations 표에 남기고, 이미 적용된 파일은 건너뛴다. 두 번 실행해도 두 번째는 아무것도 바꾸지 않는다.
//   - 파일 하나의 적용과 이력 기록은 한 트랜잭션이다. 중간에 실패하면 그 파일은 적용되지 않은 채로 남는다.
//   - 두 곳에서 동시에 실행해도 겹치지 않도록 데이터베이스 잠금(advisory lock)을 잡는다.
//
// 대상 환경은 local 과 test(CI 의 일회용 데이터베이스)뿐이다 (.claude/rules/environment-separation.md).
// APP_ENV 가 그 둘이 아니면 데이터베이스에 붙기 전에 거부한다.
// 연결 문자열 전체나 비밀번호는 출력하지 않는다. 출력은 호스트 · 포트 · 데이터베이스 이름뿐이다.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ALLOWED_ENVS = new Set(["local", "test"]);
const FILE_PATTERN = /^\d{14}_[a-z0-9_]+\.sql$/;
const LOCK_ID = 7_130_925; // 이 앱의 마이그레이션 잠금 번호 (임의의 고정값)
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function fail(message) {
  console.error(`db:migrate — ${message}`);
  process.exit(1);
}

/** 연결 대상을 비밀 없이 한 줄로. */
function describeTarget(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(해석할 수 없는 주소)";
  }
}

const appEnv = process.env.APP_ENV ?? "";
if (!ALLOWED_ENVS.has(appEnv)) {
  fail(`APP_ENV 가 "${appEnv}" 이다. 이 명령은 APP_ENV 가 local 또는 test 일 때만 실행한다. 아무것도 적용하지 않았다.`);
}
const url = process.env.DATABASE_URL ?? "";
if (url === "") fail("DATABASE_URL 이 비어 있다. 아무것도 적용하지 않았다.");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const badNames = files.filter((name) => !FILE_PATTERN.test(name));
if (badNames.length > 0) fail(`파일 이름이 YYYYMMDDHHMMSS_이름.sql 형식이 아니다: ${badNames.join(", ")}`);

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
} catch (error) {
  fail(`데이터베이스에 연결하지 못했다 (${describeTarget(url)}): ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
}

let applied = 0;
try {
  await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
  await client.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
  console.log(`db:migrate — 대상 ${describeTarget(url)} (APP_ENV=${appEnv}), 파일 ${files.length}개, 이미 적용 ${done.size}개`);

  for (const name of files) {
    const version = name.replace(/\.sql$/, "");
    if (done.has(version)) {
      console.log(`  건너뜀 (이미 적용됨) ${name}`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [version]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`${name} 적용에 실패해 되돌렸다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    }
    applied += 1;
    console.log(`  적용함 ${name}`);
  }
  console.log(`db:migrate — 새로 적용 ${applied}개`);
} catch (error) {
  console.error(`db:migrate — ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
