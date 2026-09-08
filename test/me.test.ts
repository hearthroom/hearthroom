/**
 * 「我的」：登入者在本站的身分。
 *
 * 本站有自己的成員 ID（公開的是 8 個小寫字母的 handle），供應商帳號只是掛在底下的一筆身分。
 * 這裡驗：第一次問就建成員、同一個人問幾次都是同一個 ID、身分表對得上、審核人旗標。
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { bearer, identities, makeReviewer, resetDb, testHandle } from "./helpers";

beforeEach(async () => {
  await resetDb();
  identities({ "author-token": 10001, "other-token": 20002 });
});

const me = (token = "author-token") => SELF.fetch("https://c.test/v1/me", { headers: bearer(token) });

describe("GET /v1/me", () => {
  it("沒帶 token → 401", async () => {
    expect((await SELF.fetch("https://c.test/v1/me")).status).toBe(401);
  });

  it("第一次問就建成員：公開 ID 是 8 個小寫字母，身分表記著供應商與公開數字 ID", async () => {
    const res = await me();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { handle: string; memberSince: number; reviewer: boolean; identities: { provider: string; externalId: number; linkedAt: number }[] };
    expect(body.handle).toMatch(/^[a-z]{8}$/);
    expect(body.memberSince).toBeGreaterThan(0);
    expect(body.reviewer).toBe(false);
    expect(body.identities).toEqual([{ provider: "lunatalk", externalId: 10001, linkedAt: expect.any(Number) }]);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM members").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("同一個人問幾次都是同一個 ID；不同的人各有各的", async () => {
    const a = (await (await me()).json()) as { handle: string };
    const b = (await (await me()).json()) as { handle: string };
    const other = (await (await me("other-token")).json()) as { handle: string };
    expect(b.handle).toBe(a.handle);
    expect(other.handle).not.toBe(a.handle);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM members").first<{ n: number }>();
    expect(rows?.n).toBe(2);
  });

  it("審核人看得到自己是審核人", async () => {
    await makeReviewer(10001);
    const body = (await (await me()).json()) as { handle: string; reviewer: boolean };
    expect(body.reviewer).toBe(true);
    expect(body.handle).toBe(testHandle(10001));
  });
});
