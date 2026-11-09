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
import { fengyueToDraft, isFengyueExport, FENGYUE_CSS_RULE_ID } from "../src/lib/fengyue";
import { installCard } from "../../stage/src/sandbox/rules";
import { stylePolicyFor } from "../../stage/src/common/author-style-policy";

type Case = { name: string; input: Record<string, unknown>; expect: Record<string, unknown> & { fengyue: boolean } };

function project(input: Record<string, unknown>) {
  const result = fengyueToDraft(input, { language: "zh-Hans" });
  const rules = result.regex?.rules ?? [];
  const cssRule = rules.find((r) => r.id === FENGYUE_CSS_RULE_ID);
  return {
    fengyue: true,
    name: result.draft.roleName,
    summary: result.draft.roleDesc,
    definition: result.draft.roleDetailDesc,
    outputContract: result.draft.roleOutputContract,
    custom: result.draft.jailbreak,
    intro: result.intro,
    prologue: result.draft.prologue,
    css: cssRule ? /<style>([\s\S]*)<\/style>/.exec(cssRule.replace)?.[1] ?? "" : "",
    lorebook: (result.worldbook?.entries ?? []).map((e) => ({
      name: e.name,
      content: e.content,
      keywords: e.keywords,
      triggerRegion: e.triggerRegion ?? "",
      enabled: e.isEnabled,
      order: e.matchOptions?.order ?? 0,
    })),
    rules: rules.filter((r) => r.id !== FENGYUE_CSS_RULE_ID).map((r) => ({ name: r.name, find: r.find, replace: r.replace, enabled: r.enabled, targets: r.targets ?? null })),
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

  it("內置 CSS 在沙箱裝卡時成為常駐樣式", () => {
    const result = fengyueToDraft(sample, { language: "zh-Hans" });
    expect(result.regex?.pageMode).toBe("sandbox");
    const installed = installCard(result.regex!.rules, stylePolicyFor(result.regex!.format ?? "mmd"));
    expect(installed.styles.join("\n")).toContain(".st-bar{color:#c33");
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
    ]);
    for (const locale of locales) {
      const messages = (await import(`../src/locales/${locale}.json`)).default as Record<string, string>;
      for (const key of keys) expect(messages[key], `${locale} 缺 ${key}`).toBeTruthy();
    }
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
      expect(text).toContain(i18n.global.t("import.fengyue.shortcuts", { n: 1 }));
      expect(el.querySelector(".seg__item--on")?.textContent?.trim()).toBe(tab === 0 ? i18n.global.t("import.kind.tavern") : i18n.global.t("import.kind.fengyue"));
      done();
    });
  }
});
