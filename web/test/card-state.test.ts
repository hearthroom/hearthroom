/**
 * 卡片變數的草稿：本地正規化（上游 cardstate.Normalize 的鏡像）、讀回時組回 MVU 原文、
 * 再存一次要得到同一份正規化結果。
 */
import { describe, expect, it } from "vitest";
import {
  deepMerge,
  normalizeState,
  readState,
  rebuildStateText,
  stateChanged,
  stateEmpty,
  statePayload,
  stateProblem,
  stateTurnSize,
  STATE_LIMITS,
  switchConvention,
  type CardStateDraft,
  type StateConvention,
} from "../src/lib/card-state";
import { draftFromRoleDetail, makeDraft } from "../src/lib/role-draft";

/** 作者原文 → 上游會存的樣子 → 編輯器讀回的原文 → 再存一次，四份要對得上。 */
function roundTrip(convention: StateConvention, text: string) {
  const first = normalizeState(convention, JSON.parse(text));
  const view = { version: 2, data: first.data, rules: { text: "", paths: first.paths }, open: first.open, required: first.required };
  const draft = readState(view)!;
  const again = normalizeState(draft.convention, JSON.parse(draft.dataText));
  return { first, draft, again };
}

const MVU = `{
  "$meta": { "required": ["好感度"] },
  "好感度": [10, "0 到 100；被打動時加"],
  "背包": [["短刀", "鐵護腕"], "隨身物品"],
  "標籤": ["溫柔", "嘴硬"],
  "旗標": [true, ""],
  "任務": {
    "$meta": { "extensible": true },
    "尋找商隊": ["進行中", "完成時刪除"]
  },
  "地圖": {
    "$meta": { "recursiveExtensible": true },
    "北境": { "黑麥鎮": { "人口": [300, "隨事件變動"] } }
  },
  "隊伍": [{ "名字": ["阿芙拉", "改名時更新"], "裝備": {} }, "$__META_EXTENSIBLE__$"]
}`;

describe("normalizeState（上游規則的鏡像）", () => {
  it("MVU：值與規則分開、清單是清單、$meta 變成 open 與 required、標記剝掉", () => {
    const n = normalizeState("mvu", JSON.parse(MVU));
    expect(n.data).toEqual({
      好感度: 10,
      背包: ["短刀", "鐵護腕"],
      標籤: "溫柔",
      旗標: true,
      任務: { 尋找商隊: "進行中" },
      地圖: { 北境: { 黑麥鎮: { 人口: 300 } } },
      隊伍: [{ 名字: "阿芙拉", 裝備: {} }],
    });
    expect(n.paths).toEqual({
      好感度: "0 到 100；被打動時加",
      背包: "隨身物品",
      標籤: "嘴硬",
      "任務.尋找商隊": "完成時刪除",
      "地圖.北境.黑麥鎮.人口": "隨事件變動",
      "隊伍[0].名字": "改名時更新",
    });
    expect(n.open).toEqual(["任務", "地圖", "地圖.北境", "地圖.北境.黑麥鎮"]);
    expect(n.required).toEqual(["好感度"]);
  });

  it("plain：照原樣存，非根的空物件都可以新增鍵", () => {
    const n = normalizeState("plain", { a: {}, b: { c: {} }, d: [{}], e: ["x", "y"] });
    expect(n.data).toEqual({ a: {}, b: { c: {} }, d: [{}], e: ["x", "y"] });
    expect(n.open).toEqual(["a", "b.c", "d[0]"]);
    expect(n.paths).toEqual({});
  });

  it("根不是物件就是 data 錯誤", () => {
    expect(() => normalizeState("mvu", [1, 2])).toThrow("data");
    expect(() => normalizeState("plain", "x")).toThrow("data");
  });
});

