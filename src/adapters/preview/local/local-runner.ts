/**
 * 이 컴퓨터에서 도는 미리보기 실행기 (docs/plan/04-remote-preview.md §2 · §6).
 *
 * Studio 서버 프로세스 안에서 자식 프로세스로 PR 의 앱을 띄운다. 한 번의 미리보기는 이렇게 흐른다.
 *   1. 이전 미리보기가 있으면 먼저 끈다(동시 1개, 계약 §6). 새 기록에 "무엇을 껐는지" 를 남긴다.
 *   2. PREVIEW_WORKDIR 아래에 새 격리 폴더를 만들고, 코드 받기(CodeSource)가 준 tar 묶음을 운영체제의 tar 로 푼다.
 *   3. package.json 과 lockfile 을 확인하고 `npm ci --no-audit --no-fund` 로 설치한다(상한 10분).
 *   4. 빈 포트를 골라 `npm run dev`(없으면 start)를 PORT 로 켜고, 그 포트에 HTTP 응답이 오면 "실행 중" 이다(상한 3분).
 * 자식 프로세스에는 허용 목록의 환경변수만 준다(child-env.ts). 토큰은 코드 받기 단계에서도 자식에게 가지 않는다.
 * 자식은 자기 프로세스 묶음으로 띄워, 끌 때 그 앱이 띄운 손자 프로세스까지 함께 끈다. Studio 가 끝날 때도 끈다.
 *
 * 이것은 격리 장치(샌드박스)가 아니다 — 자식은 Studio 와 같은 운영체제 사용자로 돈다(§4 "막지 못하는 것").
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { isFullSha, type PreviewPhase, type PreviewSession, type PreviewTarget } from "../../../domain/preview";
import type { PreviewRunner, PreviewRunnerStatus } from "../../../ports/preview-runner";
import { createLogTail, previewChildEnv } from "./child-env";
import { type CodeSource, CodeSourceError } from "./code-source";

export const DEFAULT_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_START_TIMEOUT_MS = 3 * 60 * 1000;
export const DEFAULT_LOG_LINES = 40;
/** 끄라고 한 뒤 이만큼 기다려도 안 꺼지면 강제로 끈다 */
const KILL_GRACE_MS = 5000;

export interface LocalRunnerOptions {
  readonly workdir: string;
  readonly bindHost: string;
  readonly publicHost: string;
  readonly source: CodeSource;
  /** Studio 의 환경(process.env). 여기서 허용 목록의 이름만 골라 자식에게 준다 */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly installTimeoutMs?: number;
  readonly startTimeoutMs?: number;
  readonly logLines?: number;
  readonly now?: () => Date;
  /** Studio 가 끝날 때 자식을 끄는 처리를 등록할까 (기본 true. 시험은 끄고 dispose 를 부른다) */
  readonly registerExitCleanup?: boolean;
}

export interface LocalPreviewRunner extends PreviewRunner {
  /** 살아 있는 자식을 모두 끄고 기다린다 (시험 · 종료용) */
  dispose(): Promise<void>;
}

/** 실패 이유 문장을 실은 오류. 이 문장은 화면에 그대로 보인다 */
class PreviewFailure extends Error {}

const IS_WINDOWS = process.platform === "win32";

/** 주소에 쓸 호스트. IPv6 는 대괄호로 감싼다 */
const hostForUrl = (host: string) => (host.includes(":") ? `[${host}]` : host);

/** 준비 확인을 보낼 곳. 모든 주소에 묶었으면 이 컴퓨터 자신으로 확인한다 */
const probeHostOf = (bindHost: string) => (bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost === "::" ? "::1" : bindHost);

