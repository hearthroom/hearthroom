/**
 * 日里（talkaicc.com / Rili AI）匯出檔與獨立世界書的匯入測試。
 *
 * 共用測試集 test/fixtures/rili-cases.json 與 CLI 的 internal/importer/testdata/rili-cases.json
 * 為同一份檔案；網頁端與 CLI 匯入後投影必須完全一致。
 */
import { describe, expect, it } from "vitest";
import { createApp, nextTick } from "vue";
import ImportPanel from "../src/components/editor/ImportPanel.vue";
import { i18n } from "../src/lib/i18n";
import cases from "./fixtures/rili-cases.json";
import { isRiliExport, isRiliLorebook, riliToDraft } from "../src/lib/rili";
import { parseWorldbookFile } from "../src/lib/tavern";
import { classifyMmdFile, mergeMmdFiles } from "../src/lib/mmd";
import { statePayload, stateProblem } from "../src/lib/card-state";

type Case = {
  name: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown> & { rili: boolean; riliLorebook?: boolean };
};

function noteCode(key: string): string {
  for (const prefix of ["import.rili.", "import.fengyue.", "import.drop."]) {
    if (key.startsWith(prefix)) return key.slice(prefix.length);
  }
  return key;
}

function projectLorebook(entries: NonNullable<ReturnType<typeof riliToDraft>["worldbook"]>["entries"]) {
  return entries.map((e) => {
    expect(e.matchOptions?.extensions).toBeUndefined();
    return {
      name: e.name,
      content: e.content,
      keywords: e.keywords,
      secondaryKeywords: e.secondaryKeywords,
      selective: e.matchOptions?.selective ?? false,
      selectiveLogic: e.matchOptions?.selectiveLogic ?? 0,
      scanDepth: e.matchOptions?.scanDepth ?? 0,
      order: e.matchOptions?.order ?? 0,
      triggerRegion: e.triggerRegion ?? "",
      enabled: e.isEnabled,
    };
  });
}

function project(input: Record<string, unknown>) {
  const result = riliToDraft(input, { language: "zh-Hans" });
  const rules = result.regex?.rules ?? [];
  let state: Record<string, unknown> | null = null;
  if (result.draft.state) {
    let data: unknown = result.draft.state.dataText;
    try {
      data = JSON.parse(result.draft.state.dataText);
    } catch {
      /* 壞掉的 JSON 保留原文字串供比對 */
    }
    state = {
      convention: result.draft.state.convention,
      data,
      rulesText: result.draft.state.rulesText,
      template: result.draft.state.template,
      pathRules: result.draft.state.pathRules ?? {},
    };
  }
  return {
    rili: true,
    name: result.draft.roleName,
    summary: result.draft.roleDesc,
    tags: result.draft.roleTag,
    definition: result.draft.roleDetailDesc,
    outputContract: result.draft.roleOutputContract,
    custom: result.draft.jailbreak,
    intro: result.regex?.openingPage ?? "",
    css: result.regex?.cardCss ?? "",
    cssDialect: result.regex?.cardCssDialect ?? "",
    lorebook: projectLorebook(result.worldbook?.entries ?? []),
    rules: rules.map((r) => ({
      name: r.name,
      find: r.find,
      replace: r.replace,
      enabled: r.enabled,
      targets: r.targets ?? null,
    })),
    state,
    notes: result.dropped
      .map((n) => n.key)
      .filter((k) => k !== "import.split.entries")
      .map(noteCode)
      .sort(),
  };
}

describe("日里匯出檔：共用用例", () => {
  for (const c of (cases as { cases: Case[] }).cases) {
    it(c.name, async () => {
      expect(isRiliExport(c.input)).toBe(c.expect.rili);
      expect(isRiliLorebook(c.input)).toBe(Boolean(c.expect.riliLorebook));
      if (c.expect.rili) {
        expect(project(c.input)).toEqual(c.expect);
      }
      if (c.expect.riliLorebook) {
        const json = JSON.stringify(c.input);
        const wb = await parseWorldbookFile(new File([json], "lorebook.json", { type: "application/json" }), "zh-Hans");
        expect(projectLorebook(wb.entries)).toEqual(c.expect.lorebook);
        expect(wb.dropped.map((n) => noteCode(n.key)).sort()).toEqual(c.expect.notes);

        const classified = classifyMmdFile("lorebook.json", json);
        expect(classified.part).toBe("book");
        const merged = mergeMmdFiles([classified], { language: "zh-Hans" });
        expect(projectLorebook(merged.worldbook?.entries ?? [])).toEqual(c.expect.lorebook);
        expect(merged.dropped.map((n) => noteCode(n.key)).sort()).toEqual(c.expect.notes);
      }
    });
  }
});

