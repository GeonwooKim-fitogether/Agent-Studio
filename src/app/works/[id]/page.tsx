import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkDetail } from "../../../application/queries";
import { getContainer } from "../../../server/container";
import { WORK_STATUS } from "../../components/labels";
import { unlinkAction } from "../../actions";
import { PrCard, StateLegend } from "../../components/pr-card";

export const dynamic = "force-dynamic";

/** 업무 화면 — 그 업무에 연결된 PR 카드와, 사용자가 PR 에 넣을 업무 표식. */
export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const container = getContainer();
  await container.ensureSynced();
  const detail = await getWorkDetail(container.deps, id);
  if (detail === undefined) notFound();
  const { work, project, marker, prs } = detail;

  return (
    <div className="page-inner">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Workspace</Link> / <span>{project.name}</span>
      </nav>
      <div className="page-head work-head">
        <h1>{work.title}</h1>
        <span className={`status status-${work.status}`}>{WORK_STATUS[work.status]}</span>
      </div>

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
                  // 오조작을 막는 확인 한 단계: 체크박스를 체크해야 제출된다. 자바스크립트 없이도 브라우저가 막는다(required).
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
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
