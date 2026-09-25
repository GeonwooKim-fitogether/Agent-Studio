#!/usr/bin/env node
// PostgreSQL 모드 e2e 를 시작하기 전에 시험용 데이터베이스 두 개를 빈 상태로 만든다.
//   - TEST_DATABASE_URL            : 주 시험 서버(3100)가 쓴다
//   - 같은 서버의 <이름>_restart   : 재시작 시험이 자기 서버(3101)를 껐다 켜며 쓴다
// 스키마를 지우므로 데이터베이스 이름에 test 가 없으면 거부한다. 스키마는 적용 명령(db/migrate.mjs)으로 만든다.
import { execFileSync } from "node:child_process";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL ?? "";
if (url === "") throw new Error("TEST_DATABASE_URL 이 없다");

function restartUrl(base) {
  const u = new URL(base);
  u.pathname = `${u.pathname}_restart`;
  return u.href;
}

async function reset(target, { create }) {
  const name = new URL(target).pathname.replace(/^\//, "");
  if (!name.includes("test")) throw new Error(`시험용 데이터베이스 이름에 test 가 없다: ${name}`);
  if (create) {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const exists = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount === 0) await admin.query(`create database "${name.replace(/"/g, "")}"`);
    await admin.end();
  }
  const client = new pg.Client({ connectionString: target });
  await client.connect();
  await client.query("drop schema public cascade");
  await client.query("create schema public");
  await client.end();
  execFileSync(process.execPath, ["db/migrate.mjs"], { env: { ...process.env, APP_ENV: "test", DATABASE_URL: target }, stdio: "inherit" });
}

await reset(url, { create: false });
await reset(restartUrl(url), { create: true });
