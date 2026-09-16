/**
 * 換家之後，打出去的請求要跟著換家。
 *
 * 線上出過的錯：登入頁點第二家，卻被送到第一家的授權頁。UPSTREAM_API 是模組層的可變值，
 * 換供應商時沒人重算；地區閘道那條路徑又會再把它蓋回第一家。兩條都要釘住。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UPSTREAM_API, resolveUpstream, resetUpstreamForTest } from "@/lib/config";
import { apiBaseOf, setProvider } from "@/lib/provider";
import { chooseProvider } from "@/lib/provider-switch";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setProvider("lunatalk");
  resetUpstreamForTest();
});

describe("換家之後打的是哪一家", () => {
  it("選了第二家，接下來的請求就打第二家——登入頁送錯授權頁就是這裡沒跟上", async () => {
    await chooseProvider("harbor", { login: () => {} });
    const { UPSTREAM_API: after } = await import("@/lib/config");
    expect(after).toBe(apiBaseOf("harbor"));
  });

  it("地區閘道只作用在預設那家：換到第二家之後問地區，不能把上游蓋回第一家", async () => {
    await chooseProvider("harbor", { login: () => {} });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ apiBase: "https://api.lunatalk.pro" }), { headers: { "content-type": "application/json" } }));
    await resolveUpstream(fetcher as unknown as typeof fetch);
    const { UPSTREAM_API: after } = await import("@/lib/config");
    expect(after).toBe(apiBaseOf("harbor"));
  });

  it("預設那家仍然吃地區閘道：這是為了繞開特定網域的封鎖，不能一起改掉", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ apiBase: "https://api.lunatalk.pro" }), { headers: { "content-type": "application/json" } }));
    await resolveUpstream(fetcher as unknown as typeof fetch);
    const { UPSTREAM_API: after } = await import("@/lib/config");
    expect(after).toBe("https://api.lunatalk.pro");
  });

  it("換家前後不互相污染：換過去又換回來，上游要回到第一家", async () => {
    await chooseProvider("harbor", { login: () => {} });
    await chooseProvider("lunatalk", { login: () => {} });
    const { UPSTREAM_API: after } = await import("@/lib/config");
    expect(after).toBe(apiBaseOf("lunatalk"));
  });
});
