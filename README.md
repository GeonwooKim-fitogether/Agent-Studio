# Agent Studio

여러 프로젝트를 Claude 클라우드 · 로컬 · 동료의 환경에서 병렬로 개발해도 **업무의 맥락과 코드의 현재 상태를 잃지 않게 하는 작업 공간**을 만드는 저장소입니다. 사용자는 Slack 처럼 대화하고 Dify 처럼 Agent 와 Skill 을 흐름도에 배치하며, 코드의 실제 상태는 언제나 GitHub 의 PR 을 그대로 비춥니다.

## 지금 상태

| 항목 | 상태 |
|---|---|
| 기획 | 확정. 문제 정의 · 사용자 흐름 · 화면 시안 · 개발 순서가 [`docs/product/`](docs/product/) 에 있습니다 |
| 0단계 계약 정의 | 문서로 정리됨. [`docs/plan/00-domain-contract.md`](docs/plan/00-domain-contract.md) |
| 기술 스택 | 미정. [`decisions.md`](decisions.md) 의 열린 결정 A |
| 코드 | 아직 없음 |

## 무엇을 먼저 만드나

개발 순서는 네 단계이며, 첫 제품의 성공 기준은 1 · 2단계입니다.

1. **계약 정의** — 업무 하나와 PR 하나가 이어지는 규칙. ([`docs/plan/00-domain-contract.md`](docs/plan/00-domain-contract.md))
2. **PR 모으기** — 저장소 5개 이상의 PR 을 읽어 업무에 표시하고, 연결이 모호한 PR 은 Inbox 에 둡니다.
3. **원격 미리보기** — PR 1건의 특정 커밋을 Mac Pro 가 실행하고, 휴대전화에서 접근 제한된 미리보기를 엽니다.
4. **Studio 에서 AI 실행** — 사용자가 직접 로그인한 공식 클라이언트(Claude Code · Codex 등)의 구독으로 Agent 를 실행합니다.

## 문서 지도

| 알고 싶은 것 | 문서 |
|---|---|
| 왜 만드는가, 사용자는 어떻게 일하는가 (비전공자용 요약) | [`docs/product/ceo-brief.md`](docs/product/ceo-brief.md) |
| 누가 · 어디에서 · 무엇을 · 왜, 버튼이 실제로 할 일, 개발 순서 | [`docs/product/user-workflow-plan.html`](docs/product/user-workflow-plan.html) |
| 화면 시안 (브라우저에서 클릭 가능, Demo mode) | [`docs/product/agent-studio-prototype.html`](docs/product/agent-studio-prototype.html) |
| 무엇을 정했고 무엇이 열려 있나 | [`decisions.md`](decisions.md) |
| 세션이 이 저장소에서 일할 때 지킬 것 | [`CLAUDE.md`](CLAUDE.md) |
| 체계의 어색함을 기록하는 곳 | [`docs/lessons.md`](docs/lessons.md) |

## 이 저장소가 창고에서 물려받은 것

