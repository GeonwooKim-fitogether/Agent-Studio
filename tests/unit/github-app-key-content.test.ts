/**
 * 비밀 키를 환경변수 **내용**으로 받기 (클라우드 환경용, GITHUB_APP_PRIVATE_KEY).
 * 세 형태(줄바꿈 그대로 · `\n` 두 글자 · base64)를 같은 키로 읽고, 형식이 틀리면 키 조각 없이 안내만 한다.
 * 시험용 키는 여기서 만들고 파일로 저장하지 않는다.
 */
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createContainer, normalizePrivateKeyContent, selectAppSource } from "../../src/server/container";

const keyPair = (modulusLength: number) =>
  generateKeyPairSync("rsa", {
    modulusLength,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
const PEM = keyPair(2048);
const ids = { GITHUB_APP_ID: "5089642", GITHUB_APP_INSTALLATION_ID: "165265737" };
const UNREADABLE = "GITHUB_APP_PRIVATE_KEY 의 형식을 읽지 못했다 — .pem 파일 내용 전체(BEGIN · END 줄 포함, RSA 2048비트 이상)를 붙여 넣는다.";

/** 두 PEM 이 같은 키인가 (글자 모양이 아니라 키로 비교) */
const sameKey = (a: string, b: string) =>
  createPrivateKey(a).export({ type: "pkcs8", format: "der" }).equals(createPrivateKey(b).export({ type: "pkcs8", format: "der" }));

describe("GITHUB_APP_PRIVATE_KEY — 비밀 키 내용으로 받기", () => {
  it.each([
    ["줄바꿈이 그대로 든 PEM", PEM],
    ["줄바꿈이 \\n 두 글자로 바뀐 PEM (한 줄 칸)", PEM.trim().replace(/\n/g, "\\n")],
    ["base64 로 감싼 PEM", Buffer.from(PEM, "utf8").toString("base64")],
    ["줄마다 끊긴 base64", Buffer.from(PEM, "utf8").toString("base64").replace(/(.{64})/g, "$1\n")],
    ["CRLF 와 앞뒤 공백이 붙은 PEM", `  \r\n${PEM.replace(/\n/g, "\r\n")}  \r\n`],
    ["\\r\\n 네 글자로 바뀐 PEM", PEM.trim().replace(/\n/g, "\\r\\n")],
    ["줄바꿈이 공백으로 바뀐 PEM (한 줄 칸)", PEM.trim().replace(/\n/g, " ")],
    ["줄바꿈이 아예 사라진 PEM (한 줄 칸)", PEM.trim().replace(/\n/g, "")],
    ["줄바꿈이 사라진 PEM 을 base64 로 감싼 것", Buffer.from(PEM.trim().replace(/\n/g, "")).toString("base64")],
    ["본문 줄 길이가 64자가 아닌 PEM", PEM.replace(/\n(?!-)/g, "").replace(/(-----\n?)([A-Za-z0-9+/=]{76})/, "$1$2\n")],
  ])("%s 를 같은 키로 읽는다", (_, content) => {
    const source = selectAppSource({ ...ids, GITHUB_APP_PRIVATE_KEY: content });
    expect(source).toMatchObject({ kind: "app", appId: 5089642, installationId: 165265737 });
    if (source?.kind !== "app") throw new Error("App 출처가 아니다");
    expect(sameKey(source.privateKeyPem, PEM)).toBe(true);
  });

  it("경로와 내용이 둘 다 있으면 어느 것을 쓸지 모호하므로 설정 오류 — 내용은 싣지 않는다", () => {
    const source = selectAppSource({ ...ids, GITHUB_APP_PRIVATE_KEY: PEM, GITHUB_APP_PRIVATE_KEY_PATH: "/secure/app.pem" }, () => PEM);
    expect(source?.kind).toBe("app_config_error");
    expect(JSON.stringify(source)).toContain("둘 다 있어");
    expect(JSON.stringify(source)).not.toContain("PRIVATE KEY-----");
  });

  const SECRET_FRAGMENT = "MIIEvQSECRETFRAGMENTxyz";
  const body = PEM.split("\n").slice(1, 4).join("");
  it.each([
    ["아무 글자", `not a key ${SECRET_FRAGMENT}`],
    ["BEGIN 줄만 있고 몸통이 망가진 PEM", ["-----BEGIN", "PRIVATE KEY-----", SECRET_FRAGMENT, "-----END PRIVATE KEY-----"].join("\n")],
    ["앞 절반만 붙여 넣은 PEM", PEM.slice(0, Math.floor(PEM.length / 2))],
    ["PEM 이 아닌 것을 base64 로 감싼 것", Buffer.from(`hello ${SECRET_FRAGMENT}`).toString("base64")],
    ["BEGIN 줄 없이 몸통만", body],
    ["1024비트 키", keyPair(1024)],
  ])("형식이 틀리면(%s) 고정된 안내만 보인다 — 내용 · 길이 · 앞부분이 없다", (_, content) => {
    const source = selectAppSource({ ...ids, GITHUB_APP_PRIVATE_KEY: content });
    expect(source).toEqual({ kind: "app_config_error", message: UNREADABLE });
    const text = JSON.stringify(source);
    expect(text).not.toContain(SECRET_FRAGMENT);
    expect(text).not.toContain(body.slice(0, 16));
    expect(text).not.toContain(String(content.length));
  });

  it("64KB 를 넘는 내용은 읽지 않는다", () => {
    expect(selectAppSource({ ...ids, GITHUB_APP_PRIVATE_KEY: "A".repeat(70_000) })).toEqual({
      kind: "app_config_error",
      message: "GITHUB_APP_PRIVATE_KEY 가 너무 크다(64KB 초과).",
    });
  });

  it("붙여 넣을 때 생긴 CRLF · 앞뒤 공백을 정리해 줄바꿈이 LF 뿐인 PEM 으로 되돌린다", () => {
    const pem = normalizePrivateKeyContent(`  \r\n${PEM.replace(/\n/g, "\r\n")}  `);
    expect(pem).toBe(PEM.trim() + "\n");
    expect(pem).not.toContain("\r");
  });

  it("머리 · 꼬리의 종류(RSA PRIVATE KEY)를 그대로 두고 본문을 64자마다 다시 줄바꿈한다", () => {
    const pkcs1 = createPrivateKey(PEM).export({ type: "pkcs1", format: "pem" }).toString();
    const oneLine = pkcs1.trim().replace(/\n/g, " ");
    const rebuilt = normalizePrivateKeyContent(oneLine);
    expect(rebuilt).toBe(pkcs1.trim() + "\n");
    expect(rebuilt?.startsWith(["-----BEGIN RSA", "PRIVATE KEY-----\n"].join(" "))).toBe(true); // 저장소 비밀 검사에 걸리지 않게 조각으로
    const source = selectAppSource({ ...ids, GITHUB_APP_PRIVATE_KEY: oneLine });
    if (source?.kind !== "app") throw new Error("App 출처가 아니다");
    expect(sameKey(source.privateKeyPem, PEM)).toBe(true);
  });

  it("머리와 꼬리의 종류가 다르거나 꼬리가 없으면 읽지 않는다 — 안내에 키 조각이 없다", () => {
    const body = PEM.split("\n").slice(1, -2).join("");
    for (const content of [
      ["-----BEGIN RSA", "PRIVATE KEY-----", body, "-----END PRIVATE KEY-----"].join(" "),
      ["-----BEGIN", "PRIVATE KEY-----", body].join(" "),
      ["-----BEGIN EC", "PRIVATE KEY-----", body, "-----END EC PRIVATE KEY-----"].join(" "),
    ]) {
      const source = selectAppSource({ ...ids, GITHUB_APP_PRIVATE_KEY: content });
      expect(source).toEqual({ kind: "app_config_error", message: UNREADABLE });
      expect(JSON.stringify(source)).not.toContain(body.slice(0, 12));
      expect(JSON.stringify(source)).not.toContain(body.slice(-12));
    }
  });

  it("PEM 으로 볼 수 없는 값은 null (정리 함수)", () => {
    expect(normalizePrivateKeyContent("")).toBeNull();
    expect(normalizePrivateKeyContent("   ")).toBeNull();
    expect(normalizePrivateKeyContent("not/base64!")).toBeNull();
  });

  it("조립부는 내용으로 받은 키로 App 리더를 만들고, 설정 오류가 없다", () => {
    const container = createContainer({ ...ids, GITHUB_APP_PRIVATE_KEY: Buffer.from(PEM).toString("base64") });
    expect(container.deps.reader.source).toBe("github_app");
    expect(container.configError).toBeNull();
    expect(container.status().lastError).toBeNull();
  });
});
