import { describe, expect, it } from "vitest";
import { pushLine } from "../src/community/push";

// 審卡 V2：駁回帶理由代碼時，推播與 Discord 私訊只說沒通過（理由在點進去的結果頁），不附審核員的話
const row = (extra: Record<string, unknown>) => ({ kind: "review_result", extra: JSON.stringify(extra), actor_name: null, actor_handle: null, card_names: JSON.stringify({ zh: "雨夜書店", en: "Rainy Books", ja: "", ko: "" }) });
describe("pushLine for coded rejections", () => {
  it("uses the plain rejected line when reasons are present", () => {
    expect(pushLine(row({ status: "rejected", kind: "first", reasons: ["opening.too_short"] }), "zh-Hant")).toBe("「雨夜書店」這次沒有通過審核");
    expect(pushLine(row({ status: "rejected", kind: "re", reasons: ["rating.mismatch"] }), "zh-Hant")).toBe("「雨夜書店」的更新這次沒有通過審核");
    expect(pushLine(row({ status: "rejected", kind: "first", reasons: ["other"], note: "補充" }), "en")).toBe("“Rainy Books” did not pass review this time");
  });
  it("old rejections without reasons keep the reviewer note", () => {
    expect(pushLine(row({ status: "rejected", kind: "first", note: "開場太短" }), "zh-Hant")).toBe("「雨夜書店」這次沒有通過審核，審核員說：開場太短");
    expect(pushLine(row({ status: "rejected", kind: "first", reasons: [], note: "開場太短" }), "zh-Hant")).toBe("「雨夜書店」這次沒有通過審核，審核員說：開場太短");
  });
});
