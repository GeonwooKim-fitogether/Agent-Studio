/**
 * 이 컴퓨터에서 도는 미리보기 실행기 (docs/plan/04-remote-preview.md §2 · §6).
 *
 * Studio 서버 프로세스 안에서 자식 프로세스로 PR 의 앱을 띄운다. 한 번의 미리보기는 이렇게 흐른다.
 *   1. 이전 미리보기가 있으면 먼저 끄고, **끄기가 끝날 때까지 기다린다**(동시 1개, 계약 §6). 새 기록에 "무엇을 껐는지" 를 남긴다.
 *   2. 코드 받기(CodeSource)로 tar 묶음을 받는다. 끄면 받기도 멈춘다.
 *   3. PREVIEW_WORKDIR 아래에 새 격리 폴더를 만들고 운영체제의 tar 로 푼 뒤, 격리 폴더 밖을 가리키는 심볼릭 링크가 있으면 거부한다.
 *   4. package.json 과 lockfile 을 확인하고 `npm ci --no-audit --no-fund` 로 설치한다(상한 10분).
 *   5. 빈 포트를 골라 `npm run dev`(없으면 start)를 PORT 로 켜고, 그 포트에 HTTP 응답이 오면 "실행 중" 이다(상한 3분).
 * 자식 프로세스에는 허용 목록의 환경변수만 준다(child-env.ts). 토큰은 Studio 프로세스 안의 요청 헤더에만 쓴다.
 *
 * 끄기: 자식은 저마다 자기 프로세스 묶음(프로세스 그룹)으로 띄우고, 실행마다 그 묶음 번호를 모두 기억한다(설치 단계가 남긴
 * 백그라운드 프로세스도 그 묶음에 있다). 끌 때는 묶음 전체에 SIGTERM 을 보내고, 유예(5초) 뒤에는 **무조건** 묶음 전체에 SIGKILL 을 보낸다.
 * 맨 앞의 npm 이 먼저 끝나도 묶음 번호로 보내므로, 신호를 무시하는 앱이 포트를 쥔 채 남지 않는다.
 *
 * 이것은 격리 장치(샌드박스)가 아니다 — 자식은 Studio 와 같은 운영체제 사용자로 돈다(§4 "막지 못하는 것").
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, readlink, realpath, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isFullSha, type PreviewPhase, type PreviewSession, type PreviewTarget } from "../../../domain/preview";
import type { PreviewRunner, PreviewRunnerStatus } from "../../../ports/preview-runner";
import { createLogTail, knownSecretsOf, previewChildEnv } from "./child-env";
import { type CodeArchive, type CodeSource, CodeSourceError } from "./code-source";

export const DEFAULT_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_START_TIMEOUT_MS = 3 * 60 * 1000;
export const DEFAULT_LOG_LINES = 40;
/** 끄라고 한 뒤 이만큼 기다리고, 그 뒤에는 무조건 강제로 끈다 */
export const KILL_GRACE_MS = 5000;
/** 강제로 끈 뒤 프로세스 묶음이 비기를 기다리는 상한 */
const KILL_WAIT_MS = 2000;

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
  /** 끄라는 신호(SIGTERM) 뒤 강제로 끄기(SIGKILL)까지의 유예 (기본 5초) */
  readonly killGraceMs?: number;
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
const cancelledFailure = () => new PreviewFailure("취소됐다.");

const IS_WINDOWS = process.platform === "win32";

/** 주소에 쓸 호스트. IPv6 는 대괄호로 감싼다 */
const hostForUrl = (host: string) => (host.includes(":") ? `[${host}]` : host);

/** 준비 확인을 보낼 곳. 모든 주소에 묶었으면 이 컴퓨터 자신으로 확인한다 */
const probeHostOf = (bindHost: string) => (bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost === "::" ? "::1" : bindHost);

/**
 * 미리보기 앱에 PREVIEW_ALLOWED_DEV_ORIGINS 로 넘길 호스트 목록(쉼표로 잇는다).
 * Next.js 16 의 개발 서버는 localhost 가 아닌 주소(휴대전화가 여는 사설망 주소)에서 온 개발용 연결을 막아, 화면은 보여도
 * 버튼이 동작하지 않는다(2026-09-30 실측). 앱이 이 값을 next.config 의 allowedDevOrigins 로 읽으면 풀린다.
 * 화면에 보이는 주소(publicHost)와 묶는 주소(bindHost)를 넣고, "모든 주소" 는 호스트가 아니므로 뺀다.
 */
