/**
 * 단위 시험 전체를 시작하기 전에 한 번 돈다. PostgreSQL 시험을 건너뛰면 그 사실을 눈에 띄게 알린다 —
 * 건너뛴 시험이 통과한 것처럼 보이지 않게 하기 위해서다.
 */
export default function setup(): void {
  const url = process.env["TEST_DATABASE_URL"]?.trim() ?? "";
  if (url === "") {
    console.warn(
      "\n[건너뜀] PostgreSQL 시험(저장 계약 postgres · 마이그레이션 · 재시작 유지)을 돌리지 않는다 — TEST_DATABASE_URL 이 없다.\n" +
        "         돌리려면 이름에 test 가 들어간 빈 데이터베이스를 TEST_DATABASE_URL 로 지정한다.\n",
    );
  } else {
    console.log("\n[PostgreSQL] TEST_DATABASE_URL 이 있어 PostgreSQL 시험을 함께 돌린다.\n");
  }
}
