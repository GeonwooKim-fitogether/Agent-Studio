import Link from "next/link";
import type { AttentionItem } from "../../application/attention";
import { ATTENTION_EMPTY, ATTENTION_KIND, attentionText } from "./labels";

/**
 * Workspace 맨 위의 Needs your attention (feature-plan F4, 시안 v2). 줄 전체가 링크다 — 업무 항목은 그 업무로, Inbox 항목은 Inbox 로 간다.
 * 무엇을 모을지는 application/attention.ts 가 정하고, 이 조각은 받은 목록을 그리기만 한다.
 */
export function NeedsYourAttention({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <section className="attn empty" data-testid="attention" aria-labelledby="attn-h">
        <div className="attn-head">
          <h2 id="attn-h">Needs your attention</h2>
          <small data-testid="attention-count">0</small>
        </div>
        <p className="muted" data-testid="attention-empty">
          {ATTENTION_EMPTY}
        </p>
      </section>
    );
  }
  return (
    <section className="attn" data-testid="attention" aria-labelledby="attn-h">
      <div className="attn-head">
        <h2 id="attn-h">Needs your attention</h2>
        <small data-testid="attention-count">{items.length}</small>
      </div>
      {items.map((item) => {
        const { target, detail } = attentionText(item);
        const toInbox = item.kind === "inbox";
        return (
          <Link
            key={toInbox ? "inbox" : `${item.kind}:${item.workId}:${"pr" in item && item.pr !== null ? `${item.pr.repoName}#${item.pr.number}` : ""}`}
            href={toInbox ? "/inbox" : `/works/${encodeURIComponent(item.workId)}`}
            className="attn-row"
            data-testid="attention-row"
            data-kind={item.kind}
          >
            <span className="kind">{ATTENTION_KIND[item.kind]}</span>
            <span className="attn-text">
              {toInbox ? (
                <b>
                  PR <span data-testid="inbox-count">{item.count}</span>개가 업무 연결을 기다린다
                </b>
              ) : (
                <b>{target}</b>
              )}
              <span className="muted">{detail}</span>
            </span>
            <span className="go">{toInbox ? "Open Inbox" : "Open"}</span>
          </Link>
        );
      })}
    </section>
  );
}
