import { afterEach, describe, expect, it, vi } from "vitest";
import { playShareHost, setPlayShare, setPlayShareRef, shareContextOf, shareQr, withShareContext, SHARE_CONTEXT_RE } from "../src/lib/play-share";
import { SHARE_CONTEXT_RE as STAGE_RE } from "../../stage/src/common/share-context";

const host = () => playShareHost({ communityHost: () => "sukisuki.ai", lp: (p) => `/zh-Hans${p}` });
const input = { roleId: "r1", cardNumber: "100271", context: "p1-4.b", audience: "link" as const, enabled: true };

afterEach(() => setPlayShare(null));

describe("卡內分享情境：宿主給舞台的值", () => {
  it("情境碼規則跟舞台同一條", () => {
    expect(SHARE_CONTEXT_RE.source).toBe(STAGE_RE.source);
    expect(shareContextOf("p1-4.b")).toBe("p1-4.b");
    expect(shareContextOf("~K7Q2M9XA")).toBeNull();
    expect(shareContextOf("<b>")).toBeNull();
  });

  it("連結是社群站的卡片頁（帶語系），推薦碼晚到時補上並通知舞台", () => {
    const h = host();
    setPlayShare(input);
    expect(h.read("r1")).toEqual({ enabled: true, context: "p1-4.b", url: "https://sukisuki.ai/zh-Hans/cards/100271", audience: "link" });
    const changed = vi.fn();
    const stop = h.onChange(changed);
    setPlayShareRef("r1", "ABCD");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(h.read("r1")!.url).toBe("https://sukisuki.ai/zh-Hans/cards/100271?ref=ABCD");
    setPlayShareRef("r1", "ABCD");
    setPlayShareRef("other", "ZZZZ");
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });

  it("別張卡、壞的情境碼、開關關著：不給情境碼；換卡時推薦碼要重讀", () => {
    const h = host();
    setPlayShare({ ...input, context: "a b" });
    expect(h.read("r1")!.context).toBeNull();
    expect(h.read("r2")).toBeNull();
    setPlayShare({ ...input, enabled: false });
    expect(h.read("r1")).toMatchObject({ enabled: false, context: null, url: "https://sukisuki.ai/zh-Hans/cards/100271" });
    setPlayShareRef("r1", "ABCD");
    setPlayShare({ ...input, roleId: "r2" });
    expect(h.read("r2")!.url).toBe("https://sukisuki.ai/zh-Hans/cards/100271");
  });

  it("卡片頁到遊玩頁、安裝連結：合格式的情境碼帶過去，其他參數照留", () => {
    expect(withShareContext("/zh-Hans/play/100271?provider=harbor", "p1-4.b")).toBe("/zh-Hans/play/100271?provider=harbor&share=p1-4.b");
    expect(withShareContext("https://play.sukisuki.ai/100271/?lang=zh&install=1", "p1-4.b")).toBe("https://play.sukisuki.ai/100271/?lang=zh&install=1&share=p1-4.b");
    expect(withShareContext("/play/1", undefined)).toBe("/play/1");
    expect(withShareContext("/play/1", "a b")).toBe("/play/1");
    expect(withShareContext("/play/1", ["p1", "p2"])).toBe("/play/1");
  });

  it("沒有卡號就沒有連結", () => {
    setPlayShare({ ...input, cardNumber: "" });
    expect(host().read("r1")!.url).toBe("");
  });

  it("QR 跟分享面板同一套畫法；空字串或太長拒絕", async () => {
    const qr = await shareQr("https://sukisuki.ai/cards/1");
    expect(qr.size).toBeGreaterThan(20);
    expect(qr.path).toMatch(/^M\d+ \d+h1v1h-1z/);
    await expect(shareQr("")).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(shareQr("x".repeat(1025))).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });
});
