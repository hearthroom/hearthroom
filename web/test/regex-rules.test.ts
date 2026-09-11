import { describe, expect, it } from "vitest";
import { applyRules, makeRule, parseFind, renderStatusbar, renderWithRules, ruleSetFromAuthorAsset, ruleSetFromImport, ruleSetToAuthorAsset, ruleSetToExport, rulesFromTavern, ruleSetBytes, validateRuleSet, REGEX_LIMITS } from "../src/lib/regex-rules";

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

  it("功能欄自己過規則、跟訊息分開；訊息渲染不再接功能欄", () => {
    const set = { version: 1 as const, rules: [makeRule({ find: "《状1》", replace: "<div>HP</div>" })], statusbar: "《状1》", lowered: false };
    expect(renderStatusbar(set)).toBe("<div>HP</div>");
    expect(renderWithRules("正文《状1》", set)).toBe("正文<div>HP</div>");
    expect(renderStatusbar({ ...set, statusbar: "" })).toBe("");
  });
});

describe("匯入匯出", () => {
  const meimo = { pageDepth: 1, statusbar: "《美1》《状1》", beginning: "<开局面板>", regex_scripts: [
    { id: -1, scriptName: "替换颜色『』", findRegex: "/『([\\s\\S]*?)』/g", replaceString: '<span style="color:#AB47BC">『$1』</span>' },
    { id: -1, scriptName: "《美1》", findRegex: "《美1》", replaceString: "<style>…</style>" },
  ] };

  it("魅魔島檔：pageDepth 2（沒勾降低層級）與缺欄位都是頁面最上層", () => {
    expect(ruleSetFromImport({ ...meimo, pageDepth: 2 })!.set.lowered).toBe(false);
    const { pageDepth: _omit, ...noDepth } = meimo;
    expect(ruleSetFromImport(noDepth)!.set.lowered).toBe(false);
    expect(ruleSetToExport(ruleSetFromImport(meimo)!.set, "").pageDepth).toBe(1);
    expect(ruleSetToExport({ version: 1, rules: [], statusbar: "", lowered: false }, "").pageDepth).toBe(2);
  });

  it("酒館規則只收作用於 AI 輸出的：placement 沒有 2 的丟掉，沒寫 placement 的全收", () => {
    const scripts = [
      { scriptName: "in", findRegex: "/a/", replaceString: "", placement: [1] },
      { scriptName: "out", findRegex: "/b/", replaceString: "", placement: [1, 2] },
      { scriptName: "any", findRegex: "/c/", replaceString: "" },
    ];
    expect(ruleSetFromImport(scripts)!.set.rules.map((r) => r.name)).toEqual(["out", "any"]);
  });

  it("魅魔島匯入酬載：rules + statusbar + welcome + pageDepth", () => {
    const payload = { rules: [{ find: "《x》", replace: "<b/>" }], statusbar: "《x》", welcome: "hi", pageDepth: 1 };
    const got = ruleSetFromImport(payload)!;
    expect(got.set.rules).toHaveLength(1);
    expect(got.set.lowered).toBe(true);
    expect(got.welcome).toBe("hi");
  });

  it("魅魔島檔：規則、功能欄、pageDepth 1→降低層級 都進來，beginning 另外回", () => {
    const got = ruleSetFromImport(meimo)!;
    expect(got.set.rules.map((r) => r.name)).toEqual(["替换颜色『』", "《美1》"]);
    expect(got.set.statusbar).toBe("《美1》《状1》");
    expect(got.set.lowered).toBe(true);
    expect(got.welcome).toBe("<开局面板>");
    expect(got.set.rules.every((r) => r.enabled && r.id)).toBe(true);
  });

  it("酒館卡的 extensions.regex_scripts 與裸陣列也吃；disabled 帶過來", () => {
    const card = { spec: "chara_card_v3", data: { name: "x", extensions: { regex_scripts: [{ scriptName: "s", findRegex: "/a/g", replaceString: "b", disabled: true }] } } };
    expect(ruleSetFromImport(card)!.set.rules[0]).toMatchObject({ name: "s", enabled: false });
    expect(rulesFromTavern([{ findRegex: "x", replaceString: "y" }])[0].name).toBe("#1");
    expect(ruleSetFromImport({ foo: 1 })).toBeNull();
  });

  it("本站自己存的文件讀得回來：rules 陣列、lowered、statusbar 原樣，缺 id 補一個", () => {
    const doc = { version: 1, lowered: true, statusbar: "《s》", rules: [{ id: "k", name: "n", find: "x", replace: "y", enabled: false }, { find: "/a/g", replace: "b" }] };
    const got = ruleSetFromImport(doc)!;
    expect(got.set.lowered).toBe(true);
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
    expect(back.set.lowered).toBe(true);
  });
});

