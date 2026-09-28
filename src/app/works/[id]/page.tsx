import { notFound } from "next/navigation";
import { getPreviewCards } from "../../../application/preview";
import { getWorkChat, type PrCardView } from "../../../application/queries";
import { getContainer } from "../../../server/container";
import { unlinkAction } from "../../actions";
import { Channels, Timeline } from "../../components/chat";
import { CopyButton } from "../../components/copy-button";
import { kstDay, MEMO_PROBLEM } from "../../components/labels";
import { MemoComposer } from "../../components/memo";
import { StateLegend } from "../../components/pr-card";
import { PreviewControls } from "../../components/preview-controls";
import { RememberWork } from "../../components/remember-work";
import { ReviewControls } from "../../components/review-controls";
import { StatusBadge, WorkStatusPanel } from "../../components/work-status";

export const dynamic = "force-dynamic";

/**
 * 업무 화면 = 업무 Chat (feature-plan F7, 결정 13: 2.5단계부터 같은 주소에서 Chat 배치가 된다).
 * 왼쪽에 채널 목록(프로젝트 > 업무), 가운데 머리(제목 · 상태 · 표식 Copy · 상태 칸)와 시간순 타임라인.
 * PR 카드는 타임라인 속에 커밋마다 쌓이고, 버튼은 최신 카드에만 있다.
 *
 * 휴대전화 폭에서는 채널 목록과 타임라인 중 하나만 보인다. `‹ Channels` 는 ?channels=1 로 같은 화면을 다시 그려
 * 채널 목록을 연다 — 자바스크립트 없이도 동작한다.
 * 타임라인 아래에 메모 입력칸(F8)이 있다. 메모의 Edit 은 ?edit=<메모 ID> 로 같은 화면을 다시 그려 고치기 칸을 연다(자바스크립트 없이도 동작한다).
 * 스레드(F9)는 다음 단위다. 동작하지 않는 칸을 미리 두지 않는다(결정 7).
 */
export default async function WorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const refused = query["preview"] === "refused";
  const reviewRefused = query["review"] === "refused";
  const statusRefused = query["status"] === "refused";
  const showChannels = query["channels"] === "1";
  const memoProblem = typeof query["memo"] === "string" && Object.hasOwn(MEMO_PROBLEM, query["memo"]) ? MEMO_PROBLEM[query["memo"] as keyof typeof MEMO_PROBLEM] : null;
  const editingMemoId = typeof query["edit"] === "string" ? query["edit"] : null;
  const container = getContainer();
  await container.ensureSynced();
  const chat = await getWorkChat(container.deps, id, { now: container.deps.now().toISOString(), dayOf: kstDay });
  if (chat === undefined) notFound();
  const { work, project, marker, prs } = chat;
  const previews = await getPreviewCards(container.deps, container.preview, prs);
  const source = container.deps.reader.source;
  const workPath = `/works/${encodeURIComponent(work.id)}`;

  const actionsFor = (pr: PrCardView) => (
    <>
      {previews.get(pr.key) !== undefined && <PreviewControls view={previews.get(pr.key)!} pr={pr} workId={work.id} />}
      <ReviewControls pr={pr} workId={work.id} />
      {/* 오조작을 막는 확인 한 단계: 체크박스를 체크해야 제출된다. 자바스크립트 없이도 브라우저가 막는다(required). */}
      <form action={unlinkAction} className="unlink-form" data-testid="unlink-form">
        <input type="hidden" name="repoId" value={pr.repoId} />
        <input type="hidden" name="number" value={pr.number} />
        <input type="hidden" name="workId" value={work.id} />
        <label>
          <input type="checkbox" name="confirm" value="yes" required /> 이 PR 을 업무에서 떼어 Inbox 로 돌려보낸다 (표식이 있어도 다시 자동으로 붙지
          않는다)
        </label>
        <button type="submit" className="btn">
          Unlink
        </button>
      </form>
    </>
  );

  return (
    <div className={showChannels ? "chat show-channels" : "chat"} data-testid="chat">
      <RememberWork id={work.id} />
      <Channels groups={chat.channels} currentId={work.id} />
      <section className="tl-col" aria-label="Timeline">
        <header className="tl-head">
          <div className="work-head">
            <a className="btn tiny back" href={`${workPath}?channels=1`} data-testid="show-channels">
              ‹ Channels
            </a>
            <h1>{work.title}</h1>
            <StatusBadge status={work.status} />
          </div>
          <div className="marker">
            <code id="work-marker" data-testid="work-marker">
              {marker}
            </code>
            <CopyButton text={marker} targetId="work-marker" />
            <span className="why marker-why">
              {project.name} · PR 본문이나 브랜치 이름에 이 표식을 넣으면 다음 Sync 때 이 업무에 자동으로 연결된다. 표식 앞뒤는 띄어 쓴다.
            </span>
          </div>
          <WorkStatusPanel summary={chat} />

          {statusRefused && (
            <p className="source-error" data-testid="status-refused">
              업무 상태를 바꾸지 않았다 — 화면이 오래됐을 수 있다(그사이 PR 이 바뀌어 더는 완료 후보가 아닐 수 있다). 지금 상태를 확인한다.
            </p>
          )}
          {refused && (
            <p className="source-error" data-testid="preview-refused">
              미리보기를 열지 않았다 — 화면이 오래됐을 수 있다. 아래 최신 카드의 이유를 확인한다.
            </p>
          )}
          {reviewRefused && (
            <p className="source-error" data-testid="review-refused">
              내부 검토 결정을 남기지 않았다 — 화면이 오래됐을 수 있다(그사이 PR 이 병합 · 닫히거나 연결이 풀렸을 수 있다). 아래 최신 카드를 확인한다.
            </p>
          )}
          {prs.length > 0 && <StateLegend />}
        </header>

        <Timeline entries={chat.timeline} marker={marker} source={source} actionsFor={actionsFor} workId={work.id} editingMemoId={editingMemoId} />
        {prs.length === 0 && <p className="empty-note tl-empty">아직 연결된 PR 이 없다. Inbox 에서 연결하거나 위 표식을 PR 에 넣는다.</p>}
        {/* 고치기에서 걸린 이유는 그 메모 옆이 아니라 여기 한 곳에 보인다 — 입력칸은 늘 화면 아래에 있다 */}
        <MemoComposer workId={work.id} problem={memoProblem} />
      </section>
    </div>
  );
}
