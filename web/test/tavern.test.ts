import { describe, expect, it } from "vitest";
import { base64FromUtf8, encodeText, isPng, readTextChunk, replaceTextChunks, utf8FromBase64, writeChunks } from "../src/lib/png-chunks";
import { zipSync } from "fflate";
import { bookEntriesToDrafts, draftToTavern, embedIntoPng, formatMesExample, imageFetchUrl, multilingualNote, parseDecorators, parseMesExample, parseTavernFile, parseWorldbookFile, regexKey, tavernToDraft, toV2Card, worldbookToExport, worldInfoToBook, type TavernCard } from "../src/lib/tavern";
import { makeDraft } from "../src/lib/role-draft";

const LABELS = { personality: "【性格】", scenario: "【場景】" };

/** 最小可用的 PNG：只有 IHDR 與 IEND。夠讓 chunk 讀寫跑完整條路。 */
function barePng(): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 1); // width
  new DataView(ihdr.buffer).setUint32(4, 1); // height
  ihdr[8] = 8;
  ihdr[9] = 6;
  return writeChunks([
    { type: "IHDR", data: ihdr },
    { type: "IEND", data: new Uint8Array(0) },
  ]);
}

describe("png chunks", () => {
  it("寫出來的還是一張 PNG", () => {
    expect(isPng(barePng())).toBe(true);
  });

  it("tEXt 往返後內容不變", () => {
    const png = replaceTextChunks(barePng(), [{ keyword: "chara", text: "hello" }]);
    expect(readTextChunk(png, "chara")).toBe("hello");
    // 大小寫不敏感：野生的卡兩種寫法都有
    expect(readTextChunk(png, "CHARA")).toBe("hello");
  });

  it("重寫同名 chunk 不會留下舊的那份", () => {
    const once = replaceTextChunks(barePng(), [{ keyword: "chara", text: "old" }]);
    const twice = replaceTextChunks(once, [{ keyword: "chara", text: "new" }]);
    expect(readTextChunk(twice, "chara")).toBe("new");
    // 舊值若還在，讀取端多半取第一個，於是匯出的卡帶著舊資料而且看起來完全正常
    expect(new TextDecoder().decode(twice).includes("old")).toBe(false);
  });

  it("非 ASCII 經過 base64 往返不變", () => {
    const value = '雨還在下。{{char}}說：「你來了。」🌧';
    expect(utf8FromBase64(base64FromUtf8(value))).toBe(value);
  });

  it("沒有 tEXt 的 PNG 讀不到卡片資料", () => {
    expect(readTextChunk(barePng(), "chara")).toBeNull();
  });

  it("長度欄位撒謊的 PNG 直接報錯而不是配一大塊記憶體", () => {
    const png = barePng();
    new DataView(png.buffer).setUint32(8, 0x7fffffff);
    expect(() => readTextChunk(png, "chara")).toThrow("png_truncated");
  });

  // 2026-09-11 兩張 MMD 匯出的 PNG 卡（chunk 242 KB 與 630 KB）一拖進來就「匯入失敗」：
  // 位元組轉字串用引數展開，引數數量超過引擎上限就 RangeError。
  it("幾十萬位元組的 chunk 讀得出來、寫得回去", () => {
    const big = "x".repeat(300_000);
    const png = replaceTextChunks(barePng(), [{ keyword: "chara", text: big }]);
    expect(readTextChunk(png, "chara")).toHaveLength(300_000);
    expect(utf8FromBase64(base64FromUtf8("字".repeat(120_000)))).toHaveLength(120_000);
  });

  it("encodeText 用 NUL 分隔關鍵字與內容", () => {
    expect(encodeText("chara", "x").data).toEqual(Uint8Array.from([99, 104, 97, 114, 97, 0, 120]));
  });
});

describe("mes_example", () => {
  it("拆成一問一答，<START> 只當分隔", () => {
    const turns = parseMesExample("<START>\n{{user}}: 你是誰\n{{char}}: 一個等雨停的人\n再等一會。");
    expect(turns).toEqual([
      { roleType: "user", content: "你是誰" },
      { roleType: "ai", content: "一個等雨停的人\n再等一會。" },
    ]);
  });

  it("拆不出任何一輪時回空陣列，讓呼叫端進報告", () => {
    expect(parseMesExample("他站在雨裡，什麼也沒說。")).toEqual([]);
  });

  it("往返回酒館格式", () => {
    const turns = parseMesExample("{{user}}: hi\n{{char}}: hey");
    expect(parseMesExample(formatMesExample(turns))).toEqual(turns);
  });
});

