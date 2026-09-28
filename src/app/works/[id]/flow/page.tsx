import { notFound } from "next/navigation";
import { getFlow } from "../../../../application/flow";
import { getPreviewCards } from "../../../../application/preview";
import { getContainer } from "../../../../server/container";
import { DemoBand, FLOW_DEMO_TEXT } from "../../../components/demo";
import { FlowCanvas, FlowInspector, isFlowStep } from "../../../components/flow";
import { RememberWork } from "../../../components/remember-work";
import { Topbar } from "../../../components/topbar";
import { WorkHeader } from "../../../components/work-header";

export const dynamic = "force-dynamic";

/**
 * 업무 하나의 Flow (결정 20 — Demo). 읽기 전용 흐름도와 고른 단계의 설명 칸이다. 아무것도 실행하지 않는다 — Run 버튼이 없다(결정 2).
 *   ?node=goal|build|review|finish  설명 칸에 보일 단계. 없으면 지금 단계(모두 지났으면 Finish)
 * 휴대전화 폭에서는 설명 칸이 흐름도 아래로 간다. 마지막으로 연 업무로 기억되어, 메뉴의 Flow · Chat 이 이 업무를 다시 연다.
 */
export default async function WorkFlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const container = getContainer();
  await container.ensureSynced();
  const flow = await getFlow(container.deps, id);
  if (flow === undefined) notFound();
  const selected = isFlowStep(query["node"]) ? query["node"] : (flow.path.current ?? "finish");
  const previews = flow.buildPr === null ? new Map() : await getPreviewCards(container.deps, container.preview, [flow.buildPr]);
  return (
    <div className="flow-page" data-testid="flow">
      <RememberWork id={flow.work.id} />
      <Topbar
        crumbs={[
          <a key="p" href={`/?project=${encodeURIComponent(flow.project.id)}`}>
            {flow.project.name}
          </a>,
          <span key="m" className="mono">
            {flow.marker}
          </span>,
        ]}
      />
      <DemoBand text={FLOW_DEMO_TEXT} />
      <WorkHeader work={flow.work} project={flow.project} marker={flow.marker} view="flow" />
      <div className="flow-layout">
        <FlowCanvas flow={flow} selected={selected} preview={flow.buildPr === null ? undefined : previews.get(flow.buildPr.key)} />
        <FlowInspector flow={flow} selected={selected} />
      </div>
    </div>
  );
}
