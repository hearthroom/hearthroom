import { describe, expect, it } from "vitest";
import { base64FromUtf8, encodeText, isPng, readTextChunk, replaceTextChunks, utf8FromBase64, writeChunks } from "../src/lib/png-chunks";
import { bookEntriesToDrafts, draftToTavern, embedIntoPng, formatMesExample, imageFetchUrl, parseMesExample, parseTavernFile, parseWorldbookFile, tavernToDraft, worldInfoToBook, type TavernCard } from "../src/lib/tavern";
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
  it("沒地方放的東西全部進報告", () => {
    const { dropped } = tavernToDraft(card, { language: "zh-Hant", labels: LABELS });
    const keys = dropped.map((d) => d.key);
        expect(keys).toContain("import.drop.position");
    expect(keys).toContain("import.drop.creator");
    expect(keys).toContain("import.drop.nickname");
    expect(keys).toContain("import.drop.extensions");
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

  it(".charx 明確說讀不了，不假裝是壞檔", async () => {
    const charx = new File([new Uint8Array([0x50, 0x4b, 3, 4])], "c.charx");
    await expect(parseTavernFile(charx)).rejects.toThrow("tavern_charx_unsupported");
  });
});

describe("draft → tavern", () => {
  it("匯出後再匯入，作者填的東西還在", () => {
    const draft = makeDraft("zh-Hant");
    draft.roleName = "雨宮";
    draft.roleDesc = "慢節奏。";
    draft.roleDetailDesc = "在舊碼頭開店的人。";
    draft.roleWelcome = "門鈴響了。";
    draft.alternates = ["你又來了。"];
    draft.roleTag = ["日常"];
    draft.talkExample = [{ roleType: "user", content: "老樣子" }, { roleType: "ai", content: "知道了" }];

    const round = tavernToDraft(draftToTavern(draft), { language: "zh-Hant", labels: LABELS }).draft;
    expect(round.roleName).toBe(draft.roleName);
    expect(round.roleDesc).toBe(draft.roleDesc);
    expect(round.roleDetailDesc).toBe(draft.roleDetailDesc);
    expect(round.roleWelcome).toBe(draft.roleWelcome);
    expect(round.alternates).toEqual(draft.alternates);
    expect(round.roleTag).toEqual(draft.roleTag);
    expect(round.talkExample).toEqual(draft.talkExample);
  });

  it("嵌進 PNG 之後仍讀得回同一張卡", async () => {
    const draft = makeDraft("zh-Hant");
    draft.roleName = "雨宮";
    draft.roleWelcome = "門鈴響了。";
    const png = embedIntoPng(barePng(), draftToTavern(draft));
    const { card } = await parseTavernFile(new File([png.slice().buffer], "c.png", { type: "image/png" }));
    expect(card.data.name).toBe("雨宮");
    expect(card.data.first_mes).toBe("門鈴響了。");
  });

  it("PNG 裡沒有卡片資料時說清楚是「只是一張圖」", async () => {
    await expect(parseTavernFile(new File([barePng().slice().buffer], "x.png", { type: "image/png" }))).rejects.toThrow(
      "tavern_no_metadata",
    );
  });
});

describe("匯入報告：不靜默丟掉的東西", () => {
  const card = (data: Record<string, unknown>): TavernCard => ({ spec: "chara_card_v2", spec_version: "2.0", data });

  it("標籤超過十個：只留前十個，多的進報告", () => {
    const tags = Array.from({ length: 16 }, (_, i) => `t${i}`);
    const result = tavernToDraft(card({ name: "A", tags }), { language: "zh-Hans", labels: LABELS });
    expect(result.draft.roleTag).toHaveLength(10);
    expect(result.dropped).toContainEqual({ key: "import.drop.tags", params: { n: 6 } });
  });

  it("正則腳本落成規則、不進報告；其餘擴展另計；匯出寫回 extensions.regex_scripts", () => {
    const result = tavernToDraft(
      card({ name: "A", extensions: { regex_scripts: [{ scriptName: "x", findRegex: "/a/g", replaceString: "b" }, { scriptName: "y", findRegex: "《y》", replaceString: "<b/>", disabled: true }], talkativeness: "0.5", fav: false } }),
      { language: "zh-Hans", labels: LABELS },
    );
    expect(result.dropped.map((d) => d.key)).not.toContain("import.drop.regex");
    expect(result.dropped).toContainEqual({ key: "import.drop.extensions", params: { n: 2 } });
    expect(result.regex?.rules.map((r) => [r.name, r.find, r.enabled])).toEqual([["x", "/a/g", true], ["y", "《y》", false]]);
    const back = draftToTavern(result.draft, [], { regex: result.regex });
    expect((back.data.extensions as { regex_scripts: unknown[] }).regex_scripts).toHaveLength(2);
    expect(draftToTavern(result.draft, [], { regex: null }).data.extensions).toEqual({});
  });
});

