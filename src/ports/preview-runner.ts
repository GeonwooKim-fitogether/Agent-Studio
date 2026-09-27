/**
 * 미리보기 실행기와의 약속 (2단계, docs/plan/04-remote-preview.md).
 *
 * 첫 버전의 실행기는 Studio 서버와 같은 컴퓨터에서 도는 어댑터 하나다(src/adapters/preview/local).
 * 나중에 Mac Pro 가 Studio 와 실행기를 함께 호스팅한다. 실행기가 다른 컴퓨터로 옮겨 가도 유스케이스는 이 인터페이스만 본다.
 *
 * 동시에 하나만 실행한다. start 를 부르면 이전 미리보기를 종료하고 새 것의 기록에 "무엇을 껐는지" 를 남긴다.
 */
import type { PreviewSession, PreviewTarget } from "../domain/preview";

/** 실행기를 지금 쓸 수 있나. 쓸 수 없으면 사람이 읽고 고칠 수 있는 이유 문장을 준다 (결정 7: 실행되지 않는 버튼을 두지 않는다). */
export type PreviewRunnerStatus =
  | { readonly online: true; /** 화면 위쪽 띠에 보일 짧은 설명 (예: "this computer · 127.0.0.1") */ readonly label: string }
  | { readonly online: false; readonly reason: string };

export interface PreviewRunner {
  status(): PreviewRunnerStatus;
  /**
   * 미리보기를 시작한다. 준비(코드 받기 · 설치 · 시작)를 기다리지 않고 곧바로 첫 기록을 돌려준다 — 진행은 current() 로 본다.
   * 실행기가 오프라인이면 던진다. 대상 제한(복제본 · 짧은 SHA)은 유스케이스가 먼저 확인하지만, 실행기도 전체 SHA 가 아니면 거절한다.
   */
  start(target: PreviewTarget): PreviewSession;
  /** 실행 중인 미리보기를 끈다. 없으면 아무것도 하지 않는다. */
  stop(): Promise<void>;
  /** 지금 들고 있는 미리보기(실패 · 종료된 마지막 것 포함). 한 번도 없었으면 null. */
  current(): PreviewSession | null;
}
