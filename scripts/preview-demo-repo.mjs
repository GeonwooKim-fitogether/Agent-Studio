#!/usr/bin/env node
/**
 * 미리보기 시연 저장소를 만든다 (docs/plan/04-remote-preview.md §3).
 *
 *   npm run preview:demo-repo -- <폴더>        예: npm run preview:demo-repo -- /tmp/studio-repos
 *
 * <폴더>/demo-org/admin-console 에 작은 Node 앱이 든 git 저장소를 만든다. 고정 시연 데이터의 PR
 * demo-org/admin-console#12 가 가리키는 최신 커밋과 **글자 하나까지 같은 SHA** 의 커밋이다 —
 * 작성자 · 시각 · 내용을 고정했으므로 어느 컴퓨터에서 만들어도 SHA 가 같다(tests/unit/preview-local-runner.test.ts 가 확인한다).
 * 그 뒤 Studio 를 이렇게 띄우면 고정 데이터로 미리보기를 시연할 수 있다.
 *
 *   PREVIEW_WORKDIR=<격리 폴더들의 부모> PREVIEW_LOCAL_REPOS_DIR=<폴더> npm run dev
 *
 * 네트워크를 쓰지 않는다. 이미 같은 커밋이 있으면 아무것도 바꾸지 않는다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const DEMO_FULL_NAME = "demo-org/admin-console";

/** 시연 앱의 파일. 이 내용을 바꾸면 커밋 SHA 가 바뀌므로 demo-scenario.ts 의 DEMO_SHA.admin12Head 도 함께 바꾼다 */
export const DEMO_FILES = {
  "package.json": `${JSON.stringify(
    { name: "admin-console-demo", version: "1.0.0", private: true, scripts: { start: "node server.js" } },
    null,
    2,
  )}\n`,
  "package-lock.json": `${JSON.stringify(
    {
      name: "admin-console-demo",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "admin-console-demo", version: "1.0.0" } },
    },
    null,
    2,
  )}\n`,
  "server.js": [
    "// Agent Studio 미리보기 시연 앱 — PORT 와 HOST 로 받은 주소에 한 화면을 띄운다.",
    'const http = require("node:http");',
    "const port = Number(process.env.PORT || 3000);",
    'const host = process.env.HOST || "127.0.0.1";',
    "http",
    "  .createServer((req, res) => {",
    '    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });',
    '    res.end("<!doctype html><title>admin-console preview</title><h1>관리자 로그인 2단계 인증</h1><p data-demo=\\"preview\\">demo-org/admin-console#12 미리보기</p>");',
    "  })",
    "  .listen(port, host, () => console.log(`listening on ${host}:${port}`));",
    "",
  ].join("\n"),
};

const IDENTITY = {
  GIT_AUTHOR_NAME: "Agent Studio Demo",
  GIT_AUTHOR_EMAIL: "demo@agent-studio.invalid",
  GIT_AUTHOR_DATE: "2026-09-24T09:00:00+00:00",
  GIT_COMMITTER_NAME: "Agent Studio Demo",
  GIT_COMMITTER_EMAIL: "demo@agent-studio.invalid",
  GIT_COMMITTER_DATE: "2026-09-24T09:00:00+00:00",
};

/** 시연 저장소를 만들고 커밋 SHA 를 돌려준다 */
export function createDemoRepo(reposDir) {
  const dir = join(resolve(reposDir), ...DEMO_FULL_NAME.split("/"));
  mkdirSync(dir, { recursive: true });
  // 사용자 · 시스템 git 설정(서명 · 줄바꿈 변환 등)이 커밋 내용을 바꾸지 않게 막는다
  const env = { PATH: process.env.PATH ?? "", HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(dir, ".git-empty-config"), ...IDENTITY };
  if (process.platform === "win32") Object.assign(env, { SYSTEMROOT: process.env.SYSTEMROOT ?? "", USERPROFILE: dir });
  const git = (...args) => execFileSync("git", ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], { cwd: dir, env, encoding: "utf8" }).trim();
  if (!existsSync(join(dir, ".git"))) git("init", "--quiet");
  for (const [name, content] of Object.entries(DEMO_FILES)) writeFileSync(join(dir, name), content);
  git("add", "--", ...Object.keys(DEMO_FILES));
  const hasHead = (() => {
    try {
      git("rev-parse", "--verify", "--quiet", "HEAD");
      return true;
    } catch {
      return false;
    }
  })();
  if (!hasHead || git("status", "--porcelain", "--", ...Object.keys(DEMO_FILES)) !== "") {
    git("commit", "--quiet", "-m", "관리자 로그인 2단계 인증 (시연)");
  }
  return git("rev-parse", "HEAD");
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  const target = process.argv[2];
  if (target === undefined || !isAbsolute(target)) {
    console.error("사용법: npm run preview:demo-repo -- <절대 경로 폴더>");
    process.exit(2);
  }
  const sha = createDemoRepo(target);
  console.log(`${DEMO_FULL_NAME} 시연 저장소를 만들었다: 커밋 ${sha}`);
}