describe("validateRuleSet", () => {
  it("空 find、壞正則、超長都有對應的 key", () => {
    const set = { version: 1 as const, lowered: false, statusbar: "", rules: [
      makeRule({ id: "a", find: "" }), makeRule({ id: "b", find: "/[/g" }), makeRule({ id: "c", find: "x", replace: "y".repeat(REGEX_LIMITS.replaceBytes + 1) }),
    ] };
    const keys = validateRuleSet(set).map((i) => i.ruleId + ":" + i.key);
    expect(keys).toEqual(expect.arrayContaining(["a:regex.issue.emptyFind", "b:regex.issue.badRegex", "c:regex.issue.replaceLong"]));
  });

  // 2026-09-11 一位作者匯入 66 條、1.18 MB 的規則檔：上游放寬到 32 MB 後這裡也要放行，
  // 而且量法要跟上游一樣（每條 id+name+find+replace 的位元組加總，不是整份 JSON 的長度）。
  it("整份大小照上游的算法量；幾 MB 的真實規則檔過得了；超過時說多大、上限多少", () => {
    const rules = Array.from({ length: 66 }, (_, i) => makeRule({ id: `r${i}`, name: "圖片集", find: "x", replace: "字".repeat(6000) }));
    const set = { version: 1 as const, lowered: false, statusbar: "", rules };
    const enc = (s: string) => new TextEncoder().encode(s).length;
    expect(ruleSetBytes(set)).toBe(rules.reduce((n, r) => n + enc(r.id) + enc(r.name) + enc(r.find) + enc(r.replace), 0));
    expect(ruleSetBytes(set)).toBeLessThan(enc(JSON.stringify(set)));
    expect(ruleSetBytes(set)).toBeGreaterThan(1024 * 1024);
    expect(validateRuleSet(set).map((i) => i.key)).not.toContain("regex.issue.totalLong");

    // 條數上限 500，300 條 × 128 KB 就超過整份 32 MB：整份的提示要響、條數的不響。
    const huge = { ...set, rules: Array.from({ length: 300 }, (_, i) => makeRule({ id: `h${i}`, find: "x", replace: "y".repeat(REGEX_LIMITS.replaceBytes) })) };
    const whole = validateRuleSet(huge).find((i) => i.key === "regex.issue.totalLong");
    expect(whole).toBeDefined();
    expect(whole!.ruleId).toBe("");
    expect(whole!.params?.max).toBe(32);
    expect(Number(whole!.params?.size)).toBeGreaterThan(32);
    expect(validateRuleSet(huge).map((i) => i.key)).not.toContain("regex.issue.tooMany");
  });
});

describe("上游作者資產 ↔ 本站規則組", () => {
  it("mountTrigger→功能欄、under→降低層級；cover 與 pageMode 帶著走不丟", () => {
    const set = ruleSetFromAuthorAsset({ rules: [{ id: "a", name: "n", find: "x", replace: "y", enabled: true }], mountTrigger: "《美1》", mountLayer: "under", pageMode: "immersive" });
    expect(set.statusbar).toBe("《美1》");
    expect(set.lowered).toBe(true);
    expect(set.pageMode).toBe("immersive");
    const back = ruleSetToAuthorAsset(set, 3);
    expect(back).toMatchObject({ mountTrigger: "《美1》", mountLayer: "under", pageMode: "immersive", version: 3 });
    expect(back.rules).toEqual([{ id: "a", name: "n", find: "x", replace: "y", enabled: true }]);

    const cover = ruleSetFromAuthorAsset({ rules: [], mountTrigger: "", mountLayer: "cover" });
    expect(cover.lowered).toBe(false);
    expect(ruleSetToAuthorAsset(cover, 0).mountLayer).toBe("cover");
    // 沒設過：status none、mountLayer 空 → 最上層
    expect(ruleSetToAuthorAsset(ruleSetFromAuthorAsset({}), 0).mountLayer).toBe("over");
  });
});