export function devOriginsOf(bindHost: string, publicHost: string): string {
  const hosts = [publicHost, bindHost].filter((h) => h !== "0.0.0.0" && h !== "::");
  return [...new Set(hosts)].join(",");
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * 프로세스 묶음 하나에 신호를 보낸다. 묶음이 이미 비었으면(ESRCH) 조용히 넘어간다.
 * Windows 에는 프로세스 묶음 신호가 없어 `taskkill /T /F` 로 그 프로세스와 **지금 살아 있는** 자손을 한 번에 강제로 끈다.
 */
function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/pid", String(pgid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pgid, signal);
  } catch {
    // 묶음이 이미 비었다
  }
}

/**
 * 그 프로세스 묶음에 아직 **살아 있는** 프로세스가 있는가 (Windows 는 맨 앞 프로세스만 본다).
 * 끝났지만 아직 거둬지지 않은 프로세스(좀비)도 신호 0 에는 "있음" 으로 답한다. 컨테이너처럼 1번 프로세스가 좀비를 거두지 않는
 * 곳에서는 그래서 묶음이 영영 비지 않는 것처럼 보이므로, Linux 에서는 /proc 에서 그 묶음의 좀비가 아닌 프로세스를 찾아 확인한다.
 */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(IS_WINDOWS ? pgid : -pgid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  return process.platform === "linux" ? hasLiveMemberOnLinux(pgid) : true;
}

function hasLiveMemberOnLinux(pgid: number): boolean {
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return true; // 확인할 수 없으면 살아 있다고 본다(기다린 뒤 강제로 끈다)
  }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const [state, , pgrp] = stat.slice(stat.lastIndexOf(")") + 2).split(" "); // "(이름)" 뒤: 상태 · 부모 · 묶음 번호
      if (Number(pgrp) === pgid && state !== "Z") return true;
    } catch {
      // 그 사이 끝난 프로세스
    }
  }
  return false;
}

async function waitGroupsGone(groups: Iterable<number>, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while ([...groups].some(groupAlive) && Date.now() < deadline) await sleep(100);
}

/**
 * Windows 에서 npm(npm.cmd)을 셸 해석 없이 띄울 명령줄. Node 의 shell: true 와 같은 모양(`cmd.exe /d /s /c "…"`)이지만,
 * 넘기는 낱말을 이 파일의 고정값(영문 · 숫자 · - · :)으로만 받아 cmd.exe 가 해석할 글자(& ^ | < > " % 공백 등)가 들어갈 수 없다.
 * 작업 폴더는 명령줄이 아니라 cwd 로 넘기므로 `C:\Users\John Doe` 같은 공백 경로도 명령줄을 지나지 않는다.
 */
export function windowsNpmCommand(args: readonly string[], comspec = "cmd.exe"): { command: string; args: string[] } {
  for (const arg of args) if (!/^[A-Za-z0-9:-]+$/.test(arg)) throw new Error(`npm 에 넘길 수 없는 낱말: ${arg}`);
  return { command: comspec, args: ["/d", "/s", "/c", `"npm ${args.join(" ")}"`] };
}

/** 격리 폴더 안의 심볼릭 링크 중 폴더 밖을 가리키거나 가리키는 곳이 없는 것 (앞의 몇 개) */
export async function escapingSymlinks(root: string): Promise<string[]> {
  const base = await realpath(root);
  const entries = await readdir(base, { recursive: true, withFileTypes: true });
  const bad: string[] = [];
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const full = join(entry.parentPath, entry.name);
    const name = relative(base, full);
    let resolved: string;
    try {
      resolved = await realpath(full);
    } catch {
      // 가리키는 곳이 (아직) 없다. 이름으로만 보아 밖이면 거부하고, 안이어도 나중에 밖으로 이어질 수 있어 거부한다
      bad.push(`${name} → ${await readlink(full).catch(() => "?")}`);
      continue;
    }
    const inside = relative(base, resolved);
    if (inside === ".." || inside.startsWith(`..${IS_WINDOWS ? "\\" : "/"}`) || isAbsolute(inside)) {
      bad.push(`${name} → ${await readlink(full).catch(() => resolve(dirname(full)))}`);
    }
    if (bad.length >= 3) break;
  }
  return bad;
}

