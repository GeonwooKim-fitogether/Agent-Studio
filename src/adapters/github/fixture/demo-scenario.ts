/**
 * 시연용 고정 데이터 — 계약의 확인 시나리오를 화면에서도 볼 수 있게 짠 것이다.
 * 저장소 이름과 PR 내용은 모두 지어낸 것이다(`demo-org/...` 는 실재하지 않는다).
 *
 * 무엇이 어디로 가야 하나 (첫 동기화 직후):
 *
 *   프로젝트        저장소                 PR   브랜치                         표식                          결과
 *   결제 서비스      demo-org/payments      #12  feat/login-page               본문 studio-work-a1b2c3        자동 연결 → 로그인 화면 만들기
 *                                          #15  fix/studio-work-a1b2c3-session 브랜치 이름에 같은 표식      자동 연결 → 로그인 화면 만들기
 *                                          #18  patch-1 (복제본 990001 의 브랜치) 본문 studio-work-a1b2c3   Inbox (복제본, 결정 10)
 *   코치 대시보드    demo-org/coach-web     #12  feat/login-page               없음                         Inbox (표식 없음)
 *                                          #7   exp/old-login (닫힘)          없음                         Inbox 목록에 없음, 개수로만 (결정 11)
 *   선수 앱          demo-org/player-app    #12  feat/login-page               결제 서비스 업무의 표식       Inbox (다른 프로젝트)
 *                                          #9   chore/deps-bump               없는 업무 studio-work-zz9999  Inbox (없는 업무)
 *   사내 관리 도구   demo-org/admin-console #12  feat/login-page               본문 studio-work-d0e1f2        자동 연결 → 관리자 로그인 보안 점검
 *   문서 사이트      demo-org/docs-site     #12  feat/login-page               서로 다른 표식 둘              Inbox (표식 둘)
 *
 * 다섯 저장소 모두 같은 브랜치 이름(feat/login-page)과 같은 PR 번호(#12)를 갖는다.
 * 그래도 PR 은 (저장소 숫자 ID, 번호) 로만 같으므로 서로 섞이지 않아야 한다 (시나리오 1).
 *
 * 내부 검토 결정 두 건:
 *   - 로그인 화면 만들기: payments#12 의 이전 커밋(9f8e7d6)에 대한 "수정 요청" → 지금은 새 커밋이 있어 "이전 버전" (시나리오 4)
 *   - 관리자 로그인 보안 점검: admin-console#12 의 최신 커밋에 대한 "내부 검토 완료" → GitHub 는 여전히 Open (시나리오 5)
 */
import type { PrSnapshot, Repository } from "../../../domain/model";
import type { StudioSeed } from "../../store/memory/memory-store";
import type { FixtureData } from "./fixture-reader";

export const DEMO_REPO = {
  payments: 710001,
  coachWeb: 710002,
  playerApp: 710003,
  adminConsole: 710004,
  docsSite: 710005,
} as const;

/** 결제 서비스 저장소의 복제본(fork). 팀 밖 사람의 저장소라 어느 프로젝트에도 속하지 않는다. */
export const DEMO_FORK_REPO = 990001;

export const DEMO_SHA = {
  payments12Head: "3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
  payments12Reviewed: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
  admin12Head: "5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f",
} as const;

const repositories: Repository[] = [
  { id: DEMO_REPO.payments, fullName: "demo-org/payments" },
  { id: DEMO_REPO.coachWeb, fullName: "demo-org/coach-web" },
  { id: DEMO_REPO.playerApp, fullName: "demo-org/player-app" },
  { id: DEMO_REPO.adminConsole, fullName: "demo-org/admin-console" },
  { id: DEMO_REPO.docsSite, fullName: "demo-org/docs-site" },
];

/** 시연 PR. 따로 적지 않으면 브랜치는 그 저장소 자신에 있다(headRepoId = repoId). */
function pr(
  fields: Omit<PrSnapshot, "url" | "updatedAt" | "headRepoId"> & Partial<Pick<PrSnapshot, "updatedAt" | "headRepoId">>,
): PrSnapshot {
  const repo = repositories.find((r) => r.id === fields.repoId);
  return {
    url: `https://github.com/${repo?.fullName ?? "demo-org/unknown"}/pull/${fields.number}`,
    updatedAt: "2026-09-24T09:00:00.000Z",
    headRepoId: fields.repoId,
    ...fields,
  };
}

