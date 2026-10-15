import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bearer, identities, makeMember, resetDb, restoreUpstream } from "./helpers";

// 首玩與活躍日：記錄對話時，有歸因的人補 first_play_at 並記當天（UTC 日序）為活躍日。
const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000; // 固定在某個 UTC 日的 01:00

let fan = "", plain = "";
const put = (token: string, roleId = "r1") => SELF.fetch("https://c.test/v1/me/conversations", {
  method: "PUT", headers: { ...bearer(token), "Content-Type": "application/json" }, body: JSON.stringify({ roleId, conversationId: "c-" + roleId }),
});
const firstPlay = () => env.DB.prepare("SELECT first_play_at FROM campaign_attributions WHERE member_id = ?").bind(fan).first<number | null>("first_play_at");
const days = async (memberId: string) => (await env.DB.prepare("SELECT day FROM campaign_active_days WHERE member_id = ? ORDER BY day").bind(memberId).all<{ day: number }>()).results.map(r => r.day);
const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>("n"))!;

beforeEach(async () => {
  await resetDb();
  identities({ fan: 65001, plain: 65002, owner: 65003 });
  fan = await makeMember(65001);
  plain = await makeMember(65002);
  const owner = await makeMember(65003);
  const campaignId = crypto.randomUUID(), contentId = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare("INSERT INTO campaigns (id, slug, title, status, created_by, created_at, updated_at) VALUES (?, 'launch', '{}', 'active', 'test', ?, ?)").bind(campaignId, now, now).run();
  await env.DB.prepare("INSERT INTO share_contents (id, campaign_id, member_id, recipient_account_no, title, share_code, created_at, updated_at) VALUES (?, ?, ?, 1, '介紹', 'AB12CD34', ?, ?)")
    .bind(contentId, campaignId, owner, now, now).run();
  await env.DB.prepare("INSERT INTO campaign_attributions (member_id, share_code, content_id, campaign_id, first_seen_at, registered_at, created_at) VALUES (?, 'AB12CD34', ?, ?, ?, ?, ?)")
    .bind(fan, contentId, campaignId, now, now, now).run();
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });

describe("首玩與活躍日", () => {
  it("有歸因的人第一次記錄對話補上首玩時間，之後不再改", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(T0);
    expect(await firstPlay()).toBeNull();
    expect((await put("fan")).status).toBe(200);
    expect(await firstPlay()).toBe(T0);
    now.mockReturnValue(T0 + 2 * DAY);
    await put("fan", "r2");
    expect(await firstPlay()).toBe(T0);
  });

  it("同一天多次只一列活躍日；隔天再記一列；日序是 UTC 日", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(T0);
    await put("fan"); await put("fan", "r2");
    expect(await days(fan)).toEqual([20_000]);
    now.mockReturnValue(T0 + DAY);
    await put("fan");
    expect(await days(fan)).toEqual([20_000, 20_001]);
  });

  it("沒有歸因不多寫：兩張表都沒有新列，對話照常記錄", async () => {
    const r = await put("plain");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ saved: true });
    expect(await days(plain)).toEqual([]);
    expect(await count("campaign_active_days")).toBe(0);
    expect(await firstPlay()).toBeNull();
    expect((await env.DB.prepare("SELECT conversation_id FROM member_conversations WHERE member_id = ?").bind(plain).first<string>("conversation_id"))).toBe("c-r1");
  });
});