export function createLocalPreviewRunner(options: LocalRunnerOptions): LocalPreviewRunner {
  const installTimeoutMs = options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
  const logLines = options.logLines ?? DEFAULT_LOG_LINES;
  const now = options.now ?? (() => new Date());
  const knownSecrets = knownSecretsOf(options.parentEnv);

  interface Run {
    readonly id: string;
    readonly dir: string;
    /** 이 실행이 띄운 자식들의 프로세스 묶음 번호 (끝난 자식의 것도 남긴다 — 그 묶음에 손자가 남아 있을 수 있다) */
    readonly groups: Set<number>;
    readonly log: ReturnType<typeof createLogTail>;
    readonly abort: AbortController;
    cancelled: boolean;
  }

  let session: PreviewSession | null = null;
  let active: Run | null = null;
  /** 아직 완전히 끄지 않은 실행들 (Studio 가 끝날 때 이것들의 묶음을 모두 끈다) */
  const live = new Set<Run>();
  /**
   * 진행 중인 끄기. 모든 start 는 이것이 끝난 뒤에야 새 자식을 띄운다 — stop 이 기다리는 사이 들어온 start 가
   * 이전 미리보기와 겹치지 않게 한다. 실행기 하나당 하나다.
   */
  let stopping: Promise<void> = Promise.resolve();

  const status: PreviewRunnerStatus = { online: true, label: `this computer · ${options.bindHost} · code from ${options.source.label}` };

  function update(id: string, patch: Partial<PreviewSession>): void {
    if (session !== null && session.id === id) session = { ...session, ...patch };
  }

  /** 한 실행을 끝까지 끈다: 묶음 전체에 SIGTERM → 유예 → 무조건 SIGKILL → 비기를 기다림 → 격리 폴더 지우기 */
  async function shutdown(run: Run): Promise<void> {
    run.cancelled = true;
    run.abort.abort();
    for (const pgid of run.groups) signalGroup(pgid, "SIGTERM");
    await waitGroupsGone(run.groups, killGraceMs);
    for (const pgid of run.groups) signalGroup(pgid, "SIGKILL"); // 유예 뒤에는 묶음이 비었든 아니든 보낸다
    await waitGroupsGone(run.groups, KILL_WAIT_MS);
    live.delete(run);
    await rm(run.dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }

  /** 지금 실행을 끄는 일을 stopping 에 이어 붙이고, 모든 끄기가 끝나는 약속을 돌려준다 */
  function stopActive(): Promise<void> {
    const current = active;
    if (current !== null) {
      active = null;
      current.cancelled = true;
      current.abort.abort();
      stopping = Promise.all([stopping, shutdown(current)]).then(() => undefined);
    }
    return stopping;
  }

  /** 자식 프로세스 하나를 띄운다. 출력은 로그 꼬리로 간다. 자기 프로세스 묶음으로 띄워 끌 때 손자까지 끈다 */
  function spawnChild(run: Run, command: string, args: readonly string[], cwd: string, env: Record<string, string>): ChildProcess {
    if (run.cancelled) throw cancelledFailure();
    const npmOnWindows = IS_WINDOWS && command === "npm";
    const line = npmOnWindows ? windowsNpmCommand(args, env["COMSPEC"] ?? env["ComSpec"] ?? "cmd.exe") : { command, args: [...args] };
    const child = spawn(line.command, line.args, {
      cwd,
      env: env as NodeJS.ProcessEnv,
      detached: !IS_WINDOWS,
      shell: false, // 셸을 쓰지 않는다. Windows 의 npm 만 위의 고정 명령줄로 cmd.exe 를 거친다
      windowsVerbatimArguments: npmOnWindows,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    if (child.pid !== undefined) run.groups.add(child.pid); // detached 로 띄운 자식의 pid 가 곧 그 묶음 번호다
    child.stdin?.on("error", () => undefined); // 자식이 입력을 닫고 먼저 끝나면(EPIPE) Studio 가 죽지 않게
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => run.log.write(chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => run.log.write(chunk));
    return child;
  }

  /** 끝날 때까지 기다리는 단계 (tar · npm ci). 상한을 넘으면 끄고 실패로 본다 */
  function runStep(
    run: Run,
    step: { command: string; args: readonly string[]; cwd: string; env: Record<string, string>; timeoutMs: number; what: string; input?: Uint8Array },
  ): Promise<void> {
    return new Promise((done, fail) => {
      const child = spawnChild(run, step.command, step.args, step.cwd, step.env);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) signalGroup(child.pid, "SIGKILL");
      }, step.timeoutMs);
      child.once("error", () => {
        clearTimeout(timer);
        fail(new PreviewFailure(`${step.what}을(를) 시작하지 못했다 — ${step.command} 가 이 컴퓨터에 있는지 확인한다.`));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (run.cancelled) fail(cancelledFailure());
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

  async function waitReady(run: Run, app: ChildProcess, port: number): Promise<void> {
    const deadline = Date.now() + startTimeoutMs;
    for (;;) {
      if (run.cancelled) throw cancelledFailure();
      if (app.exitCode !== null || app.signalCode !== null) {
        throw new PreviewFailure(`앱이 준비되기 전에 끝났다 (종료 코드 ${app.exitCode ?? app.signalCode}). 아래 로그를 확인한다.`);
      }
      if (await probe(port)) return;
      if (Date.now() > deadline) throw new PreviewFailure(`시작 시간 상한(${Math.round(startTimeoutMs / 1000)}초) 안에 주소가 응답하지 않았다.`);
      await sleep(300);
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

  async function pipeline(run: Run, target: PreviewTarget, previous: Promise<void>): Promise<void> {
    await previous; // 이전 미리보기의 끄기가 끝날 때까지 (stop 이 기다리는 중이었어도) 새 자식을 띄우지 않는다
    await staleCleaned; // 옛 폴더 지우기가 새 폴더를 지우지 않게 먼저 끝낸다
    if (run.cancelled) throw cancelledFailure();
    run.log.note(`[studio] 커밋 ${target.commitSha} 의 코드를 받는다 (${options.source.label})`);
    let archive: CodeArchive;
    try {
      archive = await options.source.archive(target, { signal: run.abort.signal });
    } catch (error) {
      if (run.cancelled) throw cancelledFailure();
      throw new PreviewFailure(error instanceof CodeSourceError ? error.message : "코드를 받지 못했다.");
    }
    if (run.cancelled) throw cancelledFailure(); // 받는 사이 취소됐으면 격리 폴더를 만들지 않는다
    const srcDir = join(run.dir, "src");
    try {
      await mkdir(srcDir, { recursive: true });
    } catch {
      throw new PreviewFailure("PREVIEW_WORKDIR 에 격리 폴더를 만들지 못했다 — 폴더가 있고 쓸 수 있는지 확인한다.");
    }
    if (run.cancelled) throw cancelledFailure();
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
    const escaping = await escapingSymlinks(srcDir).catch(() => ["(폴더를 읽지 못했다)"]);
    if (escaping.length > 0) {
      throw new PreviewFailure(
        `격리 폴더 밖을 가리키거나 가리키는 곳이 없는 심볼릭 링크가 있어 설치하지 않았다 — npm ci 가 링크를 따라가 폴더 밖을 지우거나 쓸 수 있다: ${escaping.join(", ")}`,
      );
    }
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
    if (run.cancelled) throw cancelledFailure();

    update(run.id, { phase: "starting" });
    const port = await freePort();
    run.log.note(`[studio] npm run ${script} (PORT=${port})`);
    const app = spawnChild(
      run,
      "npm",
      ["run", script],
      srcDir,
      previewChildEnv(options.parentEnv, "run", {
        PORT: String(port),
        HOST: options.bindHost,
        HOSTNAME: options.bindHost,
        PREVIEW_ALLOWED_DEV_ORIGINS: devOriginsOf(options.bindHost, options.publicHost),
      }),
    );
    app.once("error", () => run.log.note("[studio] npm 을 시작하지 못했다"));
    app.once("exit", (code) => {
      if (!run.cancelled && session?.id === run.id && session.phase === "running") {
        update(run.id, { phase: "failed", url: null, failure: `앱이 스스로 끝났다 (종료 코드 ${code}). 아래 로그를 확인한다.` });
      }
    });
    await waitReady(run, app, port);
    update(run.id, { phase: "running", url: `http://${hostForUrl(options.publicHost)}:${port}/` });
  }

  function start(target: PreviewTarget): PreviewSession {
    if (!isFullSha(target.commitSha)) throw new Error("전체 커밋 SHA 로만 미리보기를 연다.");
    const live0 = session !== null && session.phase !== "failed" && session.phase !== "stopped";
    const replaced = live0 && session !== null ? session.target : null;
    const previous = stopActive();
    const id = `${now().getTime().toString(36)}-${randomBytes(3).toString("hex")}`;
    const run: Run = {
      id,
      dir: join(options.workdir, `preview-${id}`),
      groups: new Set(),
      log: createLogTail(logLines, () => knownSecrets),
      abort: new AbortController(),
      cancelled: false,
    };
    active = run;
    live.add(run);
    session = { id, target, phase: "fetching", startedAt: now().toISOString(), url: null, failure: null, logTail: [], replaced };
    void pipeline(run, target, previous).catch((error: unknown) => {
      if (run.cancelled) {
        // 끄기와 겹쳐 폴더가 늦게 생겼을 수 있다 — 파이프라인이 멈춘 뒤 한 번 더 지운다
        void rm(run.dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
        return;
      }
      for (const pgid of run.groups) signalGroup(pgid, "SIGKILL");
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
    if (snapshot !== null && session !== null && session.id === snapshot.id && session.phase !== "failed") {
      session = { ...session, phase: "stopped" as PreviewPhase, url: null, logTail: snapshot.logTail };
    }
    await stopActive();
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
    // Studio 서버가 끝나면(정상 종료 · Ctrl-C 뒤의 exit) 아직 끄지 않은 모든 실행의 프로세스 묶음을 끈다. exit 안에서는 동기로만 할 수 있다.
    process.once("exit", () => {
      for (const run of live) for (const pgid of run.groups) signalGroup(pgid, "SIGKILL");
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
