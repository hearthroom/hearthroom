import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bearer, myRolesOnUpstream, resetDb, restoreUpstream, role } from "./helpers";
import { upstream } from "../src/upstream";
import { orderTipLinks, parseTipLink, readTipLinks, resolveTipInput } from "../shared/tip-links";

describe("parseTipLink", () => {
  it("recognizes each platform's profile page and rebuilds one canonical URL", () => {
    const cases: [string, string, string, string][] = [
      ["https://www.patreon.com/c/night_ferry/posts", "patreon", "night_ferry", "https://www.patreon.com/night_ferry"],
      ["patreon.com/nightferry", "patreon", "nightferry", "https://www.patreon.com/nightferry"],
      ["https://nightferry.fanbox.cc/posts/123", "fanbox", "nightferry", "https://www.fanbox.cc/@nightferry"],
      ["https://www.fanbox.cc/@night_ferry", "fanbox", "night_ferry", "https://www.fanbox.cc/@night_ferry"],
      ["https://fantia.jp/fanclubs/12345", "fantia", "12345", "https://fantia.jp/fanclubs/12345"],
      ["http://ko-fi.com/nightferry?ref=x", "kofi", "nightferry", "https://ko-fi.com/nightferry"],
      ["https://www.buymeacoffee.com/nightferry", "buymeacoffee", "nightferry", "https://buymeacoffee.com/nightferry"],
      ["https://onlyfans.com/night.ferry", "onlyfans", "night.ferry", "https://onlyfans.com/night.ferry"],
      ["https://subscribestar.adult/nightferry", "subscribestar", "nightferry", "https://subscribestar.adult/nightferry"],
      ["https://www.subscribestar.com/nightferry", "subscribestar", "nightferry", "https://www.subscribestar.com/nightferry"],
    ];
    for (const [input, platform, handle, url] of cases) {
      expect(parseTipLink(input), input).toEqual({ ok: true, link: { platform, handle, url } });
    }
  });

  it("accepts a Patreon profile that has no custom name", () => {
    expect(parseTipLink("https://www.patreon.com/user?u=12345678")).toEqual({ ok: true, link: { platform: "patreon", handle: "12345678", url: "https://www.patreon.com/user?u=12345678" } });
    expect(parseTipLink("https://www.patreon.com/user")).toEqual({ ok: false, reason: "not_profile", platform: "patreon" });
  });

  it("builds the profile URL when the author types only a username for the chosen platform", () => {
    expect(resolveTipInput("fanbox", "@nightferry")).toEqual({ ok: true, link: { platform: "fanbox", handle: "nightferry", url: "https://www.fanbox.cc/@nightferry" } });
    expect(resolveTipInput("onlyfans", "night.ferry")).toEqual({ ok: true, link: { platform: "onlyfans", handle: "night.ferry", url: "https://onlyfans.com/night.ferry" } });
    expect(resolveTipInput("fantia", "12345")).toMatchObject({ ok: true, link: { url: "https://fantia.jp/fanclubs/12345" } });
    expect(resolveTipInput("subscribestar", "nightferry")).toMatchObject({ ok: true, link: { url: "https://subscribestar.adult/nightferry" } });
    // 貼的是網址就照網址認，即使是另一個平台
    expect(resolveTipInput("fanbox", "ko-fi.com/nightferry")).toMatchObject({ ok: true, link: { platform: "kofi" } });
    expect(resolveTipInput("fanbox", "bit.ly")).toEqual({ ok: false, reason: "shortener" });
    expect(resolveTipInput("fantia", "abc")).toEqual({ ok: false, reason: "not_profile", platform: "fantia" });
    expect(resolveTipInput("kofi", "   ")).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses anything that is not a recognized profile page", () => {
    expect(parseTipLink("https://bit.ly/3xYz")).toEqual({ ok: false, reason: "shortener" });
    expect(parseTipLink("https://linktr.ee/nightferry")).toEqual({ ok: false, reason: "shortener" });
    expect(parseTipLink("https://paypal.me/nightferry")).toEqual({ ok: false, reason: "unsupported" });
    // 愛發電不收：要實名、走國內金流，掛在成人卡旁邊會把作者的身分和收入綁在一起（owner 2026-10-11）
    expect(parseTipLink("https://afdian.com/a/nightferry")).toEqual({ ok: false, reason: "unsupported" });
    expect(parseTipLink("https://www.patreon.com/")).toEqual({ ok: false, reason: "not_profile", platform: "patreon" });
    expect(parseTipLink("https://www.patreon.com/login")).toEqual({ ok: false, reason: "not_profile", platform: "patreon" });
    expect(parseTipLink("https://fantia.jp/posts/1")).toEqual({ ok: false, reason: "not_profile", platform: "fantia" });
    expect(parseTipLink("javascript:alert(1)")).toEqual({ ok: false, reason: "invalid" });
    expect(parseTipLink("https://user:pw@ko-fi.com/x")).toEqual({ ok: false, reason: "invalid" });
    expect(parseTipLink("https://ko-fi.com.evil.example/x")).toEqual({ ok: false, reason: "unsupported" });
    expect(parseTipLink("ko-fi.com/a b")).toEqual({ ok: false, reason: "invalid" });
  });

  it("orders links by how familiar readers are with the platform, not by input order", () => {
    const stored = JSON.stringify(["https://ko-fi.com/a", "https://www.subscribestar.com/b", "https://www.fanbox.cc/@c"]);
    expect(readTipLinks(stored).map((l) => l.platform)).toEqual(["fanbox", "kofi", "subscribestar"]);
    expect(orderTipLinks([{ platform: "patreon" }, { platform: "onlyfans" }] as const).map((l) => l.platform)).toEqual(["onlyfans", "patreon"]);
    // 壞資料與下架的平台都不顯示
    expect(readTipLinks("not json")).toEqual([]);
    expect(readTipLinks(JSON.stringify(["https://afdian.com/a/x", 3]))).toEqual([]);
  });
});