describe("讀回與往返", () => {
  it("MVU 原文 → 上游正規化 → 組回 MVU → 再正規化，結果相同", () => {
    const { first, draft, again } = roundTrip("mvu", MVU);
    expect(draft.convention).toBe("mvu");
    // 上游已把 recursiveExtensible 攤成每一層的 open，組回時逐層寫 extensible
    expect(again.data).toEqual(first.data);
    expect(again.paths).toEqual(first.paths);
    expect(again.open).toEqual(first.open);
    expect(again.required).toEqual(first.required);
  });

  it("兩個字串的清單沒有規則時包一層空規則，不會被讀成一對", () => {
    const text = rebuildStateText({ data: { 背包: ["短刀", "鐵護腕"], 成員: ["甲", "乙", "丙"] }, paths: { x: "unused" } }).dataText;
    // paths 裡有一條對不上的規則也照樣是 MVU；只有像一對的那份才包
    expect(JSON.parse(text)).toEqual({ 背包: [["短刀", "鐵護腕"], ""], 成員: ["甲", "乙", "丙"] });
    expect(normalizeState("mvu", JSON.parse(text)).data).toEqual({ 背包: ["短刀", "鐵護腕"], 成員: ["甲", "乙", "丙"] });
  });

  it("沒有規則、只有空物件可擴充時就是 plain，原樣顯示", () => {
    const { first, draft, again } = roundTrip("plain", '{"好感度": 1, "任務": {}, "背包": ["短刀", "鐵護腕"]}');
    expect(draft.convention).toBe("plain");
    expect(JSON.parse(draft.dataText)).toEqual({ 好感度: 1, 任務: {}, 背包: ["短刀", "鐵護腕"] });
    expect(again).toEqual(first);
  });

  it("MVU 寫的不可擴充空物件不能當 plain 讀回（plain 會讓它變成可擴充）", () => {
    const { first, draft, again } = roundTrip("mvu", '{"裝備": {}, "好感度": 1}');
    expect(first.open).toEqual([]);
    expect(draft.convention).toBe("mvu");
    expect(again).toEqual(first);
  });

  it("角色詳情帶 state 時草稿讀得到；壞掉或沒有就是 null", () => {
    const draft = draftFromRoleDetail({
      roleName: "x",
      state: { version: 2, data: { a: 1 }, panel: { template: "<b>{{a}}</b>" }, rules: { text: "規則", paths: {} }, open: [], required: [] },
    }, "zh-Hant");
    expect(draft.state).toEqual({ convention: "plain", dataText: '{\n  "a": 1\n}', rulesText: "規則", template: "<b>{{a}}</b>" });
    expect(draftFromRoleDetail({ roleName: "x" }, "zh-Hant").state).toBeNull();
    expect(readState({ version: 2, data: "not json" })).toBeNull();
    expect(readState({ version: 2, data: [1] })).toBeNull();
  });
});

describe("路徑寫法跟上游一致（含點、括號、引號的鍵寫成 [\"鍵\"]）", () => {
  it("正規化：鍵名像路徑語法時用中括號；清單索引不算被剝掉的標記", () => {
    const n = normalizeState("mvu", {
      $meta: { required: ["HP.max"] },
      "HP.max": [100, "上限"],
      "任務.a": { $meta: { extensible: true, required: ["x.y"] }, "x.y": [1, "內層"] },
      背包: ["$__META_EXTENSIBLE__$", { "名.稱": ["短刀", "物品"] }],
      "": [0, "空鍵"],
    });
    expect(n.paths).toEqual({ '["HP.max"]': "上限", '["任務.a"]["x.y"]': "內層", '背包[0]["名.稱"]': "物品", '[""]': "空鍵" });
    expect(n.open).toEqual(['["任務.a"]']);
    expect(n.required).toEqual(['["HP.max"]', '["任務.a"]["x.y"]']);
  });

  it("讀回 → 寫入體 → 上游再正規化：規則、可擴充、必填一條都不掉（含 MVU 原文放不下的清單元素規則）", () => {
    const server = {
      data: { "HP.max": 100, "任務.a": {}, 背包: [["短刀", "rule0"]], 屬性: { "x.y": 1 } },
      rules: { text: "", paths: { '["HP.max"]': "上限", "背包[0]": "清單元素的規則" } },
      open: ['["任務.a"]'],
      required: ['["HP.max"]', '屬性["x.y"]'],
    };
    const draft = readState(server)!;
    expect(draft.convention).toBe("mvu");
    expect(draft.pathRules).toEqual({ "背包[0]": "清單元素的規則" });
    const payload = statePayload(draft);
    expect(payload.rules).toEqual({ paths: { "背包[0]": "清單元素的規則" } });
    const again = normalizeState(payload.convention, payload.data, payload.rules?.paths);
    expect(again.data).toEqual(server.data);
    expect(again.paths).toEqual(server.rules.paths);
    expect(again.open).toEqual(server.open);
    expect(again.required).toEqual([...server.required].sort());
  });

  it("只有值的寫法也把逐值規則放進 rules.paths；對不上任何值的那幾條存檔時不送", () => {
    const draft: CardStateDraft = { convention: "plain", dataText: '{"背包": ["短刀"]}', rulesText: "", template: "", pathRules: { "背包[0]": "第一格", "背包[3]": "已刪掉的值" } };
    expect(statePayload(draft)).toEqual({ convention: "plain", data: { 背包: ["短刀"] }, rules: { paths: { "背包[0]": "第一格" } } });
  });
});

