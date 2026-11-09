/**
 * 卡片變數的表格檢視：原文 → 表格 → 原文不能掉東西（鍵序、$meta、逐值規則、數字原文），
 * 寫法自動判斷要跟上游的正規化結果一致，表格放不下的結構整份交給原始碼。
 */
import { describe, expect, it } from "vitest";
import { formatJson, normalizeState, type StateConvention } from "../src/lib/card-state";
import {
  mergeStateExample,
  newRow,
  readStateTable,
  reformatStateText,
  writeStateTable,
  type StateRow,
} from "../src/lib/card-state-table";
import { EXAMPLE_PANEL_SKIN } from "../src/lib/state-panel-example";
import { renderStatePanelSkin } from "stage-panel/state-panel";
import examples from "../src/locales/card-defaults/state-examples.json";

const norm = (convention: StateConvention, text: string) => normalizeState(convention, JSON.parse(text));

function rows(convention: StateConvention, dataText: string): StateRow[] {
  const read = readStateTable({ convention, dataText });
  if (!read.ok) throw new Error(`table refused: ${read.reason}`);
  return read.rows;
}

/** 讀進表格再寫回：正規化結果要跟原文一樣，而且再來一次逐字不變。 */
function roundTrip(convention: StateConvention, text: string) {
  const out = writeStateTable(rows(convention, text))!;
  expect(out).not.toBeNull();
  expect(JSON.stringify(norm(out.convention, out.dataText))).toBe(JSON.stringify(norm(convention, text)));
  expect(writeStateTable(rows(out.convention, out.dataText))).toEqual(out);
  return out;
}

/** 原文裡的鍵依出現順序（自己掃，不經 JSON.parse，免得整數樣的鍵被排到前面）。 */
const keyOrder = (text: string): string[] => [...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);

const MVU = `{
  "10": [1, "整數樣的鍵排在後面"],
  "好感度": [0.1, "0 到 1"],
  "HP.max": 100,
  "a[\\"b\\"]": "鍵裡有括號與引號",
  "背包": [["短刀", "鐵護腕"], "隨身物品"],
  "標籤": [["溫柔", "嘴硬"], ""],
  "旗標": [true, ""],
  "大數": 12345678901234567890,
  "零": -0,
  "指數": 1e21,
  "一點零": 1.0,
  "任務": [{ "$meta": { "extensible": true }, "2": "進行中", "尋找商隊": ["進行中", "完成時刪除"] }, "接到新任務時加入"],
  "屬性": { "力量": 3 },
  "空群組": {}
}`;

describe("往返不掉資料", () => {
  it("MVU：鍵序、$meta、群組與值上的規則、像一對的清單、數字原文都留著", () => {
    const out = roundTrip("mvu", MVU);
    expect(out.convention).toBe("mvu");
    expect(keyOrder(out.dataText)).toEqual(keyOrder(MVU));
    for (const raw of ["12345678901234567890", "-0", "1e21", "1.0", "0.1"]) expect(out.dataText).toMatch(new RegExp(`(: |\\[)${raw.replace(".", "\\.")}[,\\n]`));
    // 排版照 formatJson；唯一的改寫是不像一對的值上的空規則（[true, ""]）拿掉，像一對的清單（標籤）保留
    expect(out.dataText).toBe(reformatStateText(MVU.replace('[true, ""]', "true")));
  });

  it("plain（風月匯入）：兩個字串的清單是清單、空物件可以新增項目；沒有規則就照樣存 plain", () => {
    const text = '{"背包": ["短刀", "鐵護腕"], "任務": {}, "屬性": {"力量": 3}}';
    const table = rows("plain", text);
    expect(table[0]).toMatchObject({ kind: "list", items: [{ kind: "text", value: "短刀" }, { kind: "text", value: "鐵護腕" }], rule: "" });
    expect(table[1]).toMatchObject({ kind: "group", extensible: true, children: [] });
    expect(table[2]).toMatchObject({ kind: "group", extensible: false });
    expect(roundTrip("plain", text).convention).toBe("plain");
  });

  it("沒改到的原文排版跟 formatJson 一致（一般資料兩條路徑印出來逐字相同）", () => {
    const data = { a: 1, b: ["x", "y", "z"], c: { d: [true, "rule"], e: [] }, f: [[1, 2], "清單規則"] };
    expect(reformatStateText(JSON.stringify(data))).toBe(formatJson(data));
  });
});