describe("日里匯出檔：網頁落點與變數驗證", () => {
  const all = (cases as { cases: Case[] }).cases;
  const sampleA = all[0].input;

  it.each(["\n\t.test-badge { color: #caa86a; }\r\n/* tail */ \t\r\n", " \r\n\t"])("injectStyles 保留原文字節與空白：%j", (css) => {
    const result = riliToDraft({ ...sampleA, injectStyles: css }, { language: "zh-Hant" });
    expect(result.regex?.cardCss).toBe(css);
    expect(new TextEncoder().encode(result.regex?.cardCss)).toEqual(new TextEncoder().encode(css));
    expect(result.regex?.cardCssDialect).toBe("rili");
    expect(result.regex?.pageMode).toBe("sandbox");
    expect(result.regex?.format).toBe("fengyue");
  });

  it("超過本站上限的欄位整段保留，並標記為 block 等級", () => {
    const result = riliToDraft(
      {
        ...sampleA,
        prompt: { ...(sampleA.prompt as Record<string, unknown>), rearPrompt: "長".repeat(2001) },
      },
      { language: "zh-Hans" },
    );
    expect([...result.draft.jailbreak].length).toBe(2001);
    expect(result.dropped).toContainEqual({
      key: "import.fengyue.tooLong.custom",
      params: { n: 2001, max: 2000 },
      level: "block",
    });
  });

  it("世界書條目超過語區上限時自動拆條且保留 triggerRegion", () => {
    const longContent = "字".repeat(4500);
    const result = riliToDraft(
      {
        ...sampleA,
        prompt: {
          ...(sampleA.prompt as Record<string, unknown>),
          lorebook: [
            {
              enabled: true,
              triggerWords: ["長條目"],
              triggerWordsType: "OR",
              blackListWords: [],
              blackListWordsType: "OR",
              folder: "設定",
              priority: 1,
              probability: 100,
              scanDepth: 2,
              triggerRange: ["user"],
              impactRange: ["system"],
              contentMethod: "single",
              content: longContent,
            },
          ],
        },
      },
      { language: "zh-Hans" },
    );
    const entries = result.worldbook?.entries ?? [];
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.map((e) => e.content).join("")).toBe(longContent);
    expect(entries.every((e) => e.triggerRegion === "user_only")).toBe(true);
    expect(result.dropped.some((n) => n.key === "import.split.entries")).toBe(true);
  });

  it("memorySchema 轉出的 CardState 通過本地與上游對齊的檢查（含巢狀陣列 items 與含點鍵名）", () => {
    for (const idx of [0, 4]) {
      const result = riliToDraft(all[idx].input, { language: "zh-Hant" });
      expect(result.draft.state).not.toBeNull();
      expect(stateProblem(result.draft.state)).toBeNull();
      const payload = statePayload(result.draft.state!);
      expect(payload.convention).toBe("plain");
      expect(Object.keys(payload.rules?.paths ?? {}).length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['{"type":123}', "type 不是字串"],
    ['{"type":["object"]}', "type 是陣列"],
    ['{"items":{"type":"string"}}', "根節點實際為陣列 schema"],
    ['{"type":"object","default":"not-an-object"}', "根節點無 properties 且 default 非物件"],
  ])("memorySchema 根節點非物件 schema（%s：%s）時標記 memoryInvalid（block）且擋存檔", (rawSchema) => {
    const result = riliToDraft(
      { ...sampleA, enableMemorySchema: true, memorySchema: rawSchema },
      { language: "zh-Hant" },
    );
    expect(result.draft.state).not.toBeNull();
    expect(stateProblem(result.draft.state)).toBe("data");
    expect(result.draft.state?.dataText).toContain("type");
    expect(result.dropped).toContainEqual({ key: "import.rili.memoryInvalid", level: "block" });
    expect(result.dropped.some((n) => n.key === "import.rili.memoryConverted")).toBe(false);
  });

  it("memorySchema 轉出超過卡片變數上限（包含逐值規則 > 8 KB 轉入變數規則）時標記 memoryLimit（block）且規則可編輯", () => {
    const props: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) {
      props[`field_${i}`] = { type: "number", default: i, description: "規".repeat(60) };
    }
    const overPathRules = riliToDraft(
      { ...sampleA, enableMemorySchema: true, memorySchema: JSON.stringify({ type: "object", properties: props }) },
      { language: "zh-Hant" },
    );
    expect(overPathRules.draft.state?.pathRules).toBeUndefined();
    expect(overPathRules.draft.state?.rulesText).toContain("field_0:");
    expect(stateProblem(overPathRules.draft.state)).toBe("rules_text_size");
    expect(overPathRules.dropped).toContainEqual({ key: "import.rili.memoryLimit", level: "block" });
    expect(overPathRules.dropped.some((n) => n.key === "import.rili.memoryConverted")).toBe(false);

    const overString = riliToDraft(
      {
        ...sampleA,
        enableMemorySchema: true,
        memorySchema: JSON.stringify({
          type: "object",
          properties: { bio: { type: "string", default: "長".repeat(900) } },
        }),
      },
      { language: "zh-Hant" },
    );
    expect(stateProblem(overString.draft.state)).toBe("string_size");
    expect(overString.dropped).toContainEqual({ key: "import.rili.memoryLimit", level: "block" });
  });

  it("所有新增與調整的五語文案齊全，且分段按鈕、平台名與摘要長度符合 ui.md §5 寬度預算", async () => {
    const locales = ["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const;
    const keys = [
      "import.kind.json",
      "import.kind.rili",
      "import.fengyue.drop",
      "import.fengyue.formats",
      "wb.import.error",
      "import.rili.noWelcome",
      "import.rili.memoryInvalid",
      "import.rili.memoryLimit",
      "import.rili.entryRegion",
      "import.rili.entryWeighted",
      "import.rili.entryBlacklistOnAnd",
      "import.rili.regexBackend",
      "import.rili.regexHistory",
      "import.rili.templateSuggestions",
      "import.rili.memoryConverted",
      "import.rili.images",
      "import.rili.presetOptions",
      "import.rili.suggestionsPrompt",
      "import.rili.voices",
      "import.rili.modelSettings",
      "import.rili.safeguard",
      "import.rili.assistantPrefill",
      "import.rili.memoryDisabled",
      "import.rili.modFile",
      "import.rili.otherFields",
    ];
    const kindJsonBudget: Record<(typeof locales)[number], number> = {
      "zh-Hant": 7,
      "zh-Hans": 7,
      en: 12,
      ja: 7,
      ko: 8,
    };
    const kindRiliBudget: Record<(typeof locales)[number], number> = {
      "zh-Hant": 6,
      "zh-Hans": 6,
      en: 8,
      ja: 6,
      ko: 6,
    };
    for (const locale of locales) {
      const messages = (await import(`../src/locales/${locale}.json`)).default as Record<string, string>;
      for (const key of keys) {
        expect(messages[key], `${locale} 缺 ${key}`).toBeTruthy();
      }
      expect([...messages["import.kind.json"]].length, `${locale} import.kind.json 超預算`).toBeLessThanOrEqual(kindJsonBudget[locale]);
      expect([...messages["import.kind.rili"]].length, `${locale} import.kind.rili 超預算`).toBeLessThanOrEqual(kindRiliBudget[locale]);
    }
  });
});

describe("匯入面板 UI（ui.md D1–D7）", () => {
  const all = (cases as { cases: Case[] }).cases;
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await nextTick();
    }
  };

  async function dropInTab(tab: number, input: Record<string, unknown>, fileName = "export.json") {
    localStorage.clear();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const app = createApp(ImportPanel, { language: "zh-Hant" }).use(i18n);
    app.mount(el);
    await nextTick();
    el.querySelectorAll<HTMLElement>(".seg__item")[tab].click();
    await nextTick();
    const file = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(file, "files", {
      value: [new File([JSON.stringify(input)], fileName, { type: "application/json" })],
      configurable: true,
    });
    file.dispatchEvent(new Event("change"));
    await flush();
    return {
      el,
      done: () => {
        app.unmount();
        el.remove();
      },
    };
  }

  for (const [tab, label] of [[0, "酒館分頁"], [1, "MMD 三件套分頁"], [2, "第 3 格分頁"]] as const) {
    it(`${label}拖入日里整卡：自動切到第 3 格、顯示日里平台名與標籤、隱藏範例對話、摘要按 changed→info 排序且無紅框`, async () => {
      const { el, done } = await dropInTab(tab, all[0].input, "TEST-TALKAICC-CARD.json");
      expect(el.querySelector(".import__error")).toBeNull();
      expect(el.querySelector(".seg__item--on")?.textContent?.trim()).toBe(i18n.global.t("import.kind.json"));
      const review = el.querySelector(".review")!;
      expect(review).not.toBeNull();
      expect(review.textContent).toContain("TEST-TALKAICC-CARD");
      expect(review.textContent).toContain(i18n.global.t("import.kind.rili"));
      expect(review.textContent).toContain(i18n.global.t("import.landed.tags", { n: 2 }));
      expect(review.textContent).not.toContain(i18n.global.t("import.landed.examples", { n: 0 }));
      expect(el.querySelector(".import__block")).toBeNull();

      const items = Array.from(el.querySelectorAll(".dropped li")).map((li) => li.textContent?.trim() ?? "");
      const changedIdx = items.findIndex((t) => t === i18n.global.t("import.rili.memoryConverted"));
      const infoIdx = items.findIndex((t) => t === i18n.global.t("import.rili.images"));
      expect(changedIdx).toBeGreaterThanOrEqual(0);
      expect(infoIdx).toBeGreaterThan(changedIdx);
      done();
    });

    it(`${label}拖入獨立 lorebook.json：只切到 MMD 三件套並填入世界書槽位、不出整卡預覽；補上設定檔後才合併出預覽`, async () => {
      const { el, done } = await dropInTab(tab, all[1].input, "lorebook.json");
      expect(el.querySelector(".import__error")).toBeNull();
      expect(el.querySelector(".seg__item--on")?.textContent?.trim()).toBe(i18n.global.t("import.kind.mmd"));
      const onRows = el.querySelectorAll(".parts__row--on");
      expect(onRows.length).toBe(1);
      expect(onRows[0].textContent).toContain("lorebook.json");
      expect(el.querySelector(".review")).toBeNull();

      const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
      const txt = new File(["合成角色設定內容"], "莉亞.txt", { type: "text/plain" });
      Object.defineProperty(input, "files", { value: [txt], configurable: true });
      input.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 0));
      await nextTick();

      expect(el.querySelectorAll(".parts__row--on").length).toBe(2);
      expect(el.querySelector(".review")?.textContent).toContain("莉亞");
      expect(el.querySelector(".review")?.textContent).toContain(i18n.global.t("import.landed.worldbook", { n: 2 }));
      done();
    });
  }

  it("擋存檔項目（noWelcome / memoryInvalid / tooLong）獨立渲染於紅框 alert，不重複進 dropped 清單", async () => {
    const { el, done } = await dropInTab(2, {
      ...all[2].input,
      prompt: { ...(all[2].input.prompt as Record<string, unknown>), rearPrompt: "超".repeat(2001) },
      enableMemorySchema: true,
      memorySchema: "{broken",
    });
    const block = el.querySelector(".import__block");
    expect(block).not.toBeNull();
    expect(block?.getAttribute("role")).toBe("alert");
    const blockText = block?.textContent ?? "";
    expect(blockText).toContain(i18n.global.t("import.rili.noWelcome"));
    expect(blockText).toContain(i18n.global.t("import.rili.memoryInvalid"));
    expect(blockText).toContain(i18n.global.t("import.fengyue.tooLong.custom", { n: 2001, max: 2000 }));

    const droppedText = el.querySelector(".dropped")?.textContent ?? "";
    expect(droppedText).not.toContain(i18n.global.t("import.rili.noWelcome"));
    expect(droppedText).not.toContain(i18n.global.t("import.rili.memoryInvalid"));
    expect(droppedText).toContain(i18n.global.t("import.rili.assistantPrefill"));
    done();
  });
});
