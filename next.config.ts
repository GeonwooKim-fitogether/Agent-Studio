import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 appends an "agent rules" block to the end of CLAUDE.md whenever `next dev` runs.
  // CLAUDE.md is the project instruction file this repository curates by hand, so we turn that automatic edit off.
  agentRules: false,
  // 휴대전화처럼 localhost 가 아닌 주소로 개발 서버를 열 때, 그 주소를 허용한다. 허용하지 않으면 Next.js 16 이 개발용 연결을 막아
  // 화면은 보여도 버튼이 동작하지 않는다. Studio 의 미리보기 실행기가 이 값을 넘기고(docs/plan/04-remote-preview.md §3),
  // Studio 자신을 휴대전화로 열 때는 .env.local 에 같은 이름으로 사설망 주소를 적는다. 개발 서버에만 쓰이는 설정이다.
  allowedDevOrigins: (process.env.PREVIEW_ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== ""),
};

export default nextConfig;
