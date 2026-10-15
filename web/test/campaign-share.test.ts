/**
 * 活動分享短碼 ?s=（lib/share-ref.ts）：合法才記、算最後一個、放 30 天；
 * 記下時送一次訪客計數（同碼同 UTC 日只送一次），再從網址拿掉；
 * 登入後送一次綁定，有結論（200 或 4xx）就清掉，網路錯誤或 5xx 留著下次再試。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ session: null as any }));
vi.mock("../src/lib/session", () => ({ useSession: () => holder.session }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));

import { nextTick, reactive } from "vue";
import { router } from "../src/router";
import {
  SHARE_REF_TTL, bindCampaignShare, campaignShareFromQuery, forgetCampaignShare, noteCampaignShare, pendingCampaignShare, rememberCampaignShare, watchCampaignShareBinding,
} from "../src/lib/share-ref";

const DAY = 86_400_000;
const clicked = Date.parse("2026-10-15T08:00:00Z");
type Call = { url: string; init: RequestInit };
let calls: Call[];
let reply: () => Response | Promise<Response>;
const posts = (path: string) => calls.filter((c) => c.url === path && c.init.method === "POST");
const visitsSent = () => posts("/v1/campaign/visits").map((c) => JSON.parse(String(c.init.body)).s);
const binds = () => posts("/v1/me/campaign/attribution");
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const settle = async () => { for (let i = 0; i < 20; i++) { await nextTick(); await Promise.resolve(); } };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clicked);
  calls = [];
  reply = () => json(200, { bound: true });
  holder.session = reactive({ ready: true, me: null as null | { accountNumId: number }, restore: async () => undefined, accessToken: vi.fn(async () => "tok") });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url === "/v1/campaign/visits") return new Response(null, { status: 204 });
    return reply();
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("記下網址上的分享碼", () => {
  it("只收 8 碼大寫英數", () => {
    expect(campaignShareFromQuery("AB12CD34")).toBe("AB12CD34");
    expect(campaignShareFromQuery(" ab12cd34 ")).toBe("AB12CD34");
    expect(campaignShareFromQuery("AB12")).toBeNull();
    expect(campaignShareFromQuery("AB12CD34X")).toBeNull();
    expect(campaignShareFromQuery(["AB12CD34"])).toBeNull();
  });

  it("點了好幾個連結算最後一個，時間留第一次點的；30 天後作廢", () => {
    rememberCampaignShare("FIRST234", clicked);
    rememberCampaignShare("LAST2345", clicked + 1000);
    // 後來的點擊不能把第一次來站的時間往後推，否則點完才註冊的人會被當成老玩家
    expect(pendingCampaignShare(clicked + 2000)).toEqual({ code: "LAST2345", at: clicked });
    expect(pendingCampaignShare(clicked + SHARE_REF_TTL)).toBeNull();
    // 舊紀錄過期了就重新起算
    rememberCampaignShare("NEW23456", clicked + SHARE_REF_TTL + 5);
    expect(pendingCampaignShare(clicked + SHARE_REF_TTL + 6)).toEqual({ code: "NEW23456", at: clicked + SHARE_REF_TTL + 5 });
    forgetCampaignShare();
    expect(pendingCampaignShare()).toBeNull();
  });

  it("記下時送一次訪客計數：同碼同日只送一次，隔天再送，紀錄只留當天的", () => {
    noteCampaignShare("AB12CD34");
    noteCampaignShare("AB12CD34");
    noteCampaignShare("ZZ99YY88");
    expect(visitsSent()).toEqual(["AB12CD34", "ZZ99YY88"]);
    expect(posts("/v1/campaign/visits")[0].init.keepalive).toBe(true);
    expect(pendingCampaignShare()?.code).toBe("ZZ99YY88");
    vi.setSystemTime(clicked + DAY);
    noteCampaignShare("AB12CD34");
    expect(visitsSent()).toEqual(["AB12CD34", "ZZ99YY88", "AB12CD34"]);
    expect(Object.keys(JSON.parse(localStorage.getItem("hearthroom.campaignShare.visited")!))).toEqual(["AB12CD34"]);
  });

  it("計數送不出去也不影響", () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(() => noteCampaignShare("AB12CD34")).not.toThrow();
    expect(pendingCampaignShare()?.code).toBe("AB12CD34");
  });

  it("進站：合法的 s 記下、送計數、從網址拿掉，其他參數與 ref 的處理照舊", async () => {
    await router.push("/");
    await router.isReady();
    await router.push("/en/campaign/launch?s=AB12CD34&x=1");
    expect(router.currentRoute.value.query).toEqual({ x: "1" });
    expect(pendingCampaignShare()?.code).toBe("AB12CD34");
    expect(visitsSent()).toEqual(["AB12CD34"]);
    await router.push("/en/campaign/launch?s=AB12CD34&ref=FRIEND23");
    expect(router.currentRoute.value.query).toEqual({});
    expect(visitsSent()).toEqual(["AB12CD34"]);
  });

  it("已登入只送計數不記碼（老玩家點了算訪客，不算新玩家），同推薦碼", async () => {
    localStorage.setItem("hearthroom.signedIn", "7");
    await router.push("/en/campaign/launch?s=QQ11WW22");
    expect(router.currentRoute.value.query).toEqual({});
    expect(pendingCampaignShare()).toBeNull();
    expect(visitsSent()).toEqual(["QQ11WW22"]);
    noteCampaignShare("EE33RR44");
    expect(pendingCampaignShare()).toBeNull();
    expect(visitsSent()).toEqual(["QQ11WW22", "EE33RR44"]);
  });
});

describe("登入後綁定", () => {
  it("送一次綁定（碼與第一次點的時間），回 200 就清掉，bound 為 false 也清", async () => {
    rememberCampaignShare("AB12CD34", clicked - 1000);
    expect(await bindCampaignShare(async () => "tok")).toBe("bound");
    expect(binds()).toHaveLength(1);
    expect(JSON.parse(String(binds()[0].init.body))).toEqual({ s: "AB12CD34", firstSeenAt: clicked - 1000 });
    expect(new Headers(binds()[0].init.headers).get("Authorization")).toBe("Bearer tok");
    expect(pendingCampaignShare()).toBeNull();

    rememberCampaignShare("AB12CD34", clicked - 1000);
    reply = () => json(200, { bound: false, reason: "not_new" });
    expect(await bindCampaignShare(async () => "tok")).toBe("done");
    expect(pendingCampaignShare()).toBeNull();
  });

  it("4xx 清掉；網路錯誤、5xx 與 401／403／429 留著下次再試", async () => {
    rememberCampaignShare("AB12CD34", clicked - 1000);
    reply = () => { throw new TypeError("Failed to fetch"); };
    expect(await bindCampaignShare(async () => "tok")).toBe("retry");
    expect(pendingCampaignShare()?.code).toBe("AB12CD34");
    reply = () => json(503, { error: "temporarily_unavailable" });
    expect(await bindCampaignShare(async () => "tok")).toBe("retry");
    expect(pendingCampaignShare()?.code).toBe("AB12CD34");
    for (const status of [401, 403, 429]) {
      reply = () => json(status, { error: "x" });
      expect(await bindCampaignShare(async () => "tok")).toBe("retry");
      expect(pendingCampaignShare()?.code).toBe("AB12CD34");
    }
    reply = () => json(400, { error: "invalid_arguments" });
    expect(await bindCampaignShare(async () => "tok")).toBe("done");
    expect(pendingCampaignShare()).toBeNull();
  });

  it("沒有記下的碼就不打請求", async () => {
    expect(await bindCampaignShare(async () => "tok")).toBe("none");
    expect(binds()).toHaveLength(0);
  });

  it("掛在 App 上：登入時綁一次並清掉；同一次登入不重送", async () => {
    rememberCampaignShare("AB12CD34", clicked - 1000);
    watchCampaignShareBinding();
    await settle();
    expect(binds()).toHaveLength(0);
    holder.session.me = { accountNumId: 7 };
    await settle();
    expect(binds()).toHaveLength(1);
    expect(pendingCampaignShare()).toBeNull();
    rememberCampaignShare("ZZ99YY88", clicked);
    holder.session.ready = false;
    await settle();
    expect(binds()).toHaveLength(1);
  });
});
