import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pickChatWork } from "../../application/queries";
import { getContainer } from "../../server/container";
import { LAST_WORK_COOKIE } from "../last-work-cookie";

export const dynamic = "force-dynamic";

/**
 * 위쪽 메뉴의 Chat (feature-plan §3-1: 2.5단계에 나타난다). 채널 하나가 업무 하나이므로 업무의 Chat 을 연다 —
 * 마지막으로 연 업무가 아직 있으면 그 업무, 아니면 Workspace 의 첫 업무. 업무가 하나도 없으면 만드는 곳을 알린다.
 */
export default async function ChatPage() {
  const container = getContainer();
  await container.ensureSynced();
  const remembered = (await cookies()).get(LAST_WORK_COOKIE)?.value ?? null;
  const workId = await pickChatWork(container.deps, remembered);
  if (workId !== null) redirect(`/works/${encodeURIComponent(workId)}`);
  return (
    <div className="content">
      <div className="pageheading">
        <h1>Chat</h1>
      </div>
      <p className="empty-note" data-testid="chat-empty">
        채널 하나가 업무 하나다. 아직 업무가 없어 열 채널이 없다 — <Link href="/">Workspace</Link> 의 New Work 로 업무를 만든다.
      </p>
    </div>
  );
}
