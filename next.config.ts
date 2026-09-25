import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 appends an "agent rules" block to the end of CLAUDE.md whenever `next dev` runs.
  // CLAUDE.md is the project instruction file this repository curates by hand, so we turn that automatic edit off.
  agentRules: false,
};

export default nextConfig;