describe("tavern → draft", () => {
  const card: TavernCard = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "雨宮",
      description: "在舊碼頭開店的人。",
      personality: "話少，記性好。",
      scenario: "連下了三天的雨。",
      creator_notes: "適合慢節奏的對話。",
      first_mes: "門鈴響了。",
      alternate_greetings: ["你又來了。"],
      mes_example: "{{user}}: 老樣子\n{{char}}: 知道了",
      system_prompt: "回覆兩段以內。",
      post_history_instructions: "別替玩家說話。",
      tags: ["日常", "懸疑"],
      creator: "someone",
      nickname: "老闆",
      extensions: { risu: { x: 1 } },
      character_book: {
        name: "碼頭",
        entries: [
          { keys: ["舊碼頭"], secondary_keys: ["夜裡"], content: "退潮時看得到沉船。", enabled: true, position: "before_char" },
          { keys: ["雨"], content: "" },
        ],
      },
    },
  };

  it("酒館卡帶正則腳本時，規則集宣告酒館格式（聊天頁替 <style> 加訊息層前綴）", () => {
    const withRegex = { ...card, data: { ...card.data, extensions: { regex_scripts: [{ scriptName: "美化", findRegex: "/x/", replaceString: "<style>body{display:flex}</style>" }] } } };
    expect(tavernToDraft(withRegex, { language: "zh-Hant", labels: LABELS }).regex?.format).toBe("tavern");
  });

  it("欄位落到對得上的地方", () => {
    const { draft } = tavernToDraft(card, { language: "zh-Hant", labels: LABELS });
    expect(draft.roleName).toBe("雨宮");
    expect(draft.roleDesc).toBe("適合慢節奏的對話。");
    expect(draft.roleWelcome).toBe("門鈴響了。");
    expect(draft.alternates).toEqual(["你又來了。"]);
    expect(draft.roleOutputContract).toBe("回覆兩段以內。");
    expect(draft.jailbreak).toBe("別替玩家說話。");
    expect(draft.roleTag).toEqual(["日常", "懸疑"]);
    expect(draft.talkExample).toHaveLength(2);
  });

  // MMD 匯出的卡把同一段人設逐字寫進 description 與 personality；拼兩次會讓字數翻倍撞上限
  it("description 與 personality 一模一樣時只算一次", () => {
    const same = "她是……".repeat(100);
    const out = tavernToDraft({ ...card, data: { ...card.data, description: same, personality: same, scenario: same } }, { language: "zh-Hant", labels: LABELS });
    expect(out.draft.roleDetailDesc).toBe(same);
  });

  // MMD 的卡把「創作要求」寫在 mes_example：不是對話，但也不能整段丟掉
  it("mes_example 拆不出對話、卡又沒有輸出要求時，收成輸出要求並進報告", () => {
    const rules = "在创作前，还有以下几点要求需要注意：\n- 正文语言：简体中文";
    const out = tavernToDraft({ ...card, data: { ...card.data, mes_example: rules, system_prompt: "" } }, { language: "zh-Hant", labels: LABELS });
    expect(out.draft.roleOutputContract).toBe(rules);
    expect(out.dropped.map((d) => d.key)).toContain("import.note.mesExampleAsContract");
    const kept = tavernToDraft({ ...card, data: { ...card.data, mes_example: rules, system_prompt: "已有輸出要求" } }, { language: "zh-Hant", labels: LABELS });
    expect(kept.draft.roleOutputContract).toBe("已有輸出要求");
    expect(kept.dropped.map((d) => d.key)).toContain("import.drop.mesExample");
  });

  it("三段人設合成一份，加小標題分開", () => {
    const { draft } = tavernToDraft(card, { language: "zh-Hant", labels: LABELS });
    expect(draft.roleDetailDesc).toBe("在舊碼頭開店的人。\n\n【性格】\n話少，記性好。\n\n【場景】\n連下了三天的雨。");
  });

  it("世界書另外成一本，沒內容的條目不留", () => {
    const { worldbook } = tavernToDraft(card, { language: "zh-Hant", labels: LABELS });
    expect(worldbook?.entries).toHaveLength(1);
    expect(worldbook?.entries[0]).toMatchObject({ name: "舊碼頭", keywords: ["舊碼頭"], isEnabled: true });
  });

  // 靜默丟掉才是真正的傷害：作者會以為卡壞了，而不是知道少了什麼。
  it("沒地方放的東西全部進報告；署名與別名現在有落點，不再進報告", () => {
    const { dropped, draft } = tavernToDraft(card, { language: "zh-Hant", labels: LABELS });
    const keys = dropped.map((d) => d.key);
    expect(keys).toContain("import.drop.position");
    expect(keys).toContain("import.drop.extensions");
    expect(keys).not.toContain("import.drop.creator");
    expect(keys).not.toContain("import.drop.nickname");
    expect(draft.nickname).toBe("老闆");
    expect(draft.cardMeta).toEqual({ creator: "someone" });
  });

  it("V1 的平卡（沒有 data 那一層）也讀得進來", async () => {
    const flat = new File([JSON.stringify({ name: "阿墨", first_mes: "嗯。" })], "c.json", { type: "application/json" });
    const { card: parsed } = await parseTavernFile(flat);
    expect(parsed.data.name).toBe("阿墨");
  });

  it("不是角色卡的 JSON 報 tavern_invalid", async () => {
    const junk = new File([JSON.stringify({ hello: 1 })], "c.json", { type: "application/json" });
    await expect(parseTavernFile(junk)).rejects.toThrow("tavern_invalid");
  });

  it(".charx：讀根目錄的 card.json，主頭像與主背景從包裡取出", async () => {
    const v3 = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "星",
        first_mes: "hi",
        assets: [
          { type: "icon", uri: "embeded://assets/icon/images/main.png", name: "main", ext: "png" },
          { type: "background", uri: "embeded://assets/background/images/main.png", name: "main", ext: "png" },
          { type: "emotion", uri: "embeded://assets/emotion/images/smile.png", name: "smile", ext: "png" },
        ],
      },
    };
    const zip = zipSync({
      "card.json": new TextEncoder().encode(JSON.stringify(v3)),
      "assets/icon/images/main.png": barePng(),
      "assets/background/images/main.png": barePng(),
      "assets/emotion/images/smile.png": barePng(),
    });
    const parsed = await parseTavernFile(new File([zip.slice().buffer], "c.charx"));
    expect(parsed.card.data.name).toBe("星");
    expect(parsed.image?.type).toBe("image/png");
    expect(parsed.background?.type).toBe("image/png");
    // 表情差分沒地方放：進報告
    const result = tavernToDraft(parsed.card, { language: "zh-Hant", labels: LABELS, image: parsed.image, background: parsed.background });
    expect(result.background).toBe(parsed.background);
    expect(result.dropped).toContainEqual({ key: "import.drop.assets", params: { n: 1 } });
  });

  it("zip 裡沒有 card.json 就說沒有卡片資料；壞 zip 說是壞檔", async () => {
    const zip = zipSync({ "readme.txt": new TextEncoder().encode("x") });
    await expect(parseTavernFile(new File([zip.slice().buffer], "c.charx"))).rejects.toThrow("tavern_no_metadata");
    await expect(parseTavernFile(new File([new Uint8Array([0x50, 0x4b, 3, 4, 9, 9])], "c.charx"))).rejects.toThrow("tavern_invalid");
  });
});

