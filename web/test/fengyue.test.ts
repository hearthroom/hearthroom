/**
 * AI 風月匯出檔的匯入。
 *
 * 風月每次匯出都從別名池隨機挑頂層鍵名（同一張卡匯出 11 次，標題鍵就出現過 title／ttl／name／nm／app_name），
 * 所以用例是同一張卡換上不同的別名組合。用例檔與 CLI 的 internal/importer/testdata/fengyue-cases.json
 * 是同一份；兩邊都照它比對，網頁與 CLI 的匯入結果才會一致。
 */
import { describe, expect, it } from "vitest";
import { createApp, nextTick } from "vue";
import ImportPanel from "../src/components/editor/ImportPanel.vue";
import { i18n } from "../src/lib/i18n";
import cases from "./fixtures/fengyue-cases.json";
import format from "../src/lib/fengyue-format.json";
import { fengyueToDraft, isFengyueExport } from "../src/lib/fengyue";
import { installCard, renderContent } from "../../stage/src/sandbox/rules";
import { stylePolicyFor } from "../../stage/src/common/author-style-policy";
import { compileCardCss } from "../../stage/src/common/card-css";

type Case = { name: string; input: Record<string, unknown>; expect: Record<string, unknown> & { fengyue: boolean } };

function project(input: Record<string, unknown>) {
  const result = fengyueToDraft(input, { language: "zh-Hans" });
  const rules = result.regex?.rules ?? [];
  return {
    fengyue: true,
    name: result.draft.roleName,
    summary: result.draft.roleDesc,
    definition: result.draft.roleDetailDesc,
    outputContract: result.draft.roleOutputContract,
    custom: result.draft.jailbreak,
    intro: result.intro,
    prologue: result.draft.prologue,
    css: result.regex?.cardCss ?? "",
    lorebook: (result.worldbook?.entries ?? []).map((e) => ({
      name: e.name,
      content: e.content,
      keywords: e.keywords,
      triggerRegion: e.triggerRegion ?? "",
      enabled: e.isEnabled,
      order: e.matchOptions?.order ?? 0,
    })),
    rules: rules.map((r) => ({ name: r.name, find: r.find, replace: r.replace, enabled: r.enabled, targets: r.targets ?? null })),
    notes: result.dropped.map((n) => n.key).filter((k) => k.startsWith("import.fengyue.")).map((k) => k.slice("import.fengyue.".length)).sort(),
  };
}

describe("風月匯出檔：共用用例", () => {
  for (const c of (cases as { cases: Case[] }).cases) {
    it(c.name, () => {
      expect(isFengyueExport(c.input)).toBe(c.expect.fengyue);
      if (c.expect.fengyue) expect(project(c.input)).toEqual(c.expect);
    });
  }
});