describe("寫法自動判斷", () => {
  it("任一列有規則就是 MVU：有規則的寫成 [值, 規則]，其他照樣是值", () => {
    const table = rows("plain", '{"好感度": 10, "心情": "平靜"}');
    table[0].rule = "被打動時加";
    const out = writeStateTable(table)!;
    expect(out.convention).toBe("mvu");
    expect(JSON.parse(out.dataText)).toEqual({ 好感度: [10, "被打動時加"], 心情: "平靜" });
    // 規則清掉就回到只有值
    table[0].rule = " ";
    expect(writeStateTable(table)).toEqual({ convention: "plain", dataText: '{\n  "好感度": 10,\n  "心情": "平靜"\n}' });
  });

  it("沒有規則時：MVU 才表達得了的群組設定就留在 MVU，其餘用 plain", () => {
    const group = (extensible: boolean, children: StateRow[] = []): StateRow => ({ ...newRow("group"), name: "任務", extensible, children });
    // 空群組不可新增：plain 會把空物件當成可新增，所以只能是 MVU 的 {}
    const closed = writeStateTable([group(false)])!;
    expect(closed).toEqual({ convention: "mvu", dataText: '{\n  "任務": {}\n}' });
    expect(norm("mvu", closed.dataText).open).toEqual([]);
    // 空群組可新增：plain 的 {} 就是
    expect(writeStateTable([group(true)])).toEqual({ convention: "plain", dataText: '{\n  "任務": {}\n}' });
    // 非空群組可新增：要 $meta
    const child = { ...newRow("text"), name: "尋找商隊", value: "進行中" };
    const open = writeStateTable([group(true, [child])])!;
    expect(open.convention).toBe("mvu");
    expect(JSON.parse(open.dataText)).toEqual({ 任務: { $meta: { extensible: true }, 尋找商隊: "進行中" } });
    expect(norm("mvu", open.dataText).open).toEqual(["任務"]);
  });

  it("MVU 裡像一對的清單沒有規則時包一層空規則，不會被讀成值加規則", () => {
    const table = rows("plain", '{"背包": ["短刀", "鐵護腕"], "好感度": 1}');
    table[1].rule = "變動";
    const out = writeStateTable(table)!;
    expect(JSON.parse(out.dataText).背包).toEqual([["短刀", "鐵護腕"], ""]);
    expect(norm("mvu", out.dataText).data.背包).toEqual(["短刀", "鐵護腕"]);
  });

  it("名稱空白、重複、$ 開頭或數字寫錯時不寫回原文", () => {
    const base = () => rows("plain", '{"a": 1, "b": 2}');
    const cases: Array<(t: StateRow[]) => void> = [
      (t) => { t[1].name = " "; },
      (t) => { t[1].name = "a"; },
      (t) => { t[1].name = "$meta"; },
      (t) => { t[1].value = "1."; },
      (t) => { t.push({ ...newRow("group"), name: "g", children: [{ ...newRow("number"), name: "x", value: "abc" }] }); },
    ];
    for (const mutate of cases) {
      const t = base();
      mutate(t);
      expect(writeStateTable(t)).toBeNull();
    }
  });
});

