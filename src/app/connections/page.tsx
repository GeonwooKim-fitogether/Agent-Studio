import { getPreviewDevice } from "../../application/preview";
import { getWorkspace } from "../../application/queries";
import { getContainer } from "../../server/container";
import { Icon } from "../components/glyph";
import { formatAgo, formatKst, PREVIEW_PHASE } from "../components/labels";
import { SourceStatusList } from "../components/source-status";
import { Topbar } from "../components/topbar";

export const dynamic = "force-dynamic";

const SOURCE_LABEL = {
  fixture: "Fixture data",
  github: "GitHub token (read-only)",
  github_app: "GitHub App (read-only)",
  github_combined: "GitHub App + token (read-only)",
} as const;

/** 주기 동기화 간격을 짧게 (예: 300 → "5 min", 90 → "90 s") */
function autoSyncLabel(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

/**
 * Connections (결정 18, Q2 · Q3) — 기술 정보는 여기 한 곳에 모은다. 다른 화면에는 한 줄 요약과 실패 경고만 있다.
 *   GitHub: 출처(App · 토큰 · 고정 데이터) · 읽는 저장소 · 마지막 Sync · 자동 Sync · 출처별 결과 · 읽기 범위의 한계
 *   Storage: 저장 방식(메모리 · PostgreSQL)
 *   Preview host: 미리보기 기기의 연결 상태와 지금 돌고 있는 미리보기
 *   AI models: Not connected — 3단계 첫 단위(실행 경로 시험) 전에는 모델 선택 · Flow · Agents 를 열지 않는다(결정 7 · 13)
 */
export default async function ConnectionsPage() {
  const container = getContainer();
  await container.ensureSynced();
  const { reader } = container.deps;
  const status = container.status();
  const [device, view] = await Promise.all([getPreviewDevice(container.deps, container.preview), getWorkspace(container.deps)]);
  const repositories = view.projects.flatMap((p) => p.repositories);
  const fixture = reader.source === "fixture";

  return (
    <>
      <Topbar crumbs={["Connections"]} />
      <div className="content">
        <div className="pageheading">
          <div>
            <h1>Connections</h1>
            <p>Studio 가 무엇에 연결돼 있고 무엇이 아직 연결되지 않았는지 본다. GitHub 에는 읽기만 한다.</p>
          </div>
        </div>

        <div className="connections-grid">
          <section className="connection-card" aria-labelledby="c-github" data-testid="data-source">
            <Icon name={fixture ? "database" : "github"} />
            <h2 id="c-github">GitHub</h2>
            <p className="muted">
              {fixture ? "고정 데이터로 동작한다. 실제 GitHub 는 읽지 않는다." : `GitHub 에서 읽기만 한다. ${reader.limitNote ?? ""}`}
            </p>
            <p className="card-state">
              <span className={fixture ? "pill" : "pill blue"} data-testid="source-kind">
                {SOURCE_LABEL[reader.source]}
                {container.configError !== null && " · 설정 오류"}
              </span>
            </p>
            <dl className="properties">
              <div className="property">
                <dt>Last sync</dt>
                <dd>
                  {status.lastSyncedAt === null ? (
                    "없음"
                  ) : (
                    <>
                      <time dateTime={status.lastSyncedAt} data-testid="last-sync">
                        {formatKst(status.lastSyncedAt)}
                      </time>{" "}
                      <span data-testid="last-sync-ago">({formatAgo(status.lastSyncedAt, Date.now())})</span>
                    </>
                  )}
                </dd>
              </div>
              <div className="property">
                <dt>Auto sync</dt>
                <dd data-testid="auto-sync">
                  {container.syncIntervalSeconds > 0 ? `Auto sync every ${autoSyncLabel(container.syncIntervalSeconds)}` : "Auto sync off"}
                </dd>
              </div>
              {status.lastResult !== null && (
                <div className="property">
                  <dt>Result</dt>
                  <dd data-testid="last-sync-result">
                    저장소 {status.lastResult.repositories} · PR {status.lastResult.pullRequests}
                    {status.lastResult.skipped > 0 && ` · 건너뜀 ${status.lastResult.skipped}`}
                  </dd>
                </div>
              )}
              <div className="property">
                <dt>Repositories</dt>
                <dd data-testid="repositories">{repositories.length === 0 ? "없음" : repositories.map((r) => r.fullName).join(", ")}</dd>
              </div>
            </dl>
            {status.sources.length > 0 && (
              <p className="source-list">
                <SourceStatusList sources={status.sources} />
              </p>
            )}
            {status.lastError !== null && (
              <p className="form-error" data-testid="connection-error">
                {container.configError !== null ? "설정 오류" : "동기화 실패"}: {status.lastError}
              </p>
            )}
            {status.lastWarning !== null && (
              <p className="form-error" data-testid="sync-warning">
                {status.lastWarning}
              </p>
            )}
          </section>

          <section className="connection-card" aria-labelledby="c-storage">
            <Icon name="database" />
            <h2 id="c-storage">Storage</h2>
            <p className="muted" data-testid="storage-note">
              {container.storage === "memory"
                ? "저장은 서버 메모리라서 서버를 다시 켜면 처음 상태로 돌아간다."
                : "업무 · 연결 · 결정 · 메모는 PostgreSQL 에 남는다. 서버를 다시 켜도 그대로다."}
            </p>
            <p className="card-state">
              <span className={container.storage === "postgres" ? "pill blue" : "pill"} data-testid="storage-kind">
                {container.storage === "postgres" ? "Stored in PostgreSQL" : "Stored in memory"}
              </span>
            </p>
          </section>

          <section className="connection-card" aria-labelledby="c-preview">
            <Icon name="monitor" />
            <h2 id="c-preview">Preview host</h2>
            <p className="muted" data-testid="preview-device-detail">
              {device.text}
              {device.active !== null && ` · ${PREVIEW_PHASE[device.active.phase]} · ${device.active.repoName}#${device.active.number}`}
              {" "}미리보기가 없어도 검토는 할 수 있다 — GitHub 에서 확인한다.
            </p>
            <p className="card-state">
              <span className={device.online ? "pill blue" : "pill"} data-testid="preview-device">
                {device.online ? "Preview device: connected" : "Preview device: not connected"}
              </span>
            </p>
          </section>

          <section className="connection-card" aria-labelledby="c-ai" data-testid="ai-models">
            <Icon name="agents" />
            <h2 id="c-ai">AI models</h2>
            <p className="muted">3단계 첫 단위(실행 경로 시험) 전에는 모델 선택 · Flow · Agents 를 열지 않는다. 대화와 메모는 AI 에게 전달되지 않는다.</p>
            <p className="card-state">
              <span className="pill" data-testid="ai-models-state">
                Not connected
              </span>
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