describe("V3 欄位", () => {
  const v3 = (data: Record<string, unknown>): TavernCard => ({ spec: "chara_card_v3", spec_version: "3.0", data });

  it("nickname、署名、版本、來源、多語言說明、時間都落到草稿並匯出還原", () => {
    const result = tavernToDraft(
      v3({
        name: "艾莉絲",
        nickname: "艾莉",
        creator: "someone",
        character_version: "2.1",
        source: ["https://example.test/card", " "],
        creator_notes: "英文說明",
        creator_notes_multilingual: { en: "English note", zh: "中文說明" },
        creation_date: 1700000000,
        modification_date: 1700000500,
        group_only_greetings: ["群聊開場"],
        alternate_greetings: ["備選"],
      }),
      { language: "zh-Hant", labels: LABELS },
    );
    const { draft } = result;
    expect(draft.nickname).toBe("艾莉");
    // 簡介挑跟語區對得上的那份（zh-Hant → zh），不是 creator_notes
    expect(draft.roleDesc).toBe("中文說明");
    expect(draft.cardMeta).toEqual({
      creator: "someone",
      characterVersion: "2.1",
      source: ["https://example.test/card"],
      creatorNotesMultilingual: { en: "English note", zh: "中文說明" },
      creationDate: 1700000000,
      modificationDate: 1700000500,
    });
    // 群聊開場白併進備選，並告知
    expect(draft.alternates).toEqual(["備選", "群聊開場"]);
    expect(result.dropped).toContainEqual({ key: "import.note.groupGreetings", params: { n: 1 } });

    const back = draftToTavern(draft, [], { now: 1800000000000 });
    expect(back.spec).toBe("chara_card_v3");
    expect(back.data.nickname).toBe("艾莉");
    expect(back.data.creator).toBe("someone");
    expect(back.data.character_version).toBe("2.1");
    expect(back.data.source).toEqual(["https://example.test/card"]);
    expect(back.data.creator_notes_multilingual).toEqual({ en: "English note", zh: "中文說明" });
    expect(back.data.creation_date).toBe(1700000000);
    expect(back.data.modification_date).toBe(1800000000);
    // V2 那份沒有 V3 的鍵
    const v2 = toV2Card(back);
    expect(v2.spec).toBe("chara_card_v2");
    expect(v2.data).not.toHaveProperty("nickname");
    expect(v2.data.name).toBe("艾莉絲");
  });

  it("多語言說明：完全相同的語言碼優先，其次同語言，都沒有就空", () => {
    expect(multilingualNote({ en: "e", "zh-Hant": "t", zh: "z" }, "zh-Hant")).toBe("t");
    expect(multilingualNote({ en: "e", zh: "z" }, "zh-Hant")).toBe("z");
    expect(multilingualNote({ EN: "e" }, "en")).toBe("e");
    expect(multilingualNote({ ja: "j" }, "ko")).toBe("");
    expect(multilingualNote(undefined, "ko")).toBe("");
  });

  it("PNG 匯出寫兩個 chunk：chara 是 V2、ccv3 是 V3；讀回來優先拿 V3", async () => {
    const draft = makeDraft("en");
    draft.roleName = "Alice";
    draft.nickname = "Ali";
    draft.roleWelcome = "hi";
    const png = embedIntoPng(barePng(), draftToTavern(draft));
    const chara = JSON.parse(utf8FromBase64(readTextChunk(png, "chara")!));
    const ccv3 = JSON.parse(utf8FromBase64(readTextChunk(png, "ccv3")!));
    expect(chara.spec).toBe("chara_card_v2");
    expect(chara.data.nickname).toBeUndefined();
    expect(ccv3.spec).toBe("chara_card_v3");
    expect(ccv3.data.nickname).toBe("Ali");
    const { card } = await parseTavernFile(new File([png.slice().buffer], "c.png", { type: "image/png" }));
    expect(card.spec).toBe("chara_card_v3");
    expect(card.data.nickname).toBe("Ali");
  });

  it("JSON 卡的 data: 頭像與背景也取出", async () => {
    const dataUri = `data:image/png;base64,${base64FromUtf8("not really png but fine")}`;
    const parsed = await parseTavernFile(
      new File([JSON.stringify(v3({ name: "A", assets: [{ type: "icon", uri: dataUri, name: "main", ext: "png" }, { type: "background", uri: "https://example.test/bg.png", name: "main", ext: "png" }] }))], "c.json"),
    );
    expect(parsed.image?.type).toBe("image/png");
    // https 的背景不抓（跨網域、也不該替作者從外站搬圖），留空
    expect(parsed.background).toBeNull();
  });
});