describe("風月匯出檔：網頁這邊的落點", () => {
  const sample = (cases as { cases: Case[] }).cases[0].input;

  it.each(["\n\t#ai-chat-input { background: #bde8f2; }\r\n/* 結尾 */ \t\r\n", " \r\n\t"])("內置 CSS 保留前後空白與原文字節：%j", (css) => {
    const raw = Object.fromEntries(Object.entries(sample).filter(([key]) => !format.fields.css.includes(key)));
    const result = fengyueToDraft({ ...raw, custom_css: css }, { language: "zh-Hant" });
    expect(result.regex?.cardCss).toBe(css);
    expect(new TextEncoder().encode(result.regex?.cardCss)).toEqual(new TextEncoder().encode(css));
    expect(result.regex?.cardCssDialect).toBe("fengyue-v2");
  });

  it("內置 CSS 在沙箱裝卡時成為常駐樣式", () => {
    const result = fengyueToDraft(sample, { language: "zh-Hans" });
    expect(result.regex?.pageMode).toBe("sandbox");
    const css = compileCardCss(result.regex!);
    expect(css).toContain(".st-bar");
    expect(css).toContain("color:#c33");
  });

  it("示範卡在沙箱裝卡時：AI 輸出正則只改 AI 訊息、全部訊息正則兩邊都改、內置 CSS 與狀態欄落地", () => {
    const demo = (cases as { cases: Case[] }).cases.find((c) => c.name.startsWith("real demo card, opening-choice mode"))!.input;
    const result = fengyueToDraft(demo, { language: "zh-Hans" });
    expect(result.regex?.pageMode).toBe("sandbox");
    expect(result.regex?.format).toBe("fengyue");
    expect(result.regex?.openingPage).toContain("FY-INTRO 星灯茶馆");
    const installed = installCard(result.regex!.rules, stylePolicyFor(result.regex!.format ?? "fengyue"));
    expect(result.regex?.cardCss).toContain(".st-bar{color:#c33;font-weight:700;border-left:4px solid #c33;padding-left:8px}");
    expect(compileCardCss(result.regex!)).toContain(".st-bar");
    expect(compileCardCss(result.regex!)).toContain("color:#c33");
    const userHtml = renderContent("我是茶客3号，暗号是 FYSWAP", installed.rules, { messageRole: "user", macros: { user: "旅人", char: "阿萤" } });
    expect(userHtml).toContain("【FY-RGX-第3位客人】");
    expect(userHtml).toContain("FYSWAP");
    expect(userHtml).not.toContain("FY-已替换");
    const aiHtml = renderContent("欢迎茶客3号，这里是 FYSWAP。<div class=\"st-bar\">FY-STATUSBAR 今夜客人：1 位</div>", installed.rules, { messageRole: "ai", macros: { user: "旅人", char: "阿萤" } });
    expect(aiHtml).toContain("【FY-RGX-第3位客人】");
    expect(aiHtml).toContain("FY-已替换");
    expect(aiHtml).not.toContain("FYSWAP");
    expect(aiHtml).toContain('<div class="st-bar">FY-STATUSBAR 今夜客人：1 位</div>');
  });

  it("超過本站上限的欄位整段保留並列出，不截斷", () => {
    const long = { ...sample, posttxt: "長".repeat(600) };
    const result = fengyueToDraft(long, { language: "zh-Hans" });
    expect([...result.draft.jailbreak].length).toBe(600);
    expect(result.dropped).toContainEqual({ key: "import.fengyue.tooLong.custom", params: { n: 600, max: 500 } });
  });

  it("世界書條目太長時拆開，不丟字", () => {
    const entry = { ...(sample.wb as Record<string, unknown>[])[0], value: "字".repeat(4500) };
    const result = fengyueToDraft({ ...sample, wb: [entry] }, { language: "zh-Hans" });
    expect(result.worldbook?.entries.map((e) => e.content).join("")).toBe("字".repeat(4500));
    expect(result.dropped.some((n) => n.key === "import.split.entries")).toBe(true);
  });

  it("每一條摘要都有五種語言的文字", async () => {
    const locales = ["zh-Hant", "zh-Hans", "en", "ja", "ko"];
    const edge = (cases as { cases: Case[] }).cases.find((c) => c.name.startsWith("unverified"))!.input;
    const keys = new Set([
      ...fengyueToDraft(edge, { language: "zh-Hans" }).dropped.map((n) => n.key),
      ...["name", "summary", "definition", "outputContract", "custom"].map((f) => `import.fengyue.tooLong.${f}`),
      "import.fengyue.presetChats", "import.fengyue.unusedOpenings", "import.fengyue.missingFields", "import.fengyue.openingModeUnknown", "import.kind.fengyue", "import.fengyue.drop", "import.fengyue.formats", "import.landed.outputContract", "import.landed.custom", "import.landed.prologue", "import.landed.openingPage",
      "import.landed.state", "import.fengyue.variablesConverted", "import.fengyue.variablesPartial", "import.fengyue.variablesPromptOnly",
      "import.fengyue.variablesTemplateOnly", "import.fengyue.variablesUnknown",
    ]);
    for (const locale of locales) {
      const messages = (await import(`../src/locales/${locale}.json`)).default as Record<string, string>;
      for (const key of keys) expect(messages[key], `${locale} 缺 ${key}`).toBeTruthy();
    }
  });
});