describe("切換寫法時轉換骨架", () => {
  const draft = (convention: "mvu" | "plain", dataText: string, extra: Partial<CardStateDraft> = {}): CardStateDraft => ({ convention, dataText, rulesText: "", template: "", ...extra });

  it("只有值 → MVU：兩個字串的清單包一層空規則，空物件標成可擴充，值不變", () => {
    const next = switchConvention(draft("plain", '{"背包": ["短刀", "鐵護腕"], "任務": {}, "好感度": 1}'), "mvu");
    expect(next.convention).toBe("mvu");
    expect(JSON.parse(next.dataText)).toEqual({ 背包: [["短刀", "鐵護腕"], ""], 任務: { $meta: { extensible: true } }, 好感度: 1 });
    const norm = normalizeState("mvu", JSON.parse(next.dataText));
    expect(norm.data).toEqual({ 背包: ["短刀", "鐵護腕"], 任務: {}, 好感度: 1 });
    expect(norm.paths).toEqual({});
    expect(norm.open).toEqual(["任務"]);
  });

  it("MVU → 只有值：值留在骨架，逐值規則搬到變數規則，一條一行", () => {
    const next = switchConvention(draft("mvu", '{"好感度": [100, "0 到 100"], "背包": [["短刀", "鐵護腕"], ""], "HP.max": [5, "上限"]}', { rulesText: "原本的規則" }), "plain");
    expect(next.convention).toBe("plain");
    expect(JSON.parse(next.dataText)).toEqual({ 好感度: 100, 背包: ["短刀", "鐵護腕"], "HP.max": 5 });
    expect(next.rulesText).toBe('原本的規則\n\n好感度: 0 到 100\n["HP.max"]: 上限');
  });

  it("骨架解不開或是空的：只換寫法，原文不動", () => {
    expect(switchConvention(draft("plain", '{"a": '), "mvu")).toEqual(draft("mvu", '{"a": '));
    expect(switchConvention(draft("mvu", ""), "plain")).toEqual(draft("plain", ""));
  });
});

describe("寫入體與變更判斷", () => {
  const state: CardStateDraft = { convention: "mvu", dataText: '{"a": [1, "r"]}', rulesText: "  ", template: "" };

  it("規則與皮膚空白就不送", () => {
    expect(statePayload(state)).toEqual({ convention: "mvu", data: { a: [1, "r"] } });
    expect(statePayload({ ...state, rulesText: "每輪更新", template: "<div/>" })).toEqual({
      convention: "mvu", data: { a: [1, "r"] }, rules: { text: "每輪更新" }, panel: { template: "<div/>" },
    });
  });

  it("新卡有骨架才算改過；舊卡比對整份", () => {
    const draft = makeDraft("zh-Hant");
    expect(stateChanged(draft, null)).toBe(false);
    draft.state = { ...state, dataText: "" };
    expect(stateChanged(draft, null)).toBe(false);
    draft.state = state;
    expect(stateChanged(draft, null)).toBe(true);
    const original = makeDraft("zh-Hant");
    original.state = { ...state };
    expect(stateChanged(draft, original)).toBe(false);
    draft.state = null;
    expect(stateChanged(draft, original)).toBe(true);
  });
});

describe("本地檢查與每輪大小", () => {
  const draft = (dataText: string, extra: Partial<CardStateDraft> = {}): CardStateDraft => ({ convention: "plain", dataText, rulesText: "", template: "", ...extra });

  it("骨架空了但規則或皮膚還有字：不算移除，是骨架的錯", () => {
    expect(stateEmpty(draft(""))).toBe(true);
    expect(stateEmpty(draft("", { rulesText: "規則" }))).toBe(false);
    expect(stateEmpty(draft(" ", { template: "<b/>" }))).toBe(false);
    expect(stateProblem(draft("", { rulesText: "規則" }))).toBe("data");
    expect(stateProblem(draft("", { template: "<b/>" }))).toBe("data");
  });

  it("照上游的上限點名原因", () => {
    expect(stateProblem(null)).toBeNull();
    expect(stateProblem(draft(""))).toBeNull();
    expect(stateProblem(draft("{"))).toBe("data");
    expect(stateProblem(draft("[]"))).toBe("data");
    expect(stateProblem(draft(JSON.stringify({ s: "字".repeat(700) })))).toBe("string_size");
    let deep: unknown = 1;
    for (let i = 0; i < 9; i++) deep = { d: deep };
    expect(stateProblem(draft(JSON.stringify(deep)))).toBe("depth");
    expect(stateProblem(draft(JSON.stringify(Object.fromEntries(Array.from({ length: 401 }, (_, i) => [`k${i}`, i])))))).toBe("keys");
    expect(stateProblem(draft(JSON.stringify(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "x".repeat(900)])))))).toBe("data_size");
    expect(stateProblem(draft("{}", { rulesText: "x".repeat(STATE_LIMITS.rulesTextBytes + 1) }))).toBe("rules_text_size");
    expect(stateProblem(draft("{}", { template: "x".repeat(STATE_LIMITS.templateBytes + 1) }))).toBe("template_size");
    expect(stateProblem(draft('{"a": 1}'))).toBeNull();
  });

  it("每輪大小算的是正規化後的值，不含規則", () => {
    expect(stateTurnSize({ convention: "mvu", dataText: '{"好感度": [10, "很長很長的規則"]}', rulesText: "", template: "" })).toEqual({ chars: 10, bytes: 16 });
    expect(stateTurnSize(draft("{"))).toBeNull();
  });
});

describe("deepMerge", () => {
  it("物件逐層合併，清單與純值由後面的蓋掉", () => {
    expect(deepMerge({ a: { x: 1, y: [1] }, b: 1 }, { a: { y: [2], z: 3 }, c: 4 })).toEqual({ a: { x: 1, y: [2], z: 3 }, b: 1, c: 4 });
  });
});
