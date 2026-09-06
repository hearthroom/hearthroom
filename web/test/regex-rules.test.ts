import { describe, expect, it } from "vitest";
import { applyRules, makeRule, parseFind, renderWithRules, ruleSetFromImport, ruleSetToExport, rulesFromTavern, validateRuleSet } from "../src/lib/regex-rules";

describe("parseFind", () => {
  it("/pat/flags 是正則，其他是字面", () => {
    expect(parseFind("/『([\\s\\S]*?)』/g")).toBeInstanceOf(RegExp);
    expect(parseFind("《美1》")).toBe("《美1》");
    expect(parseFind("<!-- 地图JS -->")).toBe("<!-- 地图JS -->");
    expect(parseFind("/[unclosed/g")).toBeInstanceOf(Error);
  });
});

describe("applyRules", () => {
  it("依序套用：正則帶 $1，字面全部替換，停用與壞規則跳過", () => {
    const rules = [
      makeRule({ name: "color", find: "/『([\\s\\S]*?)』/g", replace: '<span class="q">『$1』</span>' }),
      makeRule({ name: "marker", find: "《美1》", replace: "<style>.q{color:red}</style>" }),
      makeRule({ name: "off", find: "《美1》", replace: "SHOULD NOT", enabled: false }),
      makeRule({ name: "bad", find: "/[/g", replace: "x" }),
    ];
    const out = applyRules("她說『你來了』。《美1》《美1》", rules);
    expect(out).toBe('她說<span class="q">『你來了』</span>。<style>.q{color:red}</style><style>.q{color:red}</style>');
  });

  it("statusbar 只接在最近的回覆後面，再套規則", () => {
    const set = { version: 1 as const, rules: [makeRule({ find: "《状1》", replace: "<div>HP</div>" })], statusbar: "《状1》", depth: 1 };
    expect(renderWithRules("正文", set, true)).toBe("正文\n<div>HP</div>");
    expect(renderWithRules("正文", set, false)).toBe("正文");
  });
});

describe("匯入匯出", () => {
  const meimo = { pageDepth: 2, statusbar: "《美1》《状1》", beginning: "<开局面板>", regex_scripts: [
    { id: -1, scriptName: "替换颜色『』", findRegex: "/『([\\s\\S]*?)』/g", replaceString: '<span style="color:#AB47BC">『$1』</span>' },
    { id: -1, scriptName: "《美1》", findRegex: "《美1》", replaceString: "<style>…</style>" },
  ] };

  it("魅魔島檔：規則、statusbar、depth 都進來，beginning 另外回", () => {
    const got = ruleSetFromImport(meimo)!;
    expect(got.set.rules.map((r) => r.name)).toEqual(["替换颜色『』", "《美1》"]);
    expect(got.set.statusbar).toBe("《美1》《状1》");
    expect(got.set.depth).toBe(2);
    expect(got.welcome).toBe("<开局面板>");
    expect(got.set.rules.every((r) => r.enabled && r.id)).toBe(true);
  });

  it("酒館卡的 extensions.regex_scripts 與裸陣列也吃；disabled 帶過來", () => {
    const card = { spec: "chara_card_v3", data: { name: "x", extensions: { regex_scripts: [{ scriptName: "s", findRegex: "/a/g", replaceString: "b", disabled: true }] } } };
    expect(ruleSetFromImport(card)!.set.rules[0]).toMatchObject({ name: "s", enabled: false });
    expect(rulesFromTavern([{ findRegex: "x", replaceString: "y" }])[0].name).toBe("#1");
    expect(ruleSetFromImport({ foo: 1 })).toBeNull();
  });

  it("本站自己存的文件讀得回來：rules 陣列、depth、statusbar 原樣，缺 id 補一個", () => {
    const doc = { version: 1, depth: 3, statusbar: "《s》", rules: [{ id: "k", name: "n", find: "x", replace: "y", enabled: false }, { find: "/a/g", replace: "b" }] };
    const got = ruleSetFromImport(doc)!;
    expect(got.set.depth).toBe(3);
    expect(got.set.statusbar).toBe("《s》");
    expect(got.set.rules[0]).toEqual({ id: "k", name: "n", find: "x", replace: "y", enabled: false });
    expect(got.set.rules[1]).toMatchObject({ find: "/a/g", replace: "b", enabled: true });
    expect(got.set.rules[1].id).toBeTruthy();
    expect(ruleSetFromImport({ version: 1, rules: [] })).toBeNull();
  });

  it("匯出再匯入是同一份", () => {
    const got = ruleSetFromImport(meimo)!;
    const back = ruleSetFromImport(ruleSetToExport(got.set, got.welcome))!;
    expect(back.set.rules.map((r) => [r.name, r.find, r.replace, r.enabled])).toEqual(got.set.rules.map((r) => [r.name, r.find, r.replace, r.enabled]));
    expect(back.welcome).toBe("<开局面板>");
    expect(back.set.depth).toBe(2);
  });
});

describe("validateRuleSet", () => {
  it("空 find、壞正則、超長都有對應的 key", () => {
    const set = { version: 1 as const, depth: 1, statusbar: "", rules: [
      makeRule({ id: "a", find: "" }), makeRule({ id: "b", find: "/[/g" }), makeRule({ id: "c", find: "x", replace: "y".repeat(20001) }),
    ] };
    const keys = validateRuleSet(set).map((i) => i.ruleId + ":" + i.key);
    expect(keys).toEqual(expect.arrayContaining(["a:regex.issue.emptyFind", "b:regex.issue.badRegex", "c:regex.issue.replaceLong"]));
  });
});
