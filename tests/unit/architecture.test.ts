/**
 * 클린 아키텍처의 경계를 소스 스캔으로 확인한다 (docs/plan/01-pr-collection.md §2, §4 "구조를 기계가 지킨다").
 *
 *   src/domain      → src/domain 만 import 할 수 있다 (외부 패키지 · node: 모듈 · Next.js 전부 금지)
 *   src/application → src/domain · src/application · src/ports 만
 *   src/ports       → src/domain · src/ports 만
 *
 * 그리고 세 층 모두 바깥 세계에 닿는 전역(fetch · XMLHttpRequest · WebSocket · EventSource · process)을 쓰지 않는다.
 * 바깥 세계와는 포트로만 닿기 때문이다.
 *
 * 정규식이 아니라 TypeScript 컴파일러로 소스를 구문 트리로 읽는다. 그래서 주석이나 문자열 안의 글자에 속지 않고,
 * 백틱으로 쓴 import(`x`) · require(`x`), 타입 위치의 import("x"), 문자열이 아닌 동적 import 까지 잡는다.
 * 상대 경로가 아닌 import(패키지 이름, node:fs, "@/..." 같은 별칭)는 그 자체로 위반이다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const RULES = [
  { layer: "src/domain", allowed: ["src/domain"] },
  { layer: "src/application", allowed: ["src/domain", "src/application", "src/ports"] },
  { layer: "src/ports", allowed: ["src/domain", "src/ports"] },
] as const;

/** 검사할 소스 파일의 확장자. .mts · .cts 도 포함한다. */
export const isSourceFile = (name: string) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name);

const FORBIDDEN_GLOBALS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "process"]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);
export const NON_LITERAL_IMPORT = "<문자열이 아닌 동적 import>";

interface ScanResult {
  /** import 대상 문자열 (문자열이 아닌 동적 import 는 NON_LITERAL_IMPORT) */
  readonly specifiers: string[];
  /** 바깥 세계에 닿는 전역 사용 */
  readonly globals: string[];
}

