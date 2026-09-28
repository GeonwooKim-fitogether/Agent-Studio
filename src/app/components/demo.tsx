/**
 * Demo 표시 (결정 7 · 20). 실행 연결이 없는 메뉴 · 화면 · 칸에 점선 테두리의 `Demo` 를 붙여 "아직 진짜가 아니다" 를 알린다.
 * Flow 와 Agents 화면은 위에 띠 한 줄로, 무엇이 아직 연결되지 않았는지를 한 문장으로 말한다.
 */

export function DemoTag() {
  return (
    <span className="demo-tag" data-testid="demo-tag">
      Demo
    </span>
  );
}

export const FLOW_DEMO_TEXT = "Demo · 실행 연결 없음 — 흐름은 기록을 보여 줄 뿐 아무것도 실행하지 않는다";
export const AGENTS_DEMO_TEXT = "Demo · 실행 연결 없음 — 지시문은 저장만 되고 아직 AI 에게 가지 않는다";

/** 화면 위의 Demo 띠. 문구의 앞 "Demo · " 는 점선 표시가 대신 말한다 */
export function DemoBand({ text }: { text: string }) {
  return (
    <div className="demo-band" role="note" data-testid="demo-band">
      <DemoTag />
      <span>{text.replace(/^Demo · /, "")}</span>
    </div>
  );
}
