/**
 * 推廣貼文逐篇歸因（任務 2026-11-25-post-attribution，lib/promo-post.ts）：
 * 沒登入時點進帶 utm_campaign 的網址，記下代號（最後一個）與第一次點的時間、放 30 天；
 * 登入後送一次綁定，有結論（200 或 4xx）就清掉，網路錯誤、5xx、401／403／429 留著下次再試。
 * 只存代號與時間；推薦碼、活動分享碼照舊各走各的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ session: null as any }));
vi.mock("../src/lib/session", () => ({ useSession: () => holder.session }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));

import { nextTick, reactive } from "vue";
import { router } from "../src/router";
import { bindPromoPost, pendingPromoPost, promoPostFromUrl, rememberPromoPost, watchPromoPostBinding } from "../src/lib/promo-post";

const DAY = 86_400_000;
const clicked = Date.parse("2026-11-26T08:00:00Z");
type Call = { url: string; init: RequestInit };
let calls: Call[];
let reply: () => Response | Promise<Response>;
const binds = () => calls.filter((c) => c.url === "/v1/me/promo-attribution" && c.init.method === "POST");
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const settle = async () => { for (let i = 0; i < 20; i++) { await nextTick(); await Promise.resolve(); } };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clicked);
  calls = [];
  reply = () => json(200, { bound: true });
  holder.session = reactive({ ready: true, me: null as null | { accountNumId: number }, restore: async () => undefined, accessToken: vi.fn(async () => "tok") });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return reply(); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("記下貼文代號", () => {
  it("只收單一、格式合法的 utm_campaign", () => {
    expect(promoPostFromUrl("https://sukisuki.ai/cards/1?utm_campaign=bh-dnd-2206-20261105")).toBe("bh-dnd-2206-20261105");
    expect(promoPostFromUrl("https://sukisuki.ai/?utm_campaign=Bad%20Code")).toBeNull();
    expect(promoPostFromUrl("https://sukisuki.ai/?utm_campaign=a&utm_campaign=b")).toBeNull();
    expect(promoPostFromUrl("https://sukisuki.ai/?ref=ABCD1234")).toBeNull();
  });

  it("代號算最後一個，時間留第一次點的；30 天後失效", () => {
    rememberPromoPost("post-a", clicked);
    rememberPromoPost("post-b", clicked + DAY);
    expect(pendingPromoPost(clicked + DAY)).toEqual({ campaign: "post-b", at: clicked });
    expect(pendingPromoPost(clicked + 31 * DAY)).toBeNull();
  });

  it("沒登入點進來才記，登入中的人不記；網址上的 utm 不動", async () => {
    await router.push("/");
    await router.push("/cards/100192?utm_source=bahamut&utm_medium=forum&utm_campaign=bh-dnd-trpg-explore-20261126");
    expect(pendingPromoPost()?.campaign).toBe("bh-dnd-trpg-explore-20261126");
    localStorage.clear();
    localStorage.setItem("hearthroom.signedIn", "7");
    await router.push("/cards/100192?utm_campaign=bh-dnd-2206-20261105");
    expect(pendingPromoPost()).toBeNull();
  });
});

describe("登入後綁定", () => {
  it("送代號與第一次點的時間；200 清掉紀錄", async () => {
    rememberPromoPost("bh-dnd-2206-20261105", clicked - DAY);
    expect(await bindPromoPost(async () => "tok")).toBe("bound");
    expect(binds()).toHaveLength(1);
    expect(JSON.parse(String(binds()[0].init.body))).toEqual({ campaign: "bh-dnd-2206-20261105", firstSeenAt: clicked - DAY });
    expect((binds()[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(pendingPromoPost()).toBeNull();
  });

  it("4xx 是結論也清掉；5xx、429、網路錯誤留著下次再試", async () => {
    rememberPromoPost("post-a", clicked);
    reply = () => json(400, { error: "invalid_arguments" });
    expect(await bindPromoPost(async () => "tok")).toBe("done");
    expect(pendingPromoPost()).toBeNull();
    // 404：網站比伺服器先上線（或回退）時端點還不在，留著等伺服器到位
    for (const status of [500, 429, 401, 404]) {
      rememberPromoPost("post-a", clicked);
      reply = () => json(status, {});
      expect(await bindPromoPost(async () => "tok")).toBe("retry");
      expect(pendingPromoPost()).not.toBeNull();
    }
    reply = () => { throw new TypeError("offline"); };
    expect(await bindPromoPost(async () => "tok")).toBe("retry");
    expect(pendingPromoPost()).not.toBeNull();
  });

  it("掛在 App 上：有人登入且有記下的代號就綁一次", async () => {
    rememberPromoPost("post-a", clicked);
    watchPromoPostBinding();
    await settle();
    expect(binds()).toHaveLength(0);
    holder.session.me = { accountNumId: 9 };
    await settle();
    expect(binds()).toHaveLength(1);
  });
});