describe("世界書檔", () => {
  /** 酒館匯出的世界書檔長這樣：entries 是以 uid 為鍵的物件，欄位名跟卡裡的 book 不同。 */
  const worldInfo = {
    entries: {
      "0": { uid: 0, key: ["eldoria", "forest"], keysecondary: [], comment: "eldoria", content: "A forest.", constant: false, disable: false, position: 0 },
      "1": { uid: 1, key: ["glade"], keysecondary: ["safe"], comment: "", content: "A glade.", constant: true, disable: true },
      "2": { uid: 2, key: ["empty"], content: "" },
    },
  };

  it("MMD 匯出的世界書把 key／keysecondary 存成 JSON 字串：一樣要讀成關鍵詞（用戶回報：匯入不帶關鍵詞）", () => {
    const mmd = {
      entries: {
        "10": { uid: 10, key: '["【特别色色色色特化】","色色"]', keysecondary: '["夜晚"]', comment: "特别色色特化", content: "……", constant: false, disable: false },
        "11": { uid: 11, key: "[]", keysecondary: "[]", comment: "骰子系统", content: "d20", constant: true, disable: false },
        "12": { uid: 12, key: "甲, 乙，丙", content: "逗號分隔的舊寫法" },
      },
    };
    const book = worldInfoToBook(mmd)!;
    expect(book.entries![0]).toMatchObject({ keys: ["【特别色色色色特化】", "色色"], secondary_keys: ["夜晚"] });
    expect(book.entries![1]).toMatchObject({ keys: [], secondary_keys: [], constant: true });
    expect(book.entries![2]).toMatchObject({ keys: ["甲", "乙", "丙"] });
    const drafts = bookEntriesToDrafts(book.entries!);
    expect(drafts[0].keywords).toEqual(["【特别色色色色特化】", "色色"]);
    expect(drafts[0].secondaryKeywords).toEqual(["夜晚"]);
    expect(drafts[0].matchOptions).toEqual({ caseSensitive: false, matchWholeWords: false, selectiveLogic: 0 });
  });

  it("欄位名對回卡片規格：key→keys、keysecondary→secondary_keys、disable→enabled", () => {
    const book = worldInfoToBook(worldInfo)!;
    expect(book.entries).toHaveLength(3);
    expect(book.entries![0]).toMatchObject({ keys: ["eldoria", "forest"], enabled: true, constant: false, comment: "eldoria" });
    expect(book.entries![1]).toMatchObject({ keys: ["glade"], secondary_keys: ["safe"], enabled: false, constant: true });
  });

  it("條目轉成草稿：沒名字用註解、再沒有用第一個關鍵詞；空內容丟掉", () => {
    const drafts = bookEntriesToDrafts(worldInfoToBook(worldInfo)!.entries!);
    expect(drafts.map((d) => d.name)).toEqual(["eldoria", "glade"]);
    expect(drafts[1]).toMatchObject({ isEnabled: false, isConstant: true, keywords: ["glade"] });
  });

  it("從檔案讀：世界書 JSON、帶 book 的卡、PNG 卡都行；沒有條目就報 worldbook_invalid", async () => {
    const file = (name: string, body: string | Uint8Array) => new File([body as BlobPart], name);
    const fromInfo = await parseWorldbookFile(file("eldoria.json", JSON.stringify(worldInfo)));
    expect(fromInfo.entries).toHaveLength(2);
    // 次要關鍵詞現在有落點：進條目，不進報告
    expect(fromInfo.entries[1].secondaryKeywords).toEqual(["safe"]);
    expect(fromInfo.dropped.map((d) => d.key)).not.toContain("import.drop.secondaryKeys");

    const cardWithBook = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "S", character_book: { name: "Eldoria", entries: [{ keys: ["a"], content: "x" }] } } };
    const fromCard = await parseWorldbookFile(file("card.json", JSON.stringify(cardWithBook)));
    expect(fromCard.name).toBe("Eldoria");
    expect(fromCard.format).toBe("tavern");
    expect(fromCard.entries).toEqual([{ name: "a", content: "x", keywords: ["a"], secondaryKeywords: [], isEnabled: true, isConstant: false, matchOptions: { caseSensitive: false, matchWholeWords: false, selectiveLogic: 0 } }]);

    const png = embedIntoPng(barePng(), cardWithBook as TavernCard);
    expect((await parseWorldbookFile(file("card.png", png))).entries).toHaveLength(1);

    await expect(parseWorldbookFile(file("x.json", JSON.stringify({ spec: "chara_card_v2", data: { name: "S" } })))).rejects.toThrow("worldbook_invalid");
    await expect(parseWorldbookFile(file("x.json", "not json"))).rejects.toThrow("tavern_invalid");
  });
});