이 저장소는 FITogether 의 공용 자산 창고([Template-repository](https://github.com/GeonwooKim-fitogether/Template-repository))를 템플릿으로 만들었습니다. `.claude/` 아래의 스킬 · 규칙 · 에이전트 · 커맨드 · 훅은 창고가 원본이고 동기화 봇(`.github/workflows/sync-skills.yml`)이 내려보내므로 **여기서 고치지 않습니다**. 아래 두 표는 상속받은 자동 검사(`readme-skills.yml` · `asset-graph.yml`)가 대조하는 목록이라 그대로 둡니다. 각 자산의 자세한 설명은 창고의 README 에 있습니다.

## 📚 포함된 스킬

| 스킬 | 무엇을 해주나요 |
|------|----------------|
| `agent-memory` | 세션 작업을 로컬에 저장하고 다음 세션에서 필요한 맥락만 복원 |
| `andrepathy` | AI의 흔한 코딩 실수 4가지를 막는 코딩 규칙 |
| `claude-video` | 영상을 빠르게 분석·요약·질의응답 (채팅, 파일 없음) |
| `claude-video-learning` | 영상을 **교육자료**로 — 영상별 폴더에 가로 PDF + 인터랙티브 HTML, 핵심 도식을 벡터(SVG)로 재구성 |
| `ceo-brief` | 의사결정자 보고의 형식 정본 — 5장 두괄식(장마다 결론 헤드라인 → 근거), 변화 보고에는 As-Is/To-Be 플로차트, 마지막 장은 결정 카드로 끝나는 자체완결 HTML 브리프. 메인 세션·kimpm·doc-clarifier·/orchestrate 가 총괄 대상 보고를 만들 때 이 규격을 따른다 |
| `design-taste-frontend` | 안티슬롭 프론트엔드 — 브리핑을 읽고 방향을 정해 '템플릿 티' 없는 랜딩·포트폴리오·리디자인을 생성 (커뮤니티 Taste 스킬) |
| `drbfm-qa` | 개정 전/후 스키매틱을 비교해 변경점을 도출하고 FITogether 표준 양식(개선 내용 정의 + As Is/To Be 회로도 + CheckList 11항목 자동 점검)의 DRBFM-QA HTML 생성 |
| `find-skill` | 목적에 맞는 스킬을 카탈로그에서 찾아줌 |
| `firmware-map` | 펌웨어/임베디드 C 코드베이스를 인터랙티브 HTML로 시각화 |
| `frontend-design` | 'AI 슬롭' 디자인을 막고 세련된 UI 결과물 유도 |
| `grill-me` | 코드 짜기 전 요구를 끝까지 캐물어 결정할 게 없어질 때까지 파고드는 취조 세션 진입점 (`grilling` 호출) |
| `grilling` | 계획·설계를 한 번에 하나씩 질문하며 물고 늘어져 공유된 이해에 도달 (grill-me의 실제 엔진) |
| `hardware-map` | 회로도(스키매틱) PDF를 기능 블록·버스 관계도 + 블록 상세 + 회로도·전 부품 역할표를 담은 인터랙티브 HTML로 생성 (DRBFM 회로 리뷰·비전문가 이해용) |
| `humanizer` | AI 문체를 제거하고 자연스러운 사람 말투로 재작성 |
| `integration-board` | 여러 팀의 일이 아직 하나의 제품으로 맞물리는지 한 장으로 보여 주는 통합 현황판 HTML 생성. 고정 엔진 + 프로젝트 config + 회차 data 구조라 **판이 매번 같고**, 판정·건수는 사람이 적는 게 아니라 엔진이 계산한다. 처음 쓴다면 [사용 안내서](.claude/skills/integration-board/USER-GUIDE.html)(보드를 만드는 법)를, 다 만들어진 보드를 앞에 두고 무엇을 결정할지 모르겠으면 [읽는 법](.claude/skills/integration-board/READING-GUIDE.html)(총괄용 3~5분 절차)을 브라우저로 열어 보라. **사실을 손으로 옮기지 않고 사건마다 자동으로 갱신·게시**할 수도 있다 — [자동 수집](.claude/skills/integration-board/reference/board-collect.md) 참고. |
| `ponytail` | 과잉 코드 억제 — "이미 있나 / 한 줄로 되나" 사다리로 가장 게으른(최소) 구현을 강제 |
| `progress-dashboard` | 프로젝트의 결정 로그·워크리스트·git을 읽어 Director 대시보드(스윔레인 보드)로 진행상황을 단일 HTML로 렌더. 내용은 프로젝트별 `dashboard.config.json`로 교체 |
| `qa-swarm` | 이해관계자 페르소나(L1·L2)를 subagent로 띄워 앱을 직접 써보게 하며 놓친 엣지·막힘·다자 마찰을 발견하는 QA 하네스 |
| `remotion` | React 기반 영상 제작의 타이밍·싱크 오류 교정 |
| `skill-creator` | 새 스킬을 코드·테스트·패키징까지 자동 생성 |
| `superpower` | 스펙→계획→테스트를 강제하는 시니어 개발 워크플로 |
| `understand` | 코드베이스 의존성 지식 그래프 생성 및 시각화 |
| `webapp-testing` | 로컬 웹앱을 Playwright로 구동·테스트·스크린샷·로그 확인 |
| `workflow-designer` | 업무·시스템 흐름을 점검해 시각화. 도메인 이름만 주면(예: PLM·EPTS) 질문·조사를 거쳐 비전문가용 다층 워크플로로 풀어 아티팩트로 보여줌 |

> 아래 스킬은 커뮤니티 오픈소스를 그대로 들여온(vendored) 것입니다(모두 MIT, 각 폴더에 원본 LICENSE 포함): `design-taste-frontend`([Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)), `ponytail`([DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)), `grill-me`·`grilling`([mattpocock/skills](https://github.com/mattpocock/skills)).

---

## 📏 공용 규칙

모든 프로젝트가 함께 지키는 규칙입니다. 세션 시작 시 자동으로 로드되므로, 아래 표의 규칙은 어느 저장소에서든 이미 적용돼 있습니다.

| 규칙 | 무엇을 정하나 |
|---|---|
| [`communication.md`](.claude/rules/communication.md) | **채팅·문서 어투** — 압축된 기호 나열 대신 완전한 문장으로, 결론을 먼저, 처음 보는 사람이 한 번에 이해하게 쓴다. 진행 상태를 부르는 세 단계 어휘(작업완료·검토대기·배포완료)와 완료 선언에 붙이는 노출 증명도 여기서 정한다. |
| [`migration-naming.md`](.claude/rules/migration-naming.md) | **마이그레이션 파일명** — 데이터베이스 구조를 바꾸는 새 SQL 파일의 이름은 순번(`0090_...`)이 아니라 만든 시각(`YYYYMMDDHHMMSS_...`)으로 짓는다. 여러 세션이 병렬로 작업할 때 같은 번호를 집어 가는 충돌을 **git 이 잡지 못하기 때문**이다. |
| [`db-write-permission.md`](.claude/rules/db-write-permission.md) | **데이터베이스 쓰기 승인** — 조회(`select`)는 확인 없이 실행하고, 데이터나 구조를 바꾸는 SQL 은 사용자가 그 쿼리를 보고 승인하기 전까지 실행하지 않는다. 부탁이 아니라 훅(`sql-write-guard.py`)이 실제로 막으며, 승인은 일회용 열쇠 파일로 표현된다. Supabase 에 연결된 저장소에 적용된다. |
| [`environment-separation.md`](.claude/rules/environment-separation.md) | **환경 분리** — local·development·staging·production의 역할과 쓰기 권한을 나누고, 운영 변경은 마이그레이션·백업/복구 계획·사람 승인이 모두 있을 때만 실행한다. 운영 자격증명과 실제 데이터의 비운영 반출도 금지한다. |
| [`upstream-first.md`](.claude/rules/upstream-first.md) | **공용 파일은 창고에서 고친다** — 고치기 전에 창고에 같은 경로의 파일이 있는지 확인하고, 있으면 그 저장소가 아니라 창고에서 고쳐 동기화로 내려보낸다. 아래에서 고치면 봇이 조용히 덮어쓰거나(동기화되는 파일) 저장소끼리 영구히 갈라진다(`.github/workflows/`). 이미 고쳐 버렸을 때의 역이식 절차도 여기서 정한다. |
| [`stake-calibration.md`](.claude/rules/stake-calibration.md) | **판돈 규칙** — 엔진의 크기를 일의 크기에 맞춘다. 기본값은 요구를 만족하는 최저 티어(T0 직접 처리 ~ T3 스웜 검증)이고, 티어 상향은 명시 트리거(비가역·파급·목록형 검증·사용자의 "철저히")가 있을 때만이다. 쉬운 일에 무거운 엔진을 켜는 과잉을 막는 정본. |
| [`escalation.md`](.claude/rules/escalation.md) | **에스컬레이션 규칙** — 언제 멈추고 언제 계속하나. 작은 결정은 기본값을 채택해 계속 진행하며 결정 큐에 1행만 남기고, 사람 관문 트리거(보안·라이브 DB·비가역 구조·범위 초과·비용·공개) 여섯에 해당하는 결정만 결정 카드 한 장으로 즉시 올린다. |
| [`past-decisions.md`](.claude/rules/past-decisions.md) | **지난 결정 규칙** — 무언가를 그만 쓰기로 정했으면 파일을 치우는 것으로 끝내지 않는다. 그것을 다시 만들어 내는 도구와 그것이 돌아올 자리를 저장소의 폐기 목록(`.claude/retired.json`)에 적고, 훅(`retired-guard.py`)이 그 둘을 실제로 차단한다. 착수 전에 결정 로그를 **파일 이름이 아니라 주제로** 한 번 검색하는 절차도 여기서 정한다. |
| [`branch-pr-naming.md`](.claude/rules/branch-pr-naming.md) | **브랜치·PR 이름** — 브랜치는 `<종류>/<영문-슬러그>`, PR 제목은 `<종류>: <한 문장>` 이고 요지가 앞 40자 안에 들어간다. 이름을 못 알아봐 머지된 브랜치 58개를 지우지도 못한 채 쌓아 둔 실측에서 나왔다. **세션은 브랜치를 스스로 만들지 않고** 이름을 먼저 보여 주고 승인을 받는 조항도 여기서 정한다. |
| [`lessons-backport.md`](.claude/rules/lessons-backport.md) | **교훈 백포트** — 작업 중 발견한 체계의 어색함을 그 저장소의 `docs/lessons.md`에 3줄로 기록하고, 수확 워크플로(`backport-harvest.js`)가 걷어 4분류 초안을 만들며, 사람의 승인을 거친 것만 창고에 반영한다. 사례 1건으로는 규칙을 만들지 않는다(N건 누적 후 격상). |