describe("表格顯示不了的結構整份交給原始碼", () => {
  const unsupported: Array<[string, StateConvention, string]> = [
    ["群組裡的群組", "mvu", '{"a": {"b": {"c": 1}}}'],
    ["清單裡放物件", "mvu", '{"隊伍": [{"名字": "阿芙拉"}]}'],
    ["清單裡放清單", "plain", '{"格子": [[1, 2], [3, 4]]}'],
    ["$meta 有 required", "mvu", '{"a": {"$meta": {"required": ["x"]}, "x": 1}}'],
    ["$meta 有 recursiveExtensible", "mvu", '{"a": {"$meta": {"recursiveExtensible": true}, "x": 1}}'],
    ["最外層的 $meta", "mvu", '{"$meta": {"extensible": true}, "a": 1}'],
    ["$meta 以外的特殊鍵", "mvu", '{"a": {"$note": "x", "b": 1}}'],
    ["plain 裡的 $meta 是資料", "plain", '{"a": {"$meta": {"extensible": true}}}'],
    ["清單的可擴充標記", "mvu", '{"背包": ["$__META_EXTENSIBLE__$", "短刀"]}'],
    ["null", "mvu", '{"地點": null}'],
    ["重複的鍵", "mvu", '{"a": 1, "a": 2}'],
    ["空字串鍵", "mvu", '{"": 1}'],
    ["鍵名前後有空白（寫回時會被修掉，規則與面板就對不上）", "mvu", '{" HP": 1}'],
    ["文字裡有換行", "mvu", '{"日記": "第一行\\n第二行"}'],
    ["規則裡有換行", "mvu", '{"好感度": [1, "加\\n減"]}'],
  ];
  it.each(unsupported)("%s", (_name, convention, dataText) => {
    expect(readStateTable({ convention, dataText })).toEqual({ ok: false, reason: "unsupported" });
  });

  it("草稿帶著原文放不下的逐值規則（例如掛在清單某一項上）", () => {
    expect(readStateTable({ convention: "mvu", dataText: '{"背包": ["短刀"]}', pathRules: { "背包[0]": "用掉時移除" } })).toEqual({ ok: false, reason: "unsupported" });
  });

  it("解不開或最外層不是物件是格式錯誤；空白是空表格", () => {
    expect(readStateTable({ convention: "mvu", dataText: '{"a": 1,}' })).toEqual({ ok: false, reason: "invalid" });
    expect(readStateTable({ convention: "mvu", dataText: "[1]" })).toEqual({ ok: false, reason: "invalid" });
    expect(readStateTable({ convention: "mvu", dataText: "  " })).toEqual({ ok: true, rows: [] });
  });

  it("MVU 一對裡的群組（規則掛在群組上）表格放得下：內建的任務範例就是這個樣子", () => {
    const table = rows("mvu", JSON.stringify(examples["zh-Hant"].quests));
    expect(table[0]).toMatchObject({ kind: "group", extensible: true, rule: expect.stringContaining("任務") });
  });
});

describe("插入範例", () => {
  it("併進 plain 原文：先換成 MVU 讀法再併，原本的清單不會被讀成一對，結果表格讀得了", () => {
    const merged = mergeStateExample({ convention: "plain", dataText: '{"背包": ["短刀", "鐵護腕"], "10": 1}' }, examples["zh-Hant"].affection)!;
    expect(merged.convention).toBe("mvu");
    const n = norm("mvu", merged.dataText);
    expect(n.data).toEqual({ 背包: ["短刀", "鐵護腕"], 10: 1, 好感度: 0 });
    expect(readStateTable({ ...merged }).ok).toBe(true);
  });

  it("同名的由範例蓋掉，位置不變", () => {
    const merged = mergeStateExample({ convention: "mvu", dataText: '{"好感度": 50, "金錢": 3}' }, examples["zh-Hant"].affection)!;
    expect(keyOrder(merged.dataText)).toEqual(["好感度", "金錢"]);
    expect(JSON.parse(merged.dataText).好感度[0]).toBe(0);
  });
});

describe("範例皮膚", () => {
  it("用面板同一支渲染器畫得出來：數字、清單、群組都有字，不出現 [object Object]", () => {
    const data = norm("mvu", MVU).data;
    const result = renderStatePanelSkin(EXAMPLE_PANEL_SKIN, data, [], "author");
    expect(result.error).toBeUndefined();
    expect(result.html).toContain("短刀");
    expect(result.html).toContain("尋找商隊 進行中");
    expect(result.html).toContain("好感度");
    expect(result.html).not.toContain("[object Object]");
  });
});