const pullRequests: PrSnapshot[] = [
  pr({
    repoId: DEMO_REPO.payments,
    number: 12,
    title: "로그인 화면 추가",
    body: "업무 표식: studio-work-a1b2c3\n\n로그인 화면과 입력 검증을 넣었다.",
    branch: "feat/login-page",
    headSha: DEMO_SHA.payments12Head,
    author: "claude-cloud",
    state: "open",
    checks: "failing",
    review: "changes_requested",
  }),
  pr({
    repoId: DEMO_REPO.payments,
    number: 15,
    title: "세션 만료 처리",
    body: "",
    branch: "fix/studio-work-a1b2c3-session",
    headSha: "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b",
    author: "local-dev",
    state: "merged",
    checks: "passing",
    review: "approved",
  }),
  pr({
    // 복제본(fork)에서 온 PR — 같은 프로젝트 업무의 표식이 있지만 브랜치가 다른 저장소(990001)에 있다 (결정 10)
    repoId: DEMO_REPO.payments,
    number: 18,
    title: "외부 기여: 로그인 오류 문구 다듬기",
    body: "studio-work-a1b2c3 의 문구를 고쳤습니다.",
    branch: "patch-1",
    headRepoId: DEMO_FORK_REPO,
    headSha: "8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c",
    author: "outside-contributor",
    state: "open",
    checks: "pending",
    review: "none",
  }),
  pr({
    // 연결 안 된 채 닫힌 PR — Inbox 목록에는 없고 "닫히거나 병합된 연결 안 된 PR 1개" 로만 보인다 (결정 11)
    repoId: DEMO_REPO.coachWeb,
    number: 7,
    title: "예전 로그인 실험",
    body: "쓰지 않기로 한 실험이다.",
    branch: "exp/old-login",
    headSha: "9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
    author: "teammate",
    state: "closed",
    checks: "none",
    review: "none",
  }),
  pr({
    repoId: DEMO_REPO.coachWeb,
    number: 12,
    title: "코치 로그인 폼 교체",
    body: "로그인 폼을 새 디자인으로 바꾼다.",
    branch: "feat/login-page",
    headSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    author: "teammate",
    state: "open",
    checks: "pending",
    review: "none",
  }),
  pr({
    repoId: DEMO_REPO.playerApp,
    number: 12,
    title: "로그인 화면 문구 수정",
    body: "결제 서비스의 studio-work-a1b2c3 에서 쓰던 문구를 가져왔다.",
    branch: "feat/login-page",
    headSha: "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
    author: "claude-cloud",
    state: "open",
    checks: "passing",
    review: "none",
  }),
  pr({
    repoId: DEMO_REPO.playerApp,
    number: 9,
    title: "의존성 올리기",
    body: "studio-work-zz9999",
    branch: "chore/deps-bump",
    headSha: "4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e",
    author: "claude-cloud",
    state: "open",
    checks: "passing",
    review: "none",
  }),
  pr({
    repoId: DEMO_REPO.adminConsole,
    number: 12,
    title: "관리자 로그인 2단계 인증",
    body: "studio-work-d0e1f2",
    branch: "feat/login-page",
    headSha: DEMO_SHA.admin12Head,
    author: "local-dev",
    state: "open",
    checks: "passing",
    review: "approved",
  }),
  pr({
    repoId: DEMO_REPO.docsSite,
    number: 12,
    title: "로그인 안내 문서",
    body: "studio-work-a1b2c3 과 studio-work-d0e1f2 둘 다에 걸친 안내다.",
    branch: "feat/login-page",
    headSha: "6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a",
    author: "teammate",
    state: "open",
    checks: "none",
    review: "none",
  }),
];

/** GitHub 쪽 고정 데이터. 부를 때마다 새 사본을 준다 — 테스트가 고쳐도 다른 테스트에 번지지 않는다. */
export function demoFixtureData(): FixtureData {
  return structuredClone({ repositories, pullRequests });
}

/** Studio 쪽 처음 상태. 연결(PrLink)은 넣지 않는다 — 첫 동기화가 표식 규칙으로 만든다. */
export function demoStudioSeed(): StudioSeed {
  return structuredClone({
    projects: [
      { id: "payments", name: "결제 서비스", repoIds: [DEMO_REPO.payments] },
      { id: "coach", name: "코치 대시보드", repoIds: [DEMO_REPO.coachWeb] },
      { id: "player", name: "선수 앱", repoIds: [DEMO_REPO.playerApp] },
      { id: "admin", name: "사내 관리 도구", repoIds: [DEMO_REPO.adminConsole] },
      { id: "docs", name: "문서 사이트", repoIds: [DEMO_REPO.docsSite] },
    ],
    works: [
      { id: "a1b2c3", projectId: "payments", title: "로그인 화면 만들기", status: "in_progress", createdAt: "2026-09-20T01:00:00.000Z" },
      { id: "b4c5d6", projectId: "coach", title: "코치 로그인 개편", status: "draft", createdAt: "2026-09-21T01:00:00.000Z" },
      { id: "c7d8e9", projectId: "player", title: "선수 앱 온보딩 정리", status: "draft", createdAt: "2026-09-21T02:00:00.000Z" },
      { id: "d0e1f2", projectId: "admin", title: "관리자 로그인 보안 점검", status: "in_progress", createdAt: "2026-09-22T01:00:00.000Z" },
    ],
    reviews: [
      {
        id: "rev-demo-1",
        workId: "a1b2c3",
        repoId: DEMO_REPO.payments,
        number: 12,
        commitSha: DEMO_SHA.payments12Reviewed,
        verdict: "changes_requested",
        decidedAt: "2026-09-23T05:00:00.000Z",
      },
      {
        id: "rev-demo-2",
        workId: "d0e1f2",
        repoId: DEMO_REPO.adminConsole,
        number: 12,
        commitSha: DEMO_SHA.admin12Head,
        verdict: "internal_review_done",
        decidedAt: "2026-09-24T10:00:00.000Z",
      },
    ],
  } satisfies StudioSeed);
}
