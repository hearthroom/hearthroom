import { describe, expect, it } from "vitest";
import { internalTermsIn } from "../src/author-note-guard";

// 給作者的說明只擋明確的內部資訊（送審額度與節奏、同裝置、多帳號、AI 分數、作者標記、量產）；
// 寫卡片內容時自然會出現的字（自信心、科幻裝置、分身角色、故事裡的帳號、plot device）不能誤擋。
describe("給作者的說明：內部字詞檢查", () => {
  it.each([
    "女主的自信心塑造不足，開場就把她寫得太完美。",
    "這張科幻卡的時光裝置與防護設備設定很完整，可以再補一點代價。",
    "分身角色的兩個人格切換得太突然。",
    "主播在故事裡被盜了帳號，這段動機寫得不夠清楚。",
    "The time machine is just a plot device; give it a cost.",
    "The heroine lacks confidence in a believable way.",
    "Her Instagram account is a nice touch for the setting.",
    "考試分數的那段可以再寫得有張力一點。",
  ])("寫卡片本身的話照常通過：%s", (text) => {
    expect(internalTermsIn(text)).toEqual([]);
  });

  it.each<[string, string[]]>([
    ["本週額度已用滿，同裝置有 4 個帳號。", ["額度", "裝置", "帳號"]],
    ["同一裝置上有好幾個帳號，不受理。", ["裝置", "帳號"]],
    ["你的送審次數太多，送審太頻繁了。", ["送審次數"]],
    ["本周额度已用完，同一设备上有多个账号。", ["額度", "裝置", "帳號"]],
    ["你送审太频繁了。", ["送審次數"]],
    ["看起來是批量產卡的工作室。", ["送審次數"]],
    ["量產卡不收。", ["送審次數"]],
    ["同一手機登入的小號。", ["裝置", "帳號"]],
    ["AI 的信心分數只有 0.4。", ["分數"]],
    ["置信度偏低。", ["分數"]],
    ["你是熟面孔了，作者等級是新手。", ["作者等級"]],
    ["Your weekly quota is used up.", ["額度"]],
    ["Several cards came from the same device and multiple accounts.", ["裝置", "帳號"]],
    ["The confidence score was low.", ["分數"]],
    ["同一 IP 送了好幾張。", ["裝置"]],
  ])("內部資訊擋下：%s", (text, terms) => {
    expect(internalTermsIn(text)).toEqual(terms);
  });
});
