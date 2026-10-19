/**
 * 新手七日的桌寵提示「今天彈過了沒、按了晚點再說沒有」（ui.md §15.1、§15.6）：
 *   - 這是綺夢社自己的資料，不是獎勵資料；記在帳號上，換裝置不重複彈
 *   - 一天以台北 04:00 換日，由伺服器算，不信任裝置時鐘
 *   - 兩個寫入（已彈、晚點再說）都冪等
 */
import { env } from "cloudflare:test";
import { SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bearer, identities, resetDb, restoreUpstream } from "./helpers";
import { businessDay } from "../src/rewards";

const api = (path: string, token = "fan", init: RequestInit = {}) =>
  SELF.fetch(`https://c.test/v1/${path}`, { ...init, headers: { ...bearer(token), "Content-Type": "application/json", ...(init.headers ?? {}) } });
const json = async (r: Response) => (await r.json()) as any;

beforeEach(async () => { await resetDb(); identities({ fan: 20001, other: 20002 }); });
afterEach(() => { restoreUpstream(); vi.useRealTimers(); });

describe("業務日", () => {
  it("台北 04:00 換日", () => {
    expect(businessDay(Date.parse("2026-10-20T03:59:00+08:00"))).toBe("2026-10-19");
    expect(businessDay(Date.parse("2026-10-20T04:00:00+08:00"))).toBe("2026-10-20");
    expect(businessDay(Date.parse("2026-10-20T23:30:00+08:00"))).toBe("2026-10-20");
  });
});

describe("新手提示的狀態", () => {
  it("要登入；一開始今天沒彈過", async () => {
    expect((await api("me/checkin/prompt", "")).status).toBe(401);
    const s = await json(await api("me/checkin/prompt"));
    expect(s).toMatchObject({ shown: false, later: false });
    expect(s.day).toBe(businessDay(Date.now()));
  });

  it("彈過、晚點再說都記在帳號上，重送不出錯，別人不受影響", async () => {
    for (let i = 0; i < 2; i++) expect((await api("me/checkin/prompt", "fan", { method: "POST", body: JSON.stringify({ kind: "shown" }) })).status).toBe(200);
    expect(await json(await api("me/checkin/prompt"))).toMatchObject({ shown: true, later: false });
    await api("me/checkin/prompt", "fan", { method: "POST", body: JSON.stringify({ kind: "later" }) });
    expect(await json(await api("me/checkin/prompt"))).toMatchObject({ shown: true, later: true });
    expect(await json(await api("me/checkin/prompt", "other"))).toMatchObject({ shown: false, later: false });
  });

  it("隔天重新算", async () => {
    await api("me/checkin/prompt", "fan", { method: "POST", body: JSON.stringify({ kind: "later" }) });
    const member = (await env.DB.prepare("SELECT member_id AS id FROM member_identities WHERE external_id='20001'").first<{ id: string }>())!.id;
    await env.DB.prepare("UPDATE checkin_prompts SET shown_day='2000-01-01', later_day='2000-01-01' WHERE member_id=?").bind(member).run();
    expect(await json(await api("me/checkin/prompt"))).toMatchObject({ shown: false, later: false });
  });

  it("不認得的種類是 400", async () => {
    expect((await api("me/checkin/prompt", "fan", { method: "POST", body: JSON.stringify({ kind: "skip" }) })).status).toBe(400);
  });
});
