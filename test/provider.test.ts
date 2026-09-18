/**
 * 供應商層：一個部署可以接不只一家。
 *
 * 這個站不存卡、不管登入，那些住在供應商那邊。接第二家之後，「這個請求屬於哪一家」
 * 必須由呼叫端明說（X-Provider），不能從 token 反推——兩家的 token 格式沒有互斥保證，
 * 猜錯就是把 A 家的人當成 B 家的人。沒帶就是 lunatalk，已部署的舊客戶端照常。
 *
 * 兩家的資料完全不混（owner 2026-09-16）：同一個外部數字 ID 在兩家是兩個人。
 */
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { bearer, identitiesFor, resetDb } from "./helpers";
import { apiBaseOf, configuredProviders, parseProvider, requireConfigured, reviewEnabled } from "../src/providers";
import { HttpError } from "../src/types";

beforeEach(async () => {
  await resetDb();
  identitiesFor({ lunatalk: { "luna-token": 10001 }, harbor: { "harbor-token": 10001, "harbor-other": 20002 } });
});

describe("parseProvider", () => {
  it("沒帶標頭就是 lunatalk：已部署的舊客戶端不會因為多了一家而壞掉", () => {
    expect(parseProvider(undefined)).toBe("lunatalk");
    expect(parseProvider("")).toBe("lunatalk");
  });

  it("認得設定過的供應商，大小寫與空白都收", () => {
    expect(parseProvider("harbor")).toBe("harbor");
    expect(parseProvider(" Harbor ")).toBe("harbor");
  });

  it("不認得的值直接擋下，不退回預設：退回預設等於把請求送去另一家的資料", () => {
    expect(() => parseProvider("openai")).toThrow(HttpError);
    expect(() => parseProvider("lunatalk; harbor")).toThrow(HttpError);
  });
});

describe("供應商設定", () => {
  it("每家各有自己的 API 位址", () => {
    const e = { PROVIDER_API_BASE: "https://api.luna.test", PROVIDER_API_BASE_HARBOR: "https://api.harbor.test" };
    expect(apiBaseOf(e, "lunatalk", "TW")).toBe("https://api.luna.test");
    expect(apiBaseOf(e, "harbor", "TW")).toBe("https://api.harbor.test");
  });

  it("地區閘道只作用在自己那一家", () => {
    const e = {
      PROVIDER_API_BASE: "https://api.luna.test",
      PROVIDER_API_GATEWAYS: "CN=https://cn.luna.test",
      PROVIDER_API_BASE_HARBOR: "https://api.harbor.test",
    };
    expect(apiBaseOf(e, "lunatalk", "CN")).toBe("https://cn.luna.test");
    expect(apiBaseOf(e, "harbor", "CN")).toBe("https://api.harbor.test");
  });

  it("沒設位址的供應商等於這個部署沒有它——自架只接一家的人照樣跑", () => {
    expect(configuredProviders({ PROVIDER_API_BASE: "https://api.luna.test" })).toEqual(["lunatalk"]);
    expect(configuredProviders({ PROVIDER_API_BASE: "https://api.luna.test", PROVIDER_API_BASE_HARBOR: "https://h.test" }))
      .toEqual(["lunatalk", "harbor"]);
  });

  it("審核開關：只有明說 true 才審，其餘退回登記即上榜", () => {
    expect(reviewEnabled({ REVIEW_ENABLED: "true" })).toBe(true);
    expect(reviewEnabled({ REVIEW_ENABLED: "false" })).toBe(false);
    expect(reviewEnabled({})).toBe(false);
  });
});

describe("GET /v1/me 帶供應商", () => {
  const me = (token: string, provider?: string) =>
    SELF.fetch("https://c.test/v1/me", { headers: { ...bearer(token), ...(provider ? { "X-Provider": provider } : {}) } });

  it("兩家的同一個數字 ID 是兩個人，各自有自己的成員身分", async () => {
    const luna = (await (await me("luna-token")).json()) as { handle: string; identities: { provider: string; externalId: number }[] };
    const harbor = (await (await me("harbor-token", "harbor")).json()) as { handle: string; identities: { provider: string; externalId: number }[] };
    expect(luna.handle).not.toBe(harbor.handle);
    expect(luna.identities[0].provider).toBe("lunatalk");
    expect(harbor.identities[0].provider).toBe("harbor");
    expect(luna.identities[0].externalId).toBe(harbor.identities[0].externalId);
  });

  it("同一家的同一個人，問幾次都是同一個成員", async () => {
    const first = (await (await me("harbor-token", "harbor")).json()) as { handle: string };
    const again = (await (await me("harbor-token", "harbor")).json()) as { handle: string };
    expect(again.handle).toBe(first.handle);
  });

  it("不認得的供應商回 400", async () => {
    expect((await me("luna-token", "nope")).status).toBe(400);
  });

  it("這個部署沒設定的供應商擋在 requireConfigured：不會拿預設那家的位址去打", () => {
    const onlyLuna = { PROVIDER_API_BASE: "https://api.luna.test" };
    expect(() => requireConfigured(onlyLuna, "harbor")).toThrow(HttpError);
    expect(requireConfigured(onlyLuna, "lunatalk")).toBe("lunatalk");
  });
});
