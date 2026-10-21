// 簽到的送出：冪等鍵、別的裝置先簽了（409 already_claimed 附原結果）、自己的重送（replayed）。
// 契約：docs/openapi.json 的 POST /open/v1/me/rewards/checkin。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "tok" }) }));
import { useCheckin } from "../src/lib/checkin-store";
const tracking = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/track", () => ({ track: tracking }));

const claim = { rewardKey: "checkin:2026-10-20", status: "granted", chest: "daily", tier: 2, stripSeed: 7, stripVersion: 1, planVersion: 3, credits: 90, duplicate: false };
let sent: { requestId: string }[] = [];
function stub(handler: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => { if (init?.body) sent.push(JSON.parse(String(init.body))); return handler(); }));
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => { setActivePinia(createPinia()); sessionStorage.clear(); sent = []; tracking.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe("簽到送出", () => {
  it("成功：回傳結果，不是別的裝置", async () => {
    stub(() => json({ claims: [claim], streak: 9, replayed: false }));
    const r = await useCheckin().checkin();
    expect(r).toMatchObject({ streak: 9, elsewhere: false });
    expect(r.claims[0].credits).toBe(90);
    expect(tracking).toHaveBeenCalledWith("checkin_claim", { detail: "daily" });
  });

  it("網路斷了：重送用同一個冪等鍵，成功後換新的", async () => {
    stub(() => { throw new TypeError("network"); });
    const store = useCheckin();
    await expect(store.checkin()).rejects.toThrow();
    stub(() => json({ claims: [claim], streak: 9, replayed: true }));
    const r = await store.checkin();
    expect(sent[0].requestId).toBe(sent[1].requestId);
    expect(r.elsewhere).toBe(false);
    expect(tracking).not.toHaveBeenCalled();
  });

  it("今天已經在別的地方簽過：409 already_claimed 附原結果，當成回顧", async () => {
    stub(() => json({ error: "already_claimed", claims: [claim] }, 409));
    const r = await useCheckin().checkin();
    expect(r.elsewhere).toBe(true);
    expect(r.claims).toEqual([claim]);
    expect(tracking).not.toHaveBeenCalled();
  });

  it("其他錯誤照常丟出，冪等鍵留著給重試", async () => {
    stub(() => json({ error: "rewards_disabled" }, 404));
    await expect(useCheckin().checkin()).rejects.toMatchObject({ code: "rewards_disabled" });
    expect(Object.keys(sessionStorage).some((k) => k.startsWith("hr.rewards.req."))).toBe(true);
  });
});

// 月卡代領：Harbor 在簽到的同一個請求裡先領月卡，成功與錯誤的回應都帶 periodPlan（p5-contract §1）。
describe("簽到時一起領月卡", () => {
  const granted = { status: "granted", day: "2026-10-20", credits: 500, replayed: false };

  it("成功：回應帶著 periodPlan", async () => {
    stub(() => json({ claims: [claim], streak: 9, replayed: false, periodPlan: granted }));
    const r = await useCheckin().checkin();
    expect(r.periodPlan).toEqual(granted);
  });

  it("今天已經在別的地方簽過：409 的信封也帶 periodPlan", async () => {
    stub(() => json({ error: "already_claimed", claims: [claim], periodPlan: { ...granted, replayed: true } }, 409));
    const r = await useCheckin().checkin();
    expect(r.elsewhere).toBe(true);
    expect(r.periodPlan).toEqual({ ...granted, replayed: true });
  });

  it("簽到失敗也讀得到月卡的結果：錯誤帶著 periodPlan", async () => {
    stub(() => json({ error: "temporarily_unavailable", periodPlan: granted }, 503));
    await expect(useCheckin().checkin()).rejects.toMatchObject({ code: "temporarily_unavailable", periodPlan: granted });
  });

  it("舊伺服器沒有這個欄位：periodPlan 是 undefined", async () => {
    stub(() => json({ claims: [claim], streak: 9, replayed: false }));
    expect((await useCheckin().checkin()).periodPlan).toBeUndefined();
  });
});
