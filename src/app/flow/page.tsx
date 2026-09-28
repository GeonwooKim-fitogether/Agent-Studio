import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pickChatWork } from "../../application/queries";
import { getContainer } from "../../server/container";
import { DemoBand, FLOW_DEMO_TEXT } from "../components/demo";
import { Topbar } from "../components/topbar";
import { LAST_WORK_COOKIE } from "../last-work-cookie";

export const dynamic = "force-dynamic";

/**
 * 메뉴의 Flow (결정 20 — Demo). Flow 는 업무 하나의 흐름도이므로 Chat 과 같은 규칙으로 업무 하나를 연다 —
 * 마지막으로 연 업무가 아직 있으면 그 업무, 아니면 Workspace 의 첫 업무. 업무가 하나도 없으면 만드는 곳을 알린다.
 */
export default async function FlowMenuPage() {
  const container = getContainer();
  await container.ensureSynced();
  const remembered = (await cookies()).get(LAST_WORK_COOKIE)?.value ?? null;
  const workId = await pickChatWork(container.deps, remembered);
  if (workId !== null) redirect(`/works/${encodeURIComponent(workId)}/flow`);
  return (
    <>
      <Topbar crumbs={["Flow"]} />
      <DemoBand text={FLOW_DEMO_TEXT} />
      <div className="content">
        <div className="pageheading">
          <h1>Flow</h1>
        </div>
        <p className="empty-note" data-testid="flow-empty">
          Flow 는 업무 하나의 흐름도다. 아직 업무가 없어 열 흐름도가 없다 — <Link href="/">Workspace</Link> 의 New Work 로 업무를 만든다.
        </p>
      </div>
    </>
  );
}