describe("風月匯出檔：變量面板 → 卡片變數", () => {
  const sample = (cases as { cases: Case[] }).cases[0].input;
  /** 拿掉樣本裡的變量三欄（各種別名），換成指定的鍵。 */
  const withVars = (vars: Record<string, unknown>) => {
    const rest = Object.fromEntries(Object.entries(sample).filter(([k]) => !/^ai_v/.test(k)));
    return { ...rest, ...vars };
  };

  for (const [skeletonKey, promptKey, templateKey] of [
    ["ai_v_json", "ai_variable_text", "ai_variable_template"],
    ["ai_variable_json", "ai_v_prompt", "ai_v_template"],
    ["ai_v_json", "ai_variable_prompt", "ai_variable_tmpl"],
  ]) {
    it(`骨架（${skeletonKey}）、提示詞（${promptKey}）、皮膚（${templateKey}）都帶過去`, () => {
      const input = withVars({ [skeletonKey]: '{"好感度": 0, "任務": {}}', [promptKey]: "好感度隨互動變化", [templateKey]: "<b>{{好感度}}</b>" });
      expect(isFengyueExport(input)).toBe(true);
      const result = fengyueToDraft(input, { language: "zh-Hans" });
      expect(result.draft.state).toEqual({ convention: "plain", dataText: '{\n  "好感度": 0,\n  "任務": {}\n}', rulesText: "好感度隨互動變化", template: "<b>{{好感度}}</b>" });
      const keys = result.dropped.map((n) => n.key);
      expect(keys).toContain("import.fengyue.variablesConverted");
      expect(keys).not.toContain("import.fengyue.variablesPromptOnly");
      expect(keys).not.toContain("import.fengyue.missingFields");
    });
  }

  it("只有提示詞、骨架是空字串：不開，提示詞原文留在摘要", () => {
    const result = fengyueToDraft(withVars({ ai_v_json: "", ai_variable_text: "每輪更新好感度", ai_variable_template: "" }), { language: "zh-Hans" });
    expect(result.draft.state).toBeNull();
    expect(result.dropped).toContainEqual({ key: "import.fengyue.variablesPromptOnly", params: { text: "每輪更新好感度" } });
  });

  it("骨架解不開：原文放進去，摘要說要修", () => {
    const result = fengyueToDraft(withVars({ ai_v_json: "{好感度: 0", ai_variable_text: "", ai_variable_template: "" }), { language: "zh-Hans" });
    expect(result.draft.state).toEqual({ convention: "plain", dataText: "{好感度: 0", rulesText: "", template: "" });
    expect(result.dropped.map((n) => n.key)).toContain("import.fengyue.variablesPartial");
  });

  it("三欄都空：沒有卡片變數，也沒有變量相關的摘要", () => {
    const result = fengyueToDraft(withVars({ ai_v_json: "", ai_variable_text: "", ai_variable_template: "" }), { language: "zh-Hans" });
    expect(result.draft.state).toBeNull();
    expect(result.dropped.filter((n) => n.key.startsWith("import.fengyue.variables"))).toEqual([]);
  });

  it("別名表沒收的變量鍵有內容時另外列出", () => {
    const result = fengyueToDraft(withVars({ ai_v_json: "", ai_variable_text: "", ai_variable_template: "", ai_variable_extra: "something" }), { language: "zh-Hans" });
    expect(result.dropped.map((n) => n.key)).toContain("import.fengyue.variablesUnknown");
  });
});

describe("匯入面板認得風月的檔", () => {
  const all = (cases as { cases: Case[] }).cases;
  const flush = async () => { for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };

  async function drop(tab: number, input: Record<string, unknown>) {
    localStorage.clear();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const app = createApp(ImportPanel, { language: "zh-Hant" }).use(i18n);
    app.mount(el);
    await nextTick();
    el.querySelectorAll<HTMLElement>(".seg__item")[tab].click();
    await nextTick();
    const file = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(file, "files", { value: [new File([JSON.stringify(input)], "export.json", { type: "application/json" })], configurable: true });
    file.dispatchEvent(new Event("change"));
    await flush();
    return { el, done: () => { app.unmount(); el.remove(); } };
  }

  // 0 酒館、1 MMD、2 風月：作者丟錯分頁也要認得
  for (const [tab, label] of [[0, "酒館分頁"], [1, "MMD 分頁"], [2, "風月分頁"]] as const) {
    it(`${label}：標題鍵剛好是 name 的那份也整張帶進來，摘要列出沒轉的`, async () => {
      const input = all.find((c) => c.name.startsWith("title key is name"))!.input;
      const { el, done } = await drop(tab, input);
      expect(el.querySelector(".import__error")).toBeNull();
      const text = el.querySelector(".review")?.textContent ?? "";
      expect(text).toContain("xB_au9VW");
      expect(text).toContain(i18n.global.t("import.landed.prologue", { n: 1 }));
      expect(text).toContain(i18n.global.t("import.landed.custom", { n: [..."TEST-POST-TEXT 后置词"].length }));
      expect(el.querySelector('[data-import-card-css]')).not.toBeNull();
      expect(text).toContain(i18n.global.t("import.fengyue.shortcuts", { n: 1 }));
      expect(el.querySelector(".seg__item--on")?.textContent?.trim()).toBe(tab === 0 ? i18n.global.t("import.kind.tavern") : i18n.global.t("import.kind.fengyue"));
      done();
    });
  }
});
