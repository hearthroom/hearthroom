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
      "/open/v1/worldbook/detail": { name: "世界書", description: "說明", format: "harbor" },
      "/open/v1/worldbook/entry/list": { entries: [
        { name: "常駐", content: "常駐內容", keywords: ["a"], isConstant: true },
        { name: "停用", content: "停用內容", isEnabled: false },
      ] },
      "/open/v1/role/author-asset": 404,
    });
    const d = (await readForReview(env, "author-token", "role-1", "harbor")) as any;
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
    const a = await readForReview(env, "t", "role-1", "harbor");
    const b = await readForReview(env, "t", "role-1", "harbor");
    expect(a.hashes).toEqual(b.hashes);
    provider({ ...routes, "/open/v1/role/detail": { ...own, roleDetailDesc: "改過了" } });
    const c = await readForReview(env, "t", "role-1", "harbor");
    expect(c.hashes.content).not.toBe(a.hashes.content);
    expect(c.hashes.welcome).toBe(a.hashes.welcome);
  });

  it("讀回來沒有私有設定（不是作者本人）→ 409；token 被拒 → 401", async () => {
    const { roleDetailDesc: _private, ...publicOnly } = own;
    provider({ "/open/v1/role/detail": publicOnly });
    await expect(readForReview(env, "t", "role-1", "harbor")).rejects.toMatchObject({ status: 409 });
    provider({ "/open/v1/role/detail": 403 });
    const err = await readForReview(env, "t", "role-1", "harbor").catch((e) => e);
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
    expect(await publicHash({ ...base, avatarUrl: "https://assets.harperharbor.com/other.png" })).not.toBe(h);
  });

  it("分享圖只在有的時候才進指紋：沒有分享圖的卡，指紋一個位元都不變", async () => {
    const base = role({ roleId: "role-1" });
    // 釘死現有的值：加欄位之前就過審的卡，同步時算出來的指紋必須跟過審時記下的一樣，不然整批被當成改過
    const pinned = "pub1:137d3e63e0a417b0852ce648af23eda094768a0eea54aa772ea1620c14a361a6";
    expect(await publicHash(base)).toBe(pinned);
    expect(await publicHash({ ...base, shareImageUrl: null })).toBe(pinned);
    expect(await publicHash({ ...base, shareImageUrl: "" })).toBe(pinned);
    const withShare = await publicHash({ ...base, shareImageUrl: "https://assets.harperharbor.com/share.png" });
    expect(withShare).not.toBe(pinned);
    expect(await publicHash({ ...base, shareImageUrl: "https://assets.harperharbor.com/other-share.png" })).not.toBe(withShare);
  });

  it("橫式背景同理：沒有就不進指紋，有才算", async () => {
    const base = role({ roleId: "role-1" });
    const pinned = "pub1:137d3e63e0a417b0852ce648af23eda094768a0eea54aa772ea1620c14a361a6";
    expect(await publicHash({ ...base, backgroundLandscapeUrl: null })).toBe(pinned);
    expect(await publicHash({ ...base, backgroundLandscapeUrl: "" })).toBe(pinned);
    const withLandscape = await publicHash({ ...base, backgroundLandscapeUrl: "https://assets.harperharbor.com/land.png" });
    expect(withLandscape).not.toBe(pinned);
    // 兩個欄位各有各的位置：同一個網址放在分享圖或橫式背景，指紋不同
    expect(await publicHash({ ...base, shareImageUrl: "https://assets.harperharbor.com/land.png" })).not.toBe(withLandscape);
  });
});

describe("token 估算", () => {
  it("中日韓一字一個，其餘四個字元一個", () => {
    expect(estimateTokens("夜行偵探")).toBe(4);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});

// 審核副本存進 D1（單列上限 2 MB）。大型世界模擬卡的原文超過 1.5 MB 很常見（例：205 條世界書 + 作者版面），
// 但文字壓縮後遠小於此；以前存原文，這類卡一送審就 card_too_large_for_review。
import { loadSnapshot, saveSnapshotStatement, SNAPSHOT_MAX_BYTES } from "../src/review-snapshot";
describe("審核副本的大小", () => {
  const big = () => ({ document: { roleDetailDesc: "角色設定".repeat(20_000) }, worldbooks: [{ entries: Array.from({ length: 200 }, (_, i) => ({ name: `條目${i}`, content: "世界設定的一段描述，".repeat(400) })) }] });
  it("存得下原文超過上限、但壓縮後不大的卡，讀回完全一樣", async () => {
    const detail = big();
    expect(new TextEncoder().encode(JSON.stringify(detail)).length).toBeGreaterThan(SNAPSHOT_MAX_BYTES);
    await env.DB.prepare("DELETE FROM review_snapshots").run();
    await (await saveSnapshotStatement(env.DB, "sub-big", detail as never, 1)).run();
    expect(await loadSnapshot(env.DB, "sub-big")).toEqual(detail);
  });
  it("舊的未壓縮副本照樣讀得回來", async () => {
    await env.DB.prepare("INSERT INTO review_snapshots (submission_id, detail, created_at) VALUES ('sub-old', ?, 1)").bind(JSON.stringify({ a: 1 })).run();
    expect(await loadSnapshot(env.DB, "sub-old")).toEqual({ a: 1 });
  });
  it("壓縮後仍然太大才拒絕", async () => {
    const noise = Array.from({ length: 1_600_000 }, () => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join("");
    await expect(saveSnapshotStatement(env.DB, "sub-noise", { document: { roleDetailDesc: noise } } as never, 1)).rejects.toMatchObject({ message: "card_too_large_for_review" });
  });
});