export function createLocalPreviewRunner(options: LocalRunnerOptions): LocalPreviewRunner {
  const installTimeoutMs = options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const logLines = options.logLines ?? DEFAULT_LOG_LINES;
  const now = options.now ?? (() => new Date());

  interface Active {
    readonly id: string;
    readonly dir: string;
    readonly children: Set<ChildProcess>;
    readonly log: ReturnType<typeof createLogTail>;
    cancelled: boolean;
  }

  let session: PreviewSession | null = null;
  let active: Active | null = null;

  const status: PreviewRunnerStatus = { online: true, label: `this computer · ${options.bindHost} · code from ${options.source.label}` };

  function update(id: string, patch: Partial<PreviewSession>): void {
    if (session !== null && session.id === id) session = { ...session, ...patch };
  }

  function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (IS_WINDOWS) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else process.kill(-child.pid, signal); // 자식이 만든 프로세스 묶음 전체
    } catch {
      // 이미 끝났다
    }
  }

  function waitExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return Promise.resolve();
    return new Promise((done) => child.once("close", () => done()));
  }

  async function stopActive(): Promise<void> {
    const current = active;
    if (current === null) return;
    active = null;
    current.cancelled = true;
    const children = [...current.children];
    for (const child of children) killTree(child, "SIGTERM");
    const forced = setTimeout(() => children.forEach((c) => killTree(c, "SIGKILL")), KILL_GRACE_MS);
    await Promise.all(children.map(waitExit));
    clearTimeout(forced);
    // 파이프라인이 코드를 받는 중(네트워크)이면 끝나기를 기다리지 않는다. 취소 표시를 본 파이프라인은 새 자식을 띄우지 않는다.
    // 격리 폴더는 다음 미리보기에 쓰지 않는다. 지우는 것이 늦어도 화면을 막지 않는다.
    void rm(current.dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }

  /** 자식 프로세스 하나를 띄운다. 출력은 로그 꼬리로 간다. 자기 프로세스 묶음으로 띄워 끌 때 손자까지 끈다 */
  function spawnChild(run: Active, command: string, args: readonly string[], cwd: string, env: Record<string, string>): ChildProcess {
    if (run.cancelled) throw new PreviewFailure("취소됐다.");
    const child = spawn(command, [...args], {
      cwd,
      env: env as NodeJS.ProcessEnv,
      detached: !IS_WINDOWS,
      shell: IS_WINDOWS, // Windows 의 npm 은 npm.cmd 라 셸이 있어야 한다. 인자는 모두 이 파일의 고정값이다
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    run.children.add(child);
    child.once("close", () => run.children.delete(child));
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => run.log.write(chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => run.log.write(chunk));
    return child;
  }

  /** 끝날 때까지 기다리는 단계 (tar · npm ci). 상한을 넘으면 끄고 실패로 본다 */
  function runStep(
    run: Active,
    step: { command: string; args: readonly string[]; cwd: string; env: Record<string, string>; timeoutMs: number; what: string; input?: Uint8Array },
  ): Promise<void> {
    return new Promise((done, fail) => {
      const child = spawnChild(run, step.command, step.args, step.cwd, step.env);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child, "SIGKILL");
      }, step.timeoutMs);
      child.once("error", () => {
        clearTimeout(timer);
        fail(new PreviewFailure(`${step.what}을(를) 시작하지 못했다 — ${step.command} 가 이 컴퓨터에 있는지 확인한다.`));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (run.cancelled) fail(new PreviewFailure("취소됐다."));
        else if (timedOut) fail(new PreviewFailure(`${step.what} 시간 상한(${Math.round(step.timeoutMs / 1000)}초)을 넘어 중단했다.`));
        else if (code !== 0) fail(new PreviewFailure(`${step.what}이(가) 실패했다 (종료 코드 ${code}). 아래 로그를 확인한다.`));
        else done();
      });
      if (step.input !== undefined) child.stdin?.end(Buffer.from(step.input));
      else child.stdin?.end();
    });
  }

  async function freePort(): Promise<number> {
    return new Promise((done, fail) => {
      const server = createServer();
      server.once("error", () => fail(new PreviewFailure(`PREVIEW_BIND_HOST 의 주소에 포트를 열 수 없다 — 이 컴퓨터의 주소인지 확인한다.`)));
      server.listen(0, options.bindHost, () => {
        const address = server.address();
        const port = typeof address === "object" && address !== null ? address.port : 0;
        server.close(() => done(port));
      });
    });
  }

  /** 그 포트에 HTTP 응답(상태 코드 무관)이 한 번 오면 준비된 것이다 */
  function probe(port: number): Promise<boolean> {
    return new Promise((done) => {
      const req = request({ host: probeHostOf(options.bindHost), port, path: "/", method: "GET", timeout: 2000 }, (res) => {
        res.resume();
        done(true);
      });
      req.once("timeout", () => req.destroy());
      req.once("error", () => done(false));
      req.end();
    });
  }

  async function waitReady(run: Active, app: ChildProcess, port: number): Promise<void> {
    const deadline = Date.now() + startTimeoutMs;
    for (;;) {
      if (run.cancelled) throw new PreviewFailure("취소됐다.");
      if (app.exitCode !== null || app.signalCode !== null) {
        throw new PreviewFailure(`앱이 준비되기 전에 끝났다 (종료 코드 ${app.exitCode ?? app.signalCode}). 아래 로그를 확인한다.`);
      }
      if (await probe(port)) return;
      if (Date.now() > deadline) throw new PreviewFailure(`시작 시간 상한(${Math.round(startTimeoutMs / 1000)}초) 안에 주소가 응답하지 않았다.`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async function readScript(srcDir: string): Promise<"dev" | "start"> {
    let pkg: unknown;
    try {
      pkg = JSON.parse(await readFile(join(srcDir, "package.json"), "utf8"));
    } catch {
      throw new PreviewFailure("저장소 맨 위에 읽을 수 있는 package.json 이 없다. 첫 버전은 Node 프로젝트만 미리보기로 연다.");
    }
    if (!existsSync(join(srcDir, "package-lock.json")) && !existsSync(join(srcDir, "npm-shrinkwrap.json"))) {
      throw new PreviewFailure("lockfile(package-lock.json)이 없어 설치하지 않았다 — npm ci 는 lockfile 그대로만 설치해, 무엇을 설치했는지가 커밋에 고정된다.");
    }
    const scripts = (typeof pkg === "object" && pkg !== null ? (pkg as { scripts?: unknown }).scripts : undefined) ?? {};
    const has = (name: string) => typeof (scripts as Record<string, unknown>)[name] === "string";
    if (has("dev")) return "dev";
    if (has("start")) return "start";
    throw new PreviewFailure("package.json 에 dev 나 start 스크립트가 없어 앱을 켤 방법을 모른다.");
  }

  async function pipeline(run: Active, target: PreviewTarget, previous: Promise<void>): Promise<void> {
    await previous;
    await staleCleaned; // 옛 폴더 지우기가 새 폴더를 지우지 않게 먼저 끝낸다
    const srcDir = join(run.dir, "src");
    try {
      await mkdir(srcDir, { recursive: true });
    } catch {
      throw new PreviewFailure("PREVIEW_WORKDIR 에 격리 폴더를 만들지 못했다 — 폴더가 있고 쓸 수 있는지 확인한다.");
    }
    run.log.note(`[studio] 커밋 ${target.commitSha} 의 코드를 받는다 (${options.source.label})`);
    let archive;
    try {
      archive = await options.source.archive(target);
    } catch (error) {
      throw new PreviewFailure(error instanceof CodeSourceError ? error.message : "코드를 받지 못했다.");
    }
    if (run.cancelled) throw new PreviewFailure("취소됐다.");
    const tarArgs = ["-x", ...(archive.gzip ? ["-z"] : []), "-f", "-", "-C", srcDir, "--no-same-owner"];
    if (archive.stripComponents > 0) tarArgs.push(`--strip-components=${archive.stripComponents}`);
    await runStep(run, {
      command: "tar",
      args: tarArgs,
      cwd: run.dir,
      env: previewChildEnv(options.parentEnv, "fetch"),
      timeoutMs: installTimeoutMs,
      what: "코드 풀기(tar)",
      input: archive.bytes,
    });
    const script = await readScript(srcDir);

    update(run.id, { phase: "installing" });
    run.log.note("[studio] npm ci --no-audit --no-fund");
    await runStep(run, {
      command: "npm",
      args: ["ci", "--no-audit", "--no-fund"],
      cwd: srcDir,
      env: previewChildEnv(options.parentEnv, "install"),
      timeoutMs: installTimeoutMs,
      what: "설치(npm ci)",
    });
    if (run.cancelled) throw new PreviewFailure("취소됐다.");

    update(run.id, { phase: "starting" });
    const port = await freePort();
    run.log.note(`[studio] npm run ${script} (PORT=${port})`);
    const app = spawnChild(
      run,
      "npm",
      ["run", script],
      srcDir,
      previewChildEnv(options.parentEnv, "run", { PORT: String(port), HOST: options.bindHost, HOSTNAME: options.bindHost }),
    );
    app.once("error", () => run.log.note("[studio] npm 을 시작하지 못했다"));
    await waitReady(run, app, port);
    update(run.id, { phase: "running", url: `http://${hostForUrl(options.publicHost)}:${port}/` });
    app.once("close", (code) => {
      if (!run.cancelled) update(run.id, { phase: "failed", url: null, failure: `앱이 스스로 끝났다 (종료 코드 ${code}). 아래 로그를 확인한다.` });
    });
  }

  function start(target: PreviewTarget): PreviewSession {
    if (!isFullSha(target.commitSha)) throw new Error("전체 커밋 SHA 로만 미리보기를 연다.");
    const live = session !== null && session.phase !== "failed" && session.phase !== "stopped";
    const replaced = live && session !== null ? session.target : null;
    const previous = stopActive();
    const id = `${now().getTime().toString(36)}-${randomBytes(3).toString("hex")}`;
    const run: Active = {
      id,
      dir: join(options.workdir, `preview-${id}`),
      children: new Set(),
      log: createLogTail(logLines),
      cancelled: false,
    };
    active = run;
    session = { id, target, phase: "fetching", startedAt: now().toISOString(), url: null, failure: null, logTail: [], replaced };
    void pipeline(run, target, previous).catch((error: unknown) => {
      if (run.cancelled) return;
      for (const child of run.children) killTree(child, "SIGKILL");
      update(id, { phase: "failed", url: null, failure: error instanceof PreviewFailure ? error.message : "알 수 없는 이유로 실패했다." });
    });
    return current() as PreviewSession;
  }

  function current(): PreviewSession | null {
    if (session === null) return null;
    const log = active !== null && active.id === session.id ? active.log.lines() : session.logTail;
    return { ...session, logTail: log };
  }

  async function stop(): Promise<void> {
    const snapshot = current();
    await stopActive();
    if (snapshot !== null && session !== null && session.id === snapshot.id && session.phase !== "failed") {
      session = { ...session, phase: "stopped" as PreviewPhase, url: null, logTail: snapshot.logTail };
    }
  }

  // 지난번 Studio 가 남긴 격리 폴더(preview-*)를 지운다. 이 폴더는 Studio 하나만 쓴다고 본다(§3).
  const staleCleaned: Promise<unknown> = readdir(options.workdir)
    .then((names) =>
      Promise.all(
        names.filter((n) => /^preview-[a-z0-9]+-[0-9a-f]{6}$/.test(n)).map((n) => rm(join(options.workdir, n), { recursive: true, force: true })),
      ),
    )
    .catch(() => undefined);

  if (options.registerExitCleanup ?? true) {
    // Studio 서버가 끝나면(정상 종료 · Ctrl-C 뒤의 exit) 자식 프로세스 묶음도 끈다. exit 안에서는 동기로만 할 수 있다.
    process.once("exit", () => {
      for (const child of active?.children ?? []) killTree(child, "SIGKILL");
    });
  }

  return {
    status: () => status,
    start,
    stop,
    current,
    dispose: stop,
  };
}