function literalText(node: ts.Node | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

/** 이 식별자가 무언가의 "이름" 자리(속성 이름, 선언 이름)에 있어 전역 참조가 아닌가 */
function isNamePosition(node: ts.Identifier): boolean {
  const p = node.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
  if (ts.isQualifiedName(p) && p.right === node) return true;
  const named =
    ts.isPropertyAssignment(p) ||
    ts.isPropertySignature(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isMethodSignature(p) ||
    ts.isVariableDeclaration(p) ||
    ts.isParameter(p) ||
    ts.isFunctionDeclaration(p) ||
    ts.isBindingElement(p);
  return named && (p as { name?: ts.Node }).name === node;
}

export function scanSource(fileName: string, source: string): ScanResult {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const globals: string[] = [];

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      specifiers.push(literalText(node.moduleSpecifier) ?? NON_LITERAL_IMPORT);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      specifiers.push(literalText(node.moduleReference.expression) ?? NON_LITERAL_IMPORT);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifiers.push(literalText(node.argument.literal) ?? NON_LITERAL_IMPORT);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isImport || isRequire) specifiers.push(literalText(node.arguments[0]) ?? NON_LITERAL_IMPORT);
    }

    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text) && !isNamePosition(node)) {
      globals.push(node.text);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      GLOBAL_OBJECTS.has(node.expression.text) &&
      FORBIDDEN_GLOBALS.has(node.name.text)
    ) {
      globals.push(`${node.expression.text}.${node.name.text}`);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      GLOBAL_OBJECTS.has(node.expression.text)
    ) {
      const key = literalText(node.argumentExpression);
      if (key !== undefined && FORBIDDEN_GLOBALS.has(key)) globals.push(`${node.expression.text}.${key}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { specifiers, globals };
}

/** 파일 하나의 위반 목록. 허용된 폴더 밖을 가리키는 import 와 금지된 전역 사용을 돌려준다. */
export function violationsOf(file: string, source: string, allowed: readonly string[]): string[] {
  const { specifiers, globals } = scanSource(file, source);
  const badImports = specifiers.filter((spec) => {
    if (!spec.startsWith(".")) return true;
    const target = relative(ROOT, resolve(dirname(file), spec)).split(sep).join("/");
    return !allowed.some((dir) => target === dir || target.startsWith(`${dir}/`));
  });
  return [...badImports, ...globals.map((g) => `global:${g}`)];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return isSourceFile(entry.name) ? [full] : [];
  });
}

/** 소스 안의 HTTP 메서드 글자(POST · PUT · PATCH · DELETE). 주석 · 설명 문장 속 낱말은 세지 않고, 문자열 값만 센다. */
export function writeMethodLiterals(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== undefined && /^(post|put|patch|delete)$/i.test(text.trim())) found.push(text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("GitHub 에 쓰는 요청의 경계 (docs/plan/03-github-app.md §2)", () => {
  const AUTH_MODULE = "src/adapters/github/app-auth/app-auth.ts";

  it("POST · PUT · PATCH · DELETE 라는 요청 메서드 값은 src 전체에서 인증 모듈에만 있다 (데이터 리더에는 POST 길이 없다)", () => {
    const files = sourceFiles(join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files
      .map((file) => relative(ROOT, file).split(sep).join("/"))
      .filter((file) => file !== AUTH_MODULE)
      .flatMap((file) => writeMethodLiterals(file, readFileSync(join(ROOT, file), "utf8")).map((m) => `${file} → "${m}"`));
    expect(offenders).toEqual([]);
    expect(writeMethodLiterals(AUTH_MODULE, readFileSync(join(ROOT, AUTH_MODULE), "utf8"))).toEqual(["POST", "POST", "POST"]);
  });

  it("스캐너 자체 시험: 문자열 값의 메서드는 잡고, 설명 문장의 낱말은 잡지 않는다", () => {
    expect(writeMethodLiterals("x.ts", 'fetch(u, { method: "POST" }); const m = `patch`; // POST 를 보내지 않는다')).toEqual(["POST", "patch"]);
    expect(writeMethodLiterals("x.ts", 'const s = "POST 를 보내지 않는다";')).toEqual([]);
  });
});

describe("아키텍처 경계", () => {
  for (const rule of RULES) {
    it(`${rule.layer} 는 ${rule.allowed.join(", ")} 밖을 import 하지 않고, 바깥 세계에 닿는 전역을 쓰지 않는다`, () => {
      const files = sourceFiles(join(ROOT, rule.layer));
      expect(files.length, `${rule.layer} 에 검사할 파일이 있어야 한다`).toBeGreaterThan(0);
      const problems = files.flatMap((file) =>
        violationsOf(file, readFileSync(file, "utf8"), rule.allowed).map((v) => `${relative(ROOT, file)} → ${v}`),
      );
      expect(problems).toEqual([]);
    });
  }

  it("스캐너 자체 시험: 금지된 import 와 전역 사용을 실제로 잡는다", () => {
    const file = join(ROOT, "src/domain/example.ts");
    const source = [
      'import Link from "next/link";',
      'import { readFileSync } from "node:fs";',
      'import type { GitHubReader } from "../ports/github-reader";',
      "import {\n  createMemoryStore,\n} from '../adapters/store/memory/memory-store';",
      'export { x } from "@/somewhere";',
      'import "server-only";',
      'const m = await import("react");',
      'const r = require("pg");',
      "const t = await import(`next/navigation`);", // 백틱
      "const u = require(`undici`);", // 백틱
      'import { a, /* ; */ b } from "next/headers";', // 중괄호 안 주석의 세미콜론
      'import { c, // ; 줄 끝 주석\n  d } from "next/cache";',
      "const name = 'react-dom'; const v = await import(name);", // 문자열이 아닌 동적 import
      'type Config = import("next").NextConfig;', // 타입 위치의 import
      'fetch("https://example.com");', // 전역 fetch
      'globalThis.fetch("https://example.com");',
      'globalThis["fetch"]("https://example.com");',
      "new XMLHttpRequest();",
      "const env = process.env.GITHUB_TOKEN;",
      'import pg from "pg";', // 데이터베이스 드라이버
      'import { createPostgresStore } from "../adapters/store/postgres/postgres-store";', // 저장 어댑터
      'import { prKey } from "./model";', // 허용
    ].join("\n");
    expect(violationsOf(file, source, ["src/domain"])).toEqual([
      "next/link",
      "node:fs",
      "../ports/github-reader",
      "../adapters/store/memory/memory-store",
      "@/somewhere",
      "server-only",
      "react",
      "pg",
      "next/navigation",
      "undici",
      "next/headers",
      "next/cache",
      NON_LITERAL_IMPORT,
      "next",
      "pg",
      "../adapters/store/postgres/postgres-store",
      "global:fetch",
      "global:globalThis.fetch",
      "global:globalThis.fetch",
      "global:XMLHttpRequest",
      "global:process",
    ]);
    // 줄 순서와 무관하게 두 가지를 확인한다: 드라이버 pg 와 postgres 어댑터 import 도 잡는다
    const fromApplication = violationsOf(join(ROOT, "src/application/example.ts"), source, ["src/domain", "src/application", "src/ports"]);
    expect(fromApplication).toContain("pg");
    expect(fromApplication).toContain("../adapters/store/postgres/postgres-store");
  });

  it("스캐너 자체 시험: 주석 · 문자열 · 속성 이름에는 속지 않는다", () => {
    const file = join(ROOT, "src/application/example.ts");
    const source = [
      '// import x from "pg";',
      '/* const y = require("pg"); */',
      "const s = \"import z from 'pg'\";",
      "interface Port { fetch(url: string): Promise<unknown>; process: number }",
      "const deps = { reader: { fetch: async () => 1 } }; await deps.reader.fetch();",
      'import { syncAll } from "./sync";',
      'import type { StudioStore } from "../ports/studio-store";',
    ].join("\n");
    expect(violationsOf(file, source, ["src/domain", "src/application", "src/ports"])).toEqual([]);
  });

  it("스캐너 자체 시험: .mts · .cts 파일도 검사 대상이다", () => {
    for (const name of ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"]) expect(isSourceFile(name)).toBe(true);
    for (const name of ["a.css", "a.md", "a.json"]) expect(isSourceFile(name)).toBe(false);
    expect(violationsOf(join(ROOT, "src/domain/x.mts"), 'import "next/link";', ["src/domain"])).toEqual(["next/link"]);
  });
});
