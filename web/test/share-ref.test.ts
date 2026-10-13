/**
 * 分享連結帶推薦碼（lib/share-ref.ts）：點進來先記下、算最後一個、放 30 天；
 * 只有點了之後才註冊的帳號才以連結來源自動填上；有結論就清掉紀錄，暫時連不上則留著下次再試。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api";

const api = vi.hoisted(() => ({ summary: vi.fn(), redeem: vi.fn() }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<typeof import("../src/lib/api")>()), fetchReferral: api.summary, redeemReferral: api.redeem }));
const connections = vi.hoisted(() => ({ accountToken: vi.fn() }));
vi.mock("../src/lib/connections", () => connections);

import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { useSession } from "../src/lib/session";
import { setProvider } from "../src/lib/provider";
import { SHARE_REF_TTL, bindShareRef, ownReferralCode, pendingShareRef, refFromQuery, rememberShareRef, watchShareRefBinding, withShareRef } from "../src/lib/share-ref";

const HOUR = 60 * 60 * 1000;
const clicked = Date.parse("2026-10-13T08:00:00Z");
const summary = (over: Record<string, unknown> = {}) => ({ enabled: true, code: "MINE2345", referred: false, canRedeem: true, registeredAt: new Date(clicked + HOUR).toISOString(), ...over });
const token = async () => "tok";

beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(clicked + 2 * HOUR); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("記下連結裡的碼", () => {
  it("只收像推薦碼的值，大小寫與空白不影響", () => {
    expect(refFromQuery(" k7m2q9xa ")).toBe("K7M2Q9XA");
    expect(refFromQuery("<script>")).toBeNull();
    expect(refFromQuery(["A", "B"])).toBeNull();
  });

  it("點了好幾個人的連結算最後一個，30 天後作廢", () => {
    rememberShareRef("FIRST234", clicked);
    rememberShareRef("LAST2345", clicked + HOUR);
    expect(pendingShareRef(clicked + 2 * HOUR)?.code).toBe("LAST2345");
    expect(pendingShareRef(clicked + HOUR + SHARE_REF_TTL)).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe("登入後自動帶入", () => {
  it("點了之後才註冊的帳號：以連結來源填上並清掉紀錄", async () => {
    rememberShareRef("FRIEND23", clicked);
    api.summary.mockResolvedValue(summary());
    api.redeem.mockResolvedValue(summary({ referred: true }));
    expect(await bindShareRef(token, "harbor")).toBe("bound");
    expect(api.redeem).toHaveBeenCalledWith("tok", "FRIEND23", "harbor", "link");
    expect(pendingShareRef()).toBeNull();
  });

  it("點連結之前就有的帳號不算被邀請", async () => {
    rememberShareRef("FRIEND23", clicked);
    api.summary.mockResolvedValue(summary({ registeredAt: new Date(clicked - 2 * HOUR).toISOString() }));
    expect(await bindShareRef(token, "harbor")).toBe("existing_account");
    expect(api.redeem).not.toHaveBeenCalled();
    expect(pendingShareRef()).toBeNull();
  });

  it("兩邊的鐘差幾分鐘：剛點完就註冊的人照樣算", async () => {
    rememberShareRef("FRIEND23", clicked);
    api.summary.mockResolvedValue(summary({ registeredAt: new Date(clicked - 3 * 60 * 1000).toISOString() }));
    api.redeem.mockResolvedValue(summary({ referred: true }));
    expect(await bindShareRef(token, "harbor")).toBe("bound");
  });

  it("已經有推薦人或已過期限：不填，清掉紀錄", async () => {
    rememberShareRef("FRIEND23", clicked);
    api.summary.mockResolvedValue(summary({ referred: true }));
    expect(await bindShareRef(token, "harbor")).toBe("not_eligible");
    expect(api.redeem).not.toHaveBeenCalled();
    expect(pendingShareRef()).toBeNull();
  });

  it("服務拒絕就不再試；暫時連不上則留著下次再試", async () => {
    rememberShareRef("FRIEND23", clicked);
    api.summary.mockResolvedValue(summary());
    api.redeem.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await bindShareRef(token, "harbor")).toBe("retry");
    expect(pendingShareRef()?.code).toBe("FRIEND23");
    api.redeem.mockRejectedValueOnce(new ApiError(409, "x", "referral_self"));
    expect(await bindShareRef(token, "harbor")).toBe("rejected");
    expect(pendingShareRef()).toBeNull();
  });

  it("服務沒回註冊時間就分不出新舊帳號：不填，留著紀錄", async () => {
    rememberShareRef("FRIEND23", clicked);
    api.summary.mockResolvedValue(summary({ registeredAt: undefined }));
    expect(await bindShareRef(token, "harbor")).toBe("retry");
    expect(api.redeem).not.toHaveBeenCalled();
    expect(pendingShareRef()?.code).toBe("FRIEND23");
  });

  it("沒有記下的碼就不打任何請求", async () => {
    expect(await bindShareRef(token, "harbor")).toBe("none");
    expect(api.summary).not.toHaveBeenCalled();
  });
});

describe("分享網址帶自己的碼", () => {
  it("有碼才帶，保留原本的網址", () => {
    expect(withShareRef("https://sukisuki.ai/en/cards/12", "MINE2345")).toBe("https://sukisuki.ai/en/cards/12?ref=MINE2345");
    expect(withShareRef("https://sukisuki.ai/cards/12", null)).toBe("https://sukisuki.ai/cards/12");
  });

  it("暫時讀不到下次再問；讀到了就不再問", async () => {
    api.summary.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await ownReferralCode("7", token, "harbor")).toBeNull();
    api.summary.mockResolvedValue(summary());
    expect(await ownReferralCode("7", token, "harbor")).toBe("MINE2345");
    expect(await ownReferralCode("7", token, "harbor")).toBe("MINE2345");
    expect(api.summary).toHaveBeenCalledTimes(2);
  });

  it("舊的登入沒授權推薦：照舊不帶碼，也不每開一張卡就再問一次", async () => {
    api.summary.mockRejectedValue(new ApiError(403, "x", "insufficient_scope"));
    expect(await ownReferralCode("8", token, "harbor")).toBeNull();
    expect(await ownReferralCode("8", token, "harbor")).toBeNull();
    expect(api.summary).toHaveBeenCalledTimes(1);
  });
});

describe("登入時自動觸發", () => {
  it("有人登入且有記下的碼：用那一家的帳號拿 token 去帶入", async () => {
    setProvider("harbor");
    setActivePinia(createPinia());
    const session = useSession();
    session.profile = { identities: [{ provider: "harbor", externalId: 42 }] } as never;
    connections.accountToken.mockResolvedValue("tok");
    api.summary.mockResolvedValue(summary());
    api.redeem.mockResolvedValue(summary({ referred: true }));
    rememberShareRef("FRIEND23", clicked);
    watchShareRefBinding();
    session.me = { accountNumId: 7, nickName: "n", avatar: "" } as never;
    await nextTick();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(connections.accountToken).toHaveBeenCalledWith("harbor", 42);
    expect(api.redeem).toHaveBeenCalledWith("tok", "FRIEND23", "harbor", "link");
  });
});
