/**
 * 酒館卡的 MagVarUpdate 初始變數：[InitVar] 條目 → 卡片變數（MVU 寫法），不進世界書。
 */
import { describe, expect, it } from "vitest";
import { tavernToDraft, type TavernBookEntry, type TavernCard } from "../src/lib/tavern";
import { normalizeState } from "../src/lib/card-state";
import { parseRelaxedJson } from "../src/lib/relaxed-json";

const labels = { personality: "性格", scenario: "情境" };
const card = (entries: TavernBookEntry[], first_mes = "合成開場"): TavernCard => ({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: { name: "合成卡", description: "合成設定", first_mes, character_book: { entries } },
});
const run = (entries: TavernBookEntry[], first_mes?: string) => tavernToDraft(card(entries, first_mes), { language: "zh-Hant", labels });
const LORE: TavernBookEntry = { keys: ["鎮"], comment: "黑麥鎮", content: "北境小鎮。", enabled: true };

describe("[InitVar] 條目", () => {
  it("一條：解成 MVU 骨架，不進世界書；其他條目照舊", () => {
    const result = run([{ keys: [], comment: "[InitVar]初始化", content: '{"好感度": [0, "0 到 100"], "背包": [["短刀"], "隨身物品"]}', enabled: false }, LORE]);
    expect(result.draft.state?.convention).toBe("mvu");
    expect(JSON.parse(result.draft.state!.dataText)).toEqual({ 好感度: [0, "0 到 100"], 背包: [["短刀"], "隨身物品"] });
    expect(result.draft.state).toMatchObject({ rulesText: "", template: "" });
    expect(result.worldbook?.entries.map((e) => e.name)).toEqual(["黑麥鎮"]);
    expect(result.dropped).toContainEqual({ key: "import.state.initVar", params: { n: 1 } });
  });

  it("兩條照順序逐層合併；標記大小寫不拘，JSON5 寫法也收", () => {
    const result = run([
      { keys: [], comment: "[InitVar] 角色", content: '{"角色": {"好感度": [0, "規則"], "心情": ["平靜", "隨對話"]}}' },
      { keys: [], comment: "[initvar] 補充", content: "{\n  // 後面這條蓋掉心情\n  角色: { 心情: ['緊張', '隨對話'], },\n  '世界': { 天氣: ['晴', '每天換'] },\n}" },
    ]);
    expect(JSON.parse(result.draft.state!.dataText)).toEqual({
      角色: { 好感度: [0, "規則"], 心情: ["緊張", "隨對話"] },
      世界: { 天氣: ["晴", "每天換"] },
    });
    expect(result.worldbook).toBeNull();
    expect(result.dropped).toContainEqual({ key: "import.state.initVar", params: { n: 2 } });
    // 合併後的骨架上游收得下
    expect(normalizeState("mvu", JSON.parse(result.draft.state!.dataText)).paths).toEqual({ "角色.好感度": "規則", "角色.心情": "隨對話", "世界.天氣": "每天換" });
  });

  it("解不開的（YAML）留成停用的條目並列進摘要", () => {
    const result = run([{ keys: [], comment: "[InitVar]", content: "好感度:\n  - 0\n  - 0 到 100", enabled: true }, LORE]);
    expect(result.draft.state).toBeNull();
    const kept = result.worldbook!.entries.find((e) => e.content.startsWith("好感度:"))!;
    expect(kept.isEnabled).toBe(false);
    expect(result.dropped).toContainEqual({ key: "import.state.initVarUnparsed", params: { n: 1 } });
  });

  it("用巨集讀變數的條目停用並說明；巨集不展開", () => {
    const content = "目前好感度：{{get_message_variable::stat_data.好感度}}";
    const result = run([LORE, { keys: ["好感"], comment: "好感度說明", content, enabled: true }]);
    const entry = result.worldbook!.entries.find((e) => e.name === "好感度說明")!;
    expect(entry.isEnabled).toBe(false);
    expect(entry.content).toBe(content);
    expect(result.dropped).toContainEqual({ key: "import.state.macroEntry", params: { n: 1 } });
  });

  it("開場白裡的 <UpdateVariable> 原樣留著；本站不做的 MVU 寫法列進摘要", () => {
    const greeting = "合成開場\n<UpdateVariable>\n_.set('好感度', 0, 5);\n</UpdateVariable>";
    const result = run([
      { keys: [], comment: "[InitVar]", content: '{"任務": {"$meta": {"extensible": true, "template": {"進度": 0}}}}' },
      { keys: ["規則"], comment: "變數規則", content: "移動物品用 _.move('背包.短刀', '倉庫.短刀')。<% if (x) { %>…<% } %>" },
    ], greeting);
    expect(result.draft.roleWelcome).toBe(greeting);
    const keys = result.dropped.map((n) => n.key);
    expect(keys).toEqual(expect.arrayContaining(["import.state.metaTemplate", "import.state.ejs", "import.state.move"]));
  });

  it("沒有 [InitVar] 的卡不受影響", () => {
    const result = run([LORE]);
    expect(result.draft.state).toBeNull();
    expect(result.dropped.filter((n) => n.key.startsWith("import.state."))).toEqual([]);
  });
});

describe("parseRelaxedJson", () => {
  it("收註解、結尾逗號、單引號、沒加引號的鍵（含中文）", () => {
    expect(parseRelaxedJson("{a: 1, 'b': 'x\\'y', 中文: [1, 2,], /* c */ d: -1.5e2, e: null, f: true,}")).toEqual({ a: 1, b: "x'y", 中文: [1, 2], d: -150, e: null, f: true });
  });
  it("YAML 與不完整的 JSON 解不開", () => {
    expect(() => parseRelaxedJson("a: 1\nb: 2")).toThrow();
    expect(() => parseRelaxedJson("{a: 1")).toThrow();
    expect(() => parseRelaxedJson("{a: 1} extra")).toThrow();
  });
});
