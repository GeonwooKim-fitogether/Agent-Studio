import Link from "next/link";
import { notFound } from "next/navigation";
import { getPreviewCards } from "../../../application/preview";
import { getWorkDetail } from "../../../application/queries";
import { getContainer } from "../../../server/container";
import { WORK_STATUS } from "../../components/labels";
import { unlinkAction } from "../../actions";
import { PrCard, StateLegend } from "../../components/pr-card";
import { PreviewControls } from "../../components/preview-controls";
import { ReviewControls } from "../../components/review-controls";

export const dynamic = "force-dynamic";

/** 업무 화면 — 그 업무에 연결된 PR 카드와, 사용자가 PR 에 넣을 업무 표식. */
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
  const container = getContainer();
  await container.ensureSynced();
  const detail = await getWorkDetail(container.deps, id);
  if (detail === undefined) notFound();
  const { work, project, marker, prs } = detail;
  const previews = await getPreviewCards(container.deps, container.preview, prs);

  return (
    <div className="page-inner">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Workspace</Link> / <span>{project.name}</span>
      </nav>
      <div className="page-head work-head">
        <h1>{work.title}</h1>
        <span className={`status status-${work.status}`}>{WORK_STATUS[work.status]}</span>
      </div>

      {refused && (
        <p className="source-error" data-testid="preview-refused">
          미리보기를 열지 않았다 — 화면이 오래됐을 수 있다. 아래 PR 카드의 이유를 확인한다.
        </p>
      )}

      {reviewRefused && (
        <p className="source-error" data-testid="review-refused">
          내부 검토 결정을 남기지 않았다 — 화면이 오래됐을 수 있다(그사이 PR 이 병합 · 닫히거나 연결이 풀렸을 수 있다). 아래 PR 카드를 확인한다.
        </p>
      )}

      <section className="marker-box">
        <p className="eyebrow">Work marker</p>
        <code data-testid="work-marker">{marker}</code>
        <p className="muted">
          PR 본문이나 브랜치 이름에 이 표식을 넣으면 다음 Sync 때 이 업무에 자동으로 연결된다. 표식 앞뒤는 띄어 쓴다(예: "studio-work-… 에서"). 조사를 붙여 쓰거나 다른 표식과 섞이면 Inbox 로 간다.
        </p>
      </section>

      <section className="project">
        <header className="section-header">
          <h2>Pull requests</h2>
          <small>{prs.length}개</small>
        </header>
        {prs.length === 0 ? (
          <p className="empty-note">아직 연결된 PR 이 없다. Inbox 에서 연결하거나 위 표식을 PR 에 넣는다.</p>
        ) : (
          <div className="pr-list">
            <StateLegend />
            {prs.map((pr) => (
              <PrCard
                key={pr.key}
                pr={pr}
                source={container.deps.reader.source}
                actions={
                  <>
                    {previews.get(pr.key) !== undefined && <PreviewControls view={previews.get(pr.key)!} pr={pr} workId={work.id} />}
                    <ReviewControls pr={pr} workId={work.id} />
                    {/* 오조작을 막는 확인 한 단계: 체크박스를 체크해야 제출된다. 자바스크립트 없이도 브라우저가 막는다(required). */}
                  <form action={unlinkAction} className="unlink-form" data-testid="unlink-form">
                    <input type="hidden" name="repoId" value={pr.repoId} />
                    <input type="hidden" name="number" value={pr.number} />
                    <input type="hidden" name="workId" value={work.id} />
                    <label>
                      <input type="checkbox" name="confirm" value="yes" required /> 이 PR 을 업무에서 떼어 Inbox 로 돌려보낸다
                      (표식이 있어도 다시 자동으로 붙지 않는다)
                    </label>
                    <button type="submit" className="btn">
                      Unlink
                    </button>
                  </form>
                  </>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
