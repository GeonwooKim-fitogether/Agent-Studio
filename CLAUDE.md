# Agent Studio — 이 저장소에서 일하는 세션이 먼저 읽는 것

> 한 줄 요지: **이 저장소는 Agent Studio 제품을 만드는 곳이다.** 제품이 무엇인지는 `docs/product/`, 무엇을 정했는지는 `decisions.md`, 지금 만들 것이 무엇인지는 `docs/plan/` 에 있다. 공용 규칙(`.claude/rules/`)은 자동으로 읽히므로 여기서 반복하지 않는다.

## 1. 이 제품이 무엇인가 — 세 문장

Agent Studio 는 여러 프로젝트를 Claude 클라우드 · 로컬 · 동료의 환경에서 병렬로 개발해도 **업무의 맥락과 코드의 현재 상태를 잃지 않게 하는 작업 공간**이다. 사용자는 Slack 같은 Chat 에서 업무를 이야기하고, Dify 같은 Flow 에서 Agent 와 Skill 을 배치하며, 코드의 실제 상태는 언제나 GitHub 의 PR 을 그대로 비춘다. 화면 확인이 필요할 때만 Mac Pro 가 선택한 PR 의 특정 커밋을 실행하고, 사용자는 휴대전화에서도 그 미리보기를 연다.

## 2. 어디에 무엇이 있나

| 무엇을 알고 싶나 | 어디를 보나 |
|---|---|
| 왜 만드는가, 사용자는 어떻게 일하는가 (비전공자용) | [`docs/product/ceo-brief.md`](docs/product/ceo-brief.md) |
| 누가 · 어디에서 · 무엇을 · 왜, 화면 버튼이 실제로 할 일, 개발 순서 | [`docs/product/user-workflow-plan.html`](docs/product/user-workflow-plan.html) |
| 화면의 모습 (클릭 시안, Demo mode) | [`docs/product/agent-studio-prototype.html`](docs/product/agent-studio-prototype.html) |
| 무엇을 하기로 정했나, 무엇이 아직 열려 있나 | [`decisions.md`](decisions.md) |
| 업무와 PR 이 이어지는 규칙 (0단계 계약) | [`docs/plan/00-domain-contract.md`](docs/plan/00-domain-contract.md) |
| 체계의 어색함을 발견했을 때 적는 곳 | [`docs/lessons.md`](docs/lessons.md) |

## 3. 어휘 — 화면과 코드가 같은 말을 쓴다

| 말 | 뜻 |
|---|---|
| **Project** | GitHub 저장소를 하나 이상 연결한 프로젝트 |
| **Work (업무)** | 목표 하나를 가진 작업 단위. 시안의 `flow`. 대화 · 흐름도 · PR 연결 · 내부 검토 결정이 여기에 모인다 |
| **Workspace** | 여러 업무의 현재 단계와 결정할 일을 보는 첫 화면 |
| **Chat** | 업무 하나의 대화. 채널 하나가 업무 하나다. 결과 메시지에는 PR 카드가 붙는다 |
| **Flow** | 업무 하나의 단계 흐름도. Agent · Skill · Review · Output 노드를 배치한다 |
| **Agents** | Agent 를 만들고 편집하는 화면. 소개(사람용) 와 지시문(AI 용 프롬프트) 를 구분한다 |
| **Inbox** | 승인 요청과, 어느 업무의 것인지 판단할 수 없는 PR 이 모이는 곳 |
| **PR Link / PR Snapshot** | 업무와 PR 의 연결(Studio 소유) / GitHub 가 준 PR 의 현재 상태(읽기 전용) |
| **Preview** | 특정 PR 의 특정 커밋을 Mac Pro 가 실행한 미리보기 |

버튼과 기능 이름은 영어, 사용자가 적는 내용은 한국어다(결정 2).

## 4. 지금 단계에서 지킬 것

1. **개발 순서를 지킨다.** 0 계약 정의 → 1 PR 모으기 → 2 원격 미리보기 → 3 AI 실행(결정 5). 3단계의 것(실제 Run, 모델 연결)을 앞 단계에 끌어오지 않는다.
2. **코드 상태를 Studio 가 만들지 않는다.** 브랜치 생성 · 병합 · 강제 푸시를 구현하지 않는다. GitHub 권한은 읽기 범위로 시작한다(결정 4).
3. **추측으로 PR 을 업무에 붙이지 않는다.** 확실할 때만 자동, 아니면 Inbox(계약 §4).
4. **실행되지 않는 버튼을 두지 않는다.** 실제로 동작하지 않는 기능은 화면에서 Demo 로 표시하거나 아예 두지 않는다(결정 7).
5. **착수 전에 `decisions.md` 를 주제어로 검색한다.** 파일 이름이 아니라 주제로 찾는다.
6. **기술 스택은 TypeScript 한 벌이다** (결정 8). 도메인 규칙(`src/domain/`)은 Next.js · GitHub · 데이터베이스를 import 하지 않는다. 바깥 세계와는 `src/ports/` 의 인터페이스로만 닿는다.

## 5. 이 저장소가 창고에서 물려받은 것

`.claude/` 아래의 스킬 · 규칙 · 에이전트 · 커맨드 · 훅은 창고(Template-repository) 가 원본이고 동기화 봇이 내려보낸다. **여기서 고치지 않는다**(`upstream-first.md`). `.github/workflows/` 와 이 `CLAUDE.md` 는 이 저장소가 소유한다. `README.md` 의 뒷부분에 창고에서 온 자산 목록이 남아 있는 이유는 상속받은 자동 검사(`readme-skills.yml` · `asset-graph.yml`)가 그 표를 대조하기 때문이다.

## 6. 보고할 때

진행 상태는 **작업완료 · 검토대기 · 배포완료** 세 단계로만 부르고, 화면에 보이는 작업은 "어디서 · 무엇을 하면 · 무엇이 보이나" 세 줄을 붙인다(`communication.md` 규칙 7). 요청받은 것과 작업 중 발견한 것은 같은 목록에 섞지 않는다.