describe("imageFetchUrl", () => {
  const origin = "https://hearthroom.club";
  it("同源、data:、blob: 直接抓；跨網域走同源代抓", () => {
    expect(imageFetchUrl("https://hearthroom.club/a.png", origin)).toBe("https://hearthroom.club/a.png");
    expect(imageFetchUrl("/local.png", origin)).toBe("/local.png");
    expect(imageFetchUrl("blob:x", origin)).toBe("blob:x");
    expect(imageFetchUrl("https://objects.lunatalk.ai/asset/a.png", origin)).toBe("/v1/image?u=https%3A%2F%2Fobjects.lunatalk.ai%2Fasset%2Fa.png");
    expect(imageFetchUrl("", origin)).toBe("");
  });
});

describe("平鋪的卡", () => {
  it("沒包 data 但標了 spec 的 V3 卡：欄位照平鋪讀，spec 照它自己說的", async () => {
    const flat = { spec: "chara_card_v3", spec_version: "3.0", name: "星", first_mes: "hi", description: "d", character_book: { entries: [{ keys: ["a"], content: "x" }] } };
    const { card } = await parseTavernFile(new File([JSON.stringify(flat)], "flat.json"));
    expect(card.spec).toBe("chara_card_v3");
    expect(card.data.name).toBe("星");
    expect(card.data.character_book?.entries).toHaveLength(1);
  });
});

describe("太長的條目", () => {
  it("超過上限就拆成幾條同關鍵詞的條目，名字帶序號，字一個不少，並進報告", () => {
    const long = Array.from({ length: 12 }, (_, i) => `第${i}段。` + "字".repeat(600)).join("\n");
    const result = tavernToDraft(
      { spec: "chara_card_v2", spec_version: "2.0", data: { name: "A", character_book: { entries: [{ keys: ["k"], secondary_keys: ["s"], content: long, name: "很長的一條設定" }] } } },
      { language: "zh-Hant", labels: LABELS },
    );
    const entries = result.worldbook!.entries;
    expect(entries.length).toBeGreaterThan(1);
    for (const e of entries) {
      expect([...e.content].length).toBeLessThanOrEqual(3000);
      expect(e.keywords).toEqual(["k"]);
      expect(e.secondaryKeywords).toEqual(["s"]);
      expect(e.name).toMatch(/^很長的一條設定 \(\d+\/\d+\)$/);
    }
    expect(entries.map((e) => e.content).join("\n")).toBe(long);
    expect(result.dropped).toContainEqual({ key: "import.split.entries", params: { n: 1, max: 3000 } });
  });

  it("短的原樣一條，名字不帶序號", () => {
    const [only] = bookEntriesToDrafts([{ keys: ["k"], content: "短", name: "短條" }]);
    expect(only.name).toBe("短條");
  });
});

describe("酒館格式：匹配選項與 format 一路帶到上游", () => {
  it("世界書檔的 caseSensitive／matchWholeWords／selectiveLogic 與卡內 extensions 的寫法都讀進 matchOptions", () => {
    const wi = {
      entries: {
        "0": { key: ["/血祭|災星/"], keysecondary: ["劇透"], comment: "真相", content: "x", caseSensitive: true, matchWholeWords: true, selectiveLogic: 2 },
        "1": { key: ["夜"], comment: "夜", content: "y", extensions: { match_whole_words: true, selective_logic: 3 } },
      },
    };
    const book = worldInfoToBook(wi)!;
    expect(book.entries![0]).toMatchObject({ case_sensitive: true, match_whole_words: true, selective_logic: 2 });
    expect(book.entries![1]).toMatchObject({ case_sensitive: false, match_whole_words: true, selective_logic: 3 });
    const drafts = bookEntriesToDrafts(book.entries!);
    expect(drafts[0].keywords).toEqual(["/血祭|災星/"]);
    expect(drafts[0].matchOptions).toEqual({ caseSensitive: true, matchWholeWords: true, selectiveLogic: 2 });
    expect(drafts[1].matchOptions).toEqual({ caseSensitive: false, matchWholeWords: true, selectiveLogic: 3 });
  });

  it("卡片匯入：帶世界書就標 format=tavern，大小寫設定不再列為遺失", () => {
    const { worldbook, dropped } = tavernToDraft(
      { spec: "chara_card_v2", spec_version: "2.0", data: { name: "c", description: "d", character_book: { entries: [{ keys: ["Ra"], content: "z", case_sensitive: true }] } } } as never,
      { language: "zh-Hant", labels: LABELS },
    );
    expect(worldbook?.format).toBe("tavern");
    expect(worldbook?.entries[0].matchOptions).toEqual({ caseSensitive: true, matchWholeWords: false, selectiveLogic: 0 });
    expect(dropped.find((d) => d.key === "import.drop.caseSensitive")).toBeUndefined();
  });
});
