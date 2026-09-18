import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/types";
import { estimateTokens, publicHash, readForReview } from "../src/review-snapshot";
import { role } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const own = {
  characterRoleId: "role-1", accountNumId: 10001, roleName: "夜行偵探", roleDesc: "民國背景推理",
  roleDetailDesc: "作者的詳細設定", customInstructions: "自訂指示", roleWelcome: "開場白",
  welcomeAlternates: JSON.stringify(["備選一", ""]), roleTag: ["推理"], language: "zh-Hans", talkExample: [],
};

/** 假供應商：照路徑回應，順手記下每個請求帶了什麼。 */
function provider(routes: Record<string, unknown | number>) {
  const seen: { path: string; auth: string | null }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    seen.push({ path: u.pathname, auth: new Headers(init?.headers).get("Authorization") });
    const hit = routes[u.pathname];
    if (typeof hit === "number") return new Response("{}", { status: hit });
    if (hit === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(hit), { status: 200 });
  });
  return seen;
}

describe("送審時讀整份設定", () => {
  it("只用作者的 token、只打公開契約的讀取路徑；組成審核頁要的形狀", async () => {
    const seen = provider({
      "/open/v1/role/detail": own,
      "/open/v1/worldbook/bindings": { bindings: [{ worldbookId: "wb-1" }] },
      "/open/v1/worldbook/detail": { name: "世界書", description: "說明", format: "lunatalk" },
      "/open/v1/worldbook/entry/list": { entries: [
        { name: "常駐", content: "常駐內容", keywords: ["a"], isConstant: true },
        { name: "停用", content: "停用內容", isEnabled: false },
      ] },
      "/open/v1/role/author-asset": 404,
    });
    const d = (await readForReview(env, "author-token", "role-1", "lunatalk")) as any;
    expect(seen.every((r) => r.auth === "Bearer author-token")).toBe(true);
    expect(seen.map((r) => r.path)).toEqual([
      "/open/v1/role/detail", "/open/v1/worldbook/bindings", "/open/v1/worldbook/detail", "/open/v1/worldbook/entry/list", "/open/v1/role/author-asset",
    ]);
    expect(d.document).toMatchObject({ roleName: "夜行偵探", roleDetailDesc: "作者的詳細設定", customInstructions: "自訂指示" });
    expect(d.greetings).toEqual({ welcome: "開場白", alternates: ["備選一"], prologue: [] });
    expect(d.worldbook).toMatchObject({ worldbookId: "wb-1", name: "世界書" });
    expect(d.worldbook.entries).toHaveLength(2);
    expect(d.authorAsset).toMatchObject({ rules: [], pageMode: "classic" });
    expect(d.costProfile).toMatchObject({ worldbookEntryCount: 2, worldbookEnabledCount: 1, worldbookConstantCount: 1 });
    expect(d.hashes.content).toMatch(/^sha256:[0-9a-f]{64}$/);
    // 作者身分不進快照（盲審）
    expect(JSON.stringify(d)).not.toContain("10001");
  });

  it("同一份設定算兩次雜湊一樣；改了設定就不一樣", async () => {
    const routes = { "/open/v1/role/detail": own, "/open/v1/worldbook/bindings": { bindings: [] } };
    provider(routes);
    const a = await readForReview(env, "t", "role-1", "lunatalk");
    const b = await readForReview(env, "t", "role-1", "lunatalk");
    expect(a.hashes).toEqual(b.hashes);
    provider({ ...routes, "/open/v1/role/detail": { ...own, roleDetailDesc: "改過了" } });
    const c = await readForReview(env, "t", "role-1", "lunatalk");
    expect(c.hashes.content).not.toBe(a.hashes.content);
    expect(c.hashes.welcome).toBe(a.hashes.welcome);
  });

  it("讀回來沒有私有設定（不是作者本人）→ 409；token 被拒 → 401", async () => {
    const { roleDetailDesc: _private, ...publicOnly } = own;
    provider({ "/open/v1/role/detail": publicOnly });
    await expect(readForReview(env, "t", "role-1", "lunatalk")).rejects.toMatchObject({ status: 409 });
    provider({ "/open/v1/role/detail": 403 });
    const err = await readForReview(env, "t", "role-1", "lunatalk").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(401);
  });
});

describe("公開指紋", () => {
  it("只看訪客看得到的欄位：熱度變了不算，名字變了才算", async () => {
    const base = role({ roleId: "role-1" });
    const h = await publicHash(base);
    expect(h).toMatch(/^pub1:[0-9a-f]{64}$/);
    expect(await publicHash({ ...base, talkNum: 999, followNum: 9 })).toBe(h);
    expect(await publicHash({ ...base, names: { ...base.names, zh: "改名了" } })).not.toBe(h);
    expect(await publicHash({ ...base, avatarUrl: "https://cdn.lunatalk.ai/other.png" })).not.toBe(h);
  });
});

describe("token 估算", () => {
  it("中日韓一字一個，其餘四個字元一個", () => {
    expect(estimateTokens("夜行偵探")).toBe(4);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
