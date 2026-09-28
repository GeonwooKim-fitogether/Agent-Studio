import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { nextActionFor, primaryPrOf } from "../../../application/focus";
import { getPreviewCards } from "../../../application/preview";
import { getWorkChat } from "../../../application/queries";
import { decisionBlockOf } from "../../../application/review";
import { parseThreadKey } from "../../../domain/memo";
import { getContainer } from "../../../server/container";
import { Timeline } from "../../components/chat";
import { Icon } from "../../components/glyph";
import { GOAL_PROBLEM, kstDay, MEMO_PROBLEM, REVIEW_PROBLEMS, type ReviewProblem } from "../../components/labels";
import { MemoComposer } from "../../components/memo";
import { RememberWork } from "../../components/remember-work";
import { ReviewPanel } from "../../components/review-panel";
import { ThreadPanel } from "../../components/thread";
import { GoalCard, NextActionCard, reviewHref, WorkDetails } from "../../components/work";
import { StatusBadge } from "../../components/work-status";
import { parseReviewKey, readReviewDraft, REVIEW_DRAFT_COOKIE } from "../../review-draft";

export const dynamic = "force-dynamic";

/**
 * 업무 화면 (결정 18, Q6 · Q7 · Q8) — 목표 · 대화 · 연결된 PR 결과 · 다음 행동이 한 맥락에서 이어진다. 같은 주소가 그 업무의 Chat 이다(결정 13).
 *
 *   머리: 프로젝트 / 상태 배지 / 제목
 *   왼쪽: Goal(고정) → 타임라인(시스템 사건은 작은 한 줄, PR 결과는 최신 커밋 카드 하나, 이전 커밋 카드는 접힘) → 메모 입력칸
 *   오른쪽: Work details — 맨 위 Next action, 그 아래 속성 · 상태 · Link a PR
 *   휴대전화 폭: 한 열. 목표 바로 아래에 Next action 이 오고, 속성은 Details 로 접는다(?details=1)
 *
 * 오른쪽 칸을 바꾸는 것 둘 — 주소 파라미터로 같은 화면을 다시 그린다(자바스크립트 없이 동작한다). 휴대전화 폭에서는 화면 전체를 덮는다.
 *   ?review=<저장소 ID>:<PR 번호>  Review 패널 (본 커밋 · GitHub 상태 · 미리보기 · 결정 폼 · Link)
 *   ?thread=<스레드 이름>          스레드 칸 (F9)
 * 메모의 Edit 은 ?edit=<메모 ID>, 목표 고치기는 ?goal=edit 로 연다.
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
  const one = (name: string) => (typeof query[name] === "string" ? (query[name] as string) : null);
  const previewRefused = one("preview") === "refused";
  const statusRefused = one("status") === "refused";
  const memoParam = one("memo");
  const memoProblem = memoParam !== null && Object.hasOwn(MEMO_PROBLEM, memoParam) ? MEMO_PROBLEM[memoParam as keyof typeof MEMO_PROBLEM] : null;
  const replyParam = one("reply");
  const replyProblem = replyParam !== null && Object.hasOwn(MEMO_PROBLEM, replyParam) ? MEMO_PROBLEM[replyParam as keyof typeof MEMO_PROBLEM] : null;
  const goalParam = one("goalProblem");
  const goalProblem = goalParam !== null && Object.hasOwn(GOAL_PROBLEM, goalParam) ? GOAL_PROBLEM[goalParam as keyof typeof GOAL_PROBLEM] : null;
  const editingMemoId = one("edit");
  const wantedThread = one("thread") === null ? null : parseThreadKey(one("thread")!);
  const wantedReview = parseReviewKey(one("review"));
  const reviewProblemParam = one("problem");
  const reviewProblem = REVIEW_PROBLEMS.find((p) => p === reviewProblemParam) ?? null;

  const container = getContainer();
  await container.ensureSynced();
  const chat = await getWorkChat(container.deps, id, { now: container.deps.now().toISOString(), dayOf: kstDay, thread: wantedThread });
  if (chat === undefined) notFound();
  const { work, project, marker, prs } = chat;
  const previews = await getPreviewCards(container.deps, container.preview, prs);
  const running = container.preview.current();
  const hostOnline = container.preview.status().online;
  const action = nextActionFor(chat, running);
  const primary = primaryPrOf(chat, action);

  // Review 패널: 이 업무에 연결된 PR 일 때만 연다(연결이 풀린 PR 의 오래된 주소면 열지 않는다)
  const reviewPr = wantedReview === null ? undefined : prs.find((p) => p.repoId === wantedReview.repoId && p.number === wantedReview.number);
  const draftCookie = readReviewDraft((await cookies()).get(REVIEW_DRAFT_COOKIE)?.value);
  const draft =
    reviewPr !== undefined && reviewProblem !== null && draftCookie !== null && draftCookie.workId === work.id && draftCookie.key === `${reviewPr.repoId}:${reviewPr.number}`
      ? draftCookie
      : null;
  const panel = reviewPr !== undefined ? "review" : chat.thread !== null ? "thread" : null;
  const showDetails = one("details") === "1";

  return (
    <div className={["work-page", panel === null ? "" : `panel-open ${panel}-open`].filter(Boolean).join(" ")} data-testid="chat">
      <RememberWork id={work.id} />
      <header className="work-header">
        <p className="work-crumb">
          <a href={`/?project=${encodeURIComponent(project.id)}`}>{project.name}</a>
          <span aria-hidden="true">/</span>
          <span className="mono">{marker}</span>
        </p>
        <div className="work-head">
          <h1>{work.title}</h1>
          <StatusBadge status={work.status} />
        </div>
      </header>

      {(statusRefused || previewRefused) && (
        <div className="notice-bar">
          {statusRefused && (
            <p className="form-error" data-testid="status-refused">
              업무 상태를 바꾸지 않았다 — 화면이 오래됐을 수 있다(그사이 PR 이 바뀌어 더는 완료 후보가 아닐 수 있다). 지금 상태를 확인한다.
            </p>
          )}
          {previewRefused && (
            <p className="form-error" data-testid="preview-refused">
              미리보기를 열지 않았다 — 화면이 오래됐을 수 있다. Review 패널의 이유를 확인한다.
            </p>
          )}
        </div>
      )}

      <div className="work-grid">
        <div className="work-main">
          <GoalCard work={work} editing={one("goal") === "edit"} problem={goalProblem} />
          <section className="tl-col" aria-label="Timeline">
            <Timeline
              entries={chat.timeline}
              marker={marker}
              workId={work.id}
              editingMemoId={editingMemoId}
              previewFor={(pr) => previews.get(pr.key)}
              reviewHrefFor={(pr) => reviewHref(work.id, pr)}
            />
            {prs.length === 0 && (
              <p className="state-message tl-empty">
                <Icon name="clock" />
                아직 연결된 PR 이 없다.
              </p>
            )}
          </section>
          {/* 고치기에서 걸린 이유는 그 메모 옆이 아니라 여기 한 곳에 보인다 — 입력칸은 늘 타임라인 아래에 있다 */}
          <MemoComposer workId={work.id} problem={memoProblem} />
        </div>
        <div className="work-side">
          <NextActionCard action={action} work={work} marker={marker} previews={previews} hostOnline={hostOnline} />
          <WorkDetails summary={chat} projectName={project.name} primary={primary} previews={previews} open={showDetails} />
        </div>
        {reviewPr !== undefined && (
          <ReviewPanel
            work={work}
            pr={reviewPr}
            preview={previews.get(reviewPr.key)}
            hostOnline={hostOnline}
            block={decisionBlockOf({ ...reviewPr, state: reviewPr.github.state }, running)}
            problem={reviewProblem}
            draft={draft}
            source={container.deps.reader.source}
          />
        )}
        {reviewPr === undefined && chat.thread !== null && (
          <ThreadPanel thread={chat.thread} workId={work.id} editingMemoId={editingMemoId} problem={replyProblem} />
        )}
      </div>
    </div>
  );
}