describe("tip links on the profile", () => {
  beforeEach(async () => {
    await resetDb();
    myRolesOnUpstream({ valid: [] });
    vi.spyOn(upstream, "fetchMe").mockResolvedValue({ accountNumId: 22, nickName: "Harper name", avatar: "https://example.com/avatar.png" });
    vi.spyOn(upstream, "setNickname").mockResolvedValue("ok");
  });
  afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });

  const me = async () => (await (await SELF.fetch("https://c.test/v1/me", { headers: bearer("valid") })).json()) as any;
  const put = (body: unknown) => SELF.fetch("https://c.test/v1/me/profile", { method: "PUT", headers: { ...bearer("valid"), "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("saves canonical links, keeps them when a client omits the field, and clears them on an empty list", async () => {
    await me();
    const r = await put({ displayName: "Author", bio: "", tipLinks: ["ko-fi.com/nightferry", "https://nightferry.fanbox.cc", ""] });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).tipLinks).toEqual(["https://www.fanbox.cc/@nightferry", "https://ko-fi.com/nightferry"]);

    // 舊版客戶端只送名字與簡介：連結不能因此被清掉
    expect((await put({ displayName: "Author", bio: "new bio" })).status).toBe(200);
    expect((await me()).tipLinks).toEqual(["https://www.fanbox.cc/@nightferry", "https://ko-fi.com/nightferry"]);

    expect((await put({ displayName: "Author", bio: "", tipLinks: [] })).status).toBe(200);
    expect((await me()).tipLinks).toEqual([]);
  });

  it("accepts links from the multipart form the site sends", async () => {
    await me();
    const form = new FormData();
    form.set("displayName", "Author");
    form.set("bio", "");
    form.set("tipLinks", JSON.stringify(["https://www.patreon.com/nightferry"]));
    const r = await SELF.fetch("https://c.test/v1/me/profile", { method: "PUT", headers: bearer("valid"), body: form });
    expect(r.status).toBe(200);
    expect((await me()).tipLinks).toEqual(["https://www.patreon.com/nightferry"]);
  });

  it("rejects an unsupported site, a shortener and more than three links without changing anything", async () => {
    await me();
    await put({ displayName: "Author", bio: "", tipLinks: ["https://ko-fi.com/keep"] });
    for (const tipLinks of [["https://paypal.me/x"], ["https://bit.ly/x"], ["https://afdian.com/a/x"], ["https://ko-fi.com/a", "https://ko-fi.com/b", "https://ko-fi.com/c", "https://ko-fi.com/d"], "not json", [3]]) {
      const r = await put({ displayName: "Changed", bio: "", tipLinks });
      expect(r.status, JSON.stringify(tipLinks)).toBe(400);
      expect(((await r.json()) as any).error).toBe("tipLinks_invalid");
    }
    const after = await me();
    expect(after.displayName).toBe("Author");
    expect(after.tipLinks).toEqual(["https://ko-fi.com/keep"]);
  });

  it("shows the links on the public card and the author page, and the author page updates right after a change", async () => {
    const profile = await me();
    await put({ displayName: "Author", bio: "", tipLinks: ["https://ko-fi.com/nightferry", "https://onlyfans.com/nightferry"] });
    const { upsertCard } = await import("../src/cards");
    await upsertCard(env.DB, role({ roleId: "tip-card", authorNumId: 22 }), Date.now(), { status: "approved" });

    const card = (await (await SELF.fetch("https://c.test/v1/cards/tip-card")).json()) as any;
    expect(card.author.tips).toEqual([
      { platform: "onlyfans", handle: "nightferry", url: "https://onlyfans.com/nightferry" },
      { platform: "kofi", handle: "nightferry", url: "https://ko-fi.com/nightferry" },
    ]);
    // 榜單不帶：一頁幾十張卡用不到
    const board = (await (await SELF.fetch("https://c.test/v1/cards")).json()) as any;
    expect(board.items[0].author.tips).toBeUndefined();

    const author = async () => (await (await SELF.fetch(`https://c.test/v1/authors/${profile.handle}`)).json()) as any;
    expect((await author()).tips.map((t: any) => t.platform)).toEqual(["onlyfans", "kofi"]);
    // 作者頁走公開快照：改了連結要立刻換版，不能等快照過期
    await put({ displayName: "Author", bio: "", tipLinks: ["https://www.patreon.com/nightferry"] });
    expect((await author()).tips).toEqual([{ platform: "patreon", handle: "nightferry", url: "https://www.patreon.com/nightferry" }]);
  });
});