describe("V3 世界書：use_regex 與修飾詞", () => {
  it("use_regex 的關鍵詞包成 /key/i，區分大小寫就不加 i，已經是 /…/ 的不重包", () => {
    expect(regexKey("雨.*夜", false)).toBe("/雨.*夜/i");
    expect(regexKey("Rain", true)).toBe("/Rain/");
    expect(regexKey("/already/g", false)).toBe("/already/g");
    const drafts = bookEntriesToDrafts([{ keys: ["a|b", "/c/"], secondary_keys: ["d"], content: "x", use_regex: true, case_sensitive: true }]);
    expect(drafts[0].keywords).toEqual(["/a|b/", "/c/"]);
    expect(drafts[0].secondaryKeywords).toEqual(["/d/"]);
    // 沒開 use_regex 的原樣
    expect(bookEntriesToDrafts([{ keys: ["a|b"], content: "x" }])[0].keywords).toEqual(["a|b"]);
  });

  it("修飾詞照 SillyTavern 的讀法：連續的 @@ 行是修飾詞，@@@ 只在前一個認不得時當備胎", () => {
    const parsed = parseDecorators("@@activate\n@@depth 4\n@@@additional_keys 港口, 碼頭\n@@role assistant\n@@@dont_activate\n正文第一行\n@@不是修飾詞");
    expect(parsed.activate).toBe(true);
    expect(parsed.additionalKeys).toEqual(["港口", "碼頭"]);
    expect(parsed.dontActivate).toBe(true);
    expect(parsed.unsupported).toEqual(["depth", "role"]);
    expect(parsed.content).toBe("正文第一行\n@@不是修飾詞");
    // 備胎在前一個「認得」時不算數
    expect(parseDecorators("@@activate\n@@@dont_activate\nx").dontActivate).toBe(false);
    // 沒有修飾詞：原樣
    expect(parseDecorators("普通內容")).toEqual({ content: "普通內容", activate: false, dontActivate: false, additionalKeys: [], unsupported: [] });
  });

  it("修飾詞落到條目：常駐、停用、補關鍵詞；其餘剝掉並進報告", () => {
    const entries = [
      { keys: ["a"], content: "@@activate\n@@position after_char\n常駐設定" },
      { keys: ["b"], content: "@@dont_activate\n@@additional_keys c, d\n關掉的設定" },
      { keys: ["e"], content: "@@\n只剩修飾詞沒正文" },
    ];
    const result = tavernToDraft(
      { spec: "chara_card_v3", spec_version: "3.0", data: { name: "A", character_book: { entries } } },
      { language: "zh-Hant", labels: LABELS },
    );
    const drafts = result.worldbook!.entries;
    expect(drafts.map((d) => [d.content, d.isConstant, d.isEnabled, d.keywords])).toEqual([
      ["常駐設定", true, true, ["a"]],
      ["關掉的設定", false, false, ["b", "c", "d"]],
      ["只剩修飾詞沒正文", false, true, ["e"]],
    ]);
    expect(result.dropped).toContainEqual({ key: "import.drop.decorators", params: { n: 1, names: "@@position" } });
    // 內容不再以 @@ 開頭
    for (const d of drafts) expect(d.content.startsWith("@@")).toBe(false);
  });
});

it("preserves a split entry as one logical group and round trips author matching metadata", () => {
 const rows=bookEntriesToDrafts([{content:"A".repeat(6100),keys:["/code:(blue|green)/i"],secondary_keys:["approval"],selective:false,scan_depth:6,insertion_order:42,extensions:{source_flag:"kept"}}]);
 expect(rows).toHaveLength(3);
 expect(rows[0].matchOptions).toMatchObject({selective:false,scanDepth:6,order:42,extensions:{source_flag:"kept"}});
 expect(rows[0].matchOptions?.groupId).toBeTruthy();
 expect(rows.map(r=>r.matchOptions?.groupId)).toEqual(Array(3).fill(rows[0].matchOptions?.groupId));
 expect(rows.map(r=>r.matchOptions?.groupOrder)).toEqual([0,1,2]);
 const exported=worldbookToExport("Test",rows);
 const restored=bookEntriesToDrafts(worldInfoToBook(exported)!.entries!);
 expect(restored[0].matchOptions).toMatchObject({selective:false,scanDepth:6,order:42,extensions:{source_flag:"kept"}});
 expect(restored[0].matchOptions?.groupId).toBe(rows[0].matchOptions?.groupId);
});
