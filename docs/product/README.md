# 제품 기획 자산 — 무엇을 만드는가

이 폴더는 Agent Studio 를 **왜, 누구를 위해, 어떤 모습으로** 만드는지를 정한 기획 자산의 정본이다. 개발을 시작하기 전에 확정된 것들이며, 코드는 이 자산을 따라간다. 파일마다 읽는 목적이 다르다.

| 파일 | 누가 읽나 | 무엇이 들어 있나 |
|---|---|---|
| [`ceo-brief.md`](./ceo-brief.md) | 의사결정자 | 해결할 문제, 사용자가 일하는 순서, 클라우드와 실제 서버가 이어지는 그림, 단계별 성공 기준. 비전공자용 5장 요약 |
| [`user-workflow-plan.html`](./user-workflow-plan.html) | 기획·개발자 | "누가 · 어디에서 · 무엇을 · 왜" 표, 매일의 흐름 7단계, 기존 화면의 버튼이 실제로 해야 할 동작, 개발 순서(0~3단계). 브라우저로 연다 |
| [`feature-plan.md`](./feature-plan.md) | 기획 · 디자인 · 개발 | 시안의 기능을 어느 단계에 만드는가(2 · 2.5 · 3단계), 기능마다 사용자 이야기 · 규칙 · 통과 기준, 화면 구조안, 업무 상태 규칙. 2026-09-28 확정(결정 13 · 14 · 15) |
| [`agent-studio-v3.html`](./agent-studio-v3.html) | 디자이너·개발자 | **시안 v3 — 화면 규격의 기준** (2026-09-28, 결정 19). "사실 하나는 한 자리에만": GitHub 상태를 늘 네 칸의 아이콘 줄 [PR 상태 · 검사 · 리뷰 · 미리보기] 로 보이고, 저장소 이름 · 커밋 번호 · 상태 낱말을 되풀이하지 않는다. 위쪽 토글로 Workspace · Work · Review, Desktop · Phone, 새 커밋이 와서 저장하지 않은 상태를 바꿔 본다. 구조(틀 · 목표 · Next action)는 아래 Focus 시안 그대로다. 이 파일에 함께 그려진 Flow · Agents 화면은 3단계의 예시이고 결정 19 의 범위가 아니다 |
| [`agent-studio-focus.html`](./agent-studio-focus.html) | 디자이너·개발자 | **구조의 기준** — Focus 시안 (2026-09-28, 결정 18). 왼쪽 사이드바, Workspace 의 Needs your attention · Other work · Up next, 업무 화면의 목표 · 대화 · 결과 카드 · Next action, Review 창, Connections 를 그린다. 시안 속 PR · 미리보기 · AI 모델 · Flow · Agents 는 실제 연결이 아닌 예시다 — 구현은 시안을 복제하지 않고 핵심 구조만 따른다(Flow · Agents · 모델 선택은 3단계 전이라 만들지 않았다). 파일 크기를 줄이려고 원본에 박힌 글꼴을 빼고 시스템 글꼴로 바꿨다(그림은 그대로다). 옛 시안은 [`archive/`](./archive/) 에 있다 — v2(결정 16, [`agent-studio-prototype-v2.html`](./archive/agent-studio-prototype-v2.html)), v1([`agent-studio-prototype-v1.html`](./archive/agent-studio-prototype-v1.html)) |

## 시안을 읽을 때 알아 둘 것

- 시안은 **시연용**이다. GitHub · 서버에 연결되지 않고, 버튼을 누르면 화면 상태만 바뀐다. 맨 위 "Design demo" 표시가 그 사실을 알린다.
- 시안 v3(결정 19)는 Focus 시안 위에서 화면의 규격만 바꿨다 — 칩 줄 대신 아이콘 줄, 저장소 이름 · 커밋 번호를 한 자리에만. 결정 19 가 결정 18 의 화면 규격을 갱신한다.
- Focus 시안은 결정 18 로 UX 기준이 됐다. 구현이 시안의 무엇을 따르고 무엇을 따르지 않았는지(Q1~Q13)는 결정 18 에 있다. 실제 앱의 색 토큰(`src/app/globals.css`)은 이 시안에서 가져왔다.
- 시안 v2(결정 16)는 Focus 시안으로 대체됐다. v2 의 다섯 기본값(Approve 뒤 진행 중, 병합 · 닫힌 PR 의 버튼 비활성 등)은 규칙으로 그대로 남아 있다.
- 옛 시안 v1 은 방향이 PR 중심으로 바뀌기 전의 모습(AI 팀이 문서를 쓰는 일반 업무 도구)이다. 참고용으로 `archive/` 에만 둔다.
- 버튼과 기능 이름은 영어, 사용자가 적는 내용은 한국어다(결정 2).

## 이 자산이 정하지 않은 것

기술 스택, 저장 방식, 배포 위치는 여기서 정하지 않았다. 그 결정은 [`../plan/`](../plan/) 의 개발 계획과 [`../../decisions.md`](../../decisions.md) 가 맡는다.
