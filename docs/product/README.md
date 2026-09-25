# 제품 기획 자산 — 무엇을 만드는가

이 폴더는 Agent Studio 를 **왜, 누구를 위해, 어떤 모습으로** 만드는지를 정한 기획 자산의 정본이다. 개발을 시작하기 전에 확정된 것들이며, 코드는 이 자산을 따라간다. 세 파일은 읽는 목적이 다르다.

| 파일 | 누가 읽나 | 무엇이 들어 있나 |
|---|---|---|
| [`ceo-brief.md`](./ceo-brief.md) | 의사결정자 | 해결할 문제, 사용자가 일하는 순서, 클라우드와 실제 서버가 이어지는 그림, 단계별 성공 기준. 비전공자용 5장 요약 |
| [`user-workflow-plan.html`](./user-workflow-plan.html) | 기획·개발자 | "누가 · 어디에서 · 무엇을 · 왜" 표, 매일의 흐름 7단계, 기존 화면의 버튼이 실제로 해야 할 동작, 개발 순서(0~3단계). 브라우저로 연다 |
| [`agent-studio-prototype.html`](./agent-studio-prototype.html) | 디자이너·개발자 | 클릭 시안. Workspace · Chat · Flow · Agents 네 화면과 Inbox. 브라우저에서 열면 동작하며, 입력은 그 브라우저의 로컬 저장소에만 남는다 |

## 시안을 읽을 때 알아 둘 것

- 시안은 **Demo mode** 다. Claude · GitHub · 서버에 연결되지 않고, 버튼을 눌러도 실제 작업은 일어나지 않는다. 상단 "Demo mode" 표시가 그 사실을 화면에서 알린다.
- 시안의 데이터 단위는 `flow`(업무 하나) 다. 업무 하나에 채널(Chat)과 흐름도(Flow)가 함께 붙는다. 개발에서는 이 단위를 **업무(Work)** 라 부르고, 정확한 정의는 [`../plan/00-domain-contract.md`](../plan/00-domain-contract.md) 에 있다.
- 이 저장소에 반입된 시안 판본은 Agents 화면에 **이름 · Role · 스킬**만 있다. 기획 대화의 마지막 단계에서 정한 **소개(What it does) · 지시문(Instructions, AI 에 전달할 프롬프트) · AI model** 세 칸으로 나눈 판본은 아직 반입되지 않았다. 그 결정 자체는 [`../../decisions.md`](../../decisions.md) 결정 7 에 적혀 있으므로, 구현은 결정을 따르고 시안은 참고로만 본다.
- 버튼과 기능 이름은 영어(Workspace · Chat · Flow · Agents · Inbox · New Flow · Review · Approve · Request Changes), 사용자가 적는 내용은 한국어다. 이 원칙은 결정 2 다.

## 이 자산이 정하지 않은 것

기술 스택, 저장 방식, 배포 위치는 여기서 정하지 않았다. 그 결정은 [`../plan/`](../plan/) 의 개발 계획과 [`../../decisions.md`](../../decisions.md) 가 맡는다.
