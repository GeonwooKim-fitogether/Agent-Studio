/**
 * 저장 계약 — PostgreSQL 저장소. TEST_DATABASE_URL 이 있을 때만 돈다(없으면 건너뛰었다고 출력한다).
 * 시험 전에 스키마를 지우고 적용 명령으로 처음부터 다시 만들며, 시험마다 데이터를 비운다.
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { createPostgresStore, seedIfEmpty } from "../../src/adapters/store/postgres/postgres-store";
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
});
