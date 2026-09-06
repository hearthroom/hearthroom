import { describe, expect, it } from "vitest";
import { classifyMmdFile, mergeMmdFiles, stemOf } from "../src/lib/mmd";

/** 合成的三件套：形狀照原站匯出，內容是假的。 */
const EXPORT = {
  pageDepth: 1,
  statusbar: "《美1》《状1》",
  beginning: "<开局面板>你推開了酒館的門。",
  regex_scripts: [
    { id: -1, scriptName: "《美1》", findRegex: "《美1》", replaceString: "<style>.x{}</style>" },
    { id: -1, scriptName: "台詞", findRegex: "/『([\\s\\S]*?)』/g", replaceString: "<b>『$1』</b>" },
  ],
};
const LIST = [
  { id: 1, name: "《美1》", regex: "《美1》", content: "<style>.x{}</style>" },
  { id: 2, name: "《状1》", regex: "《状1》", content: "<div>HP</div>" },
];
const BOOK = {
  name: "小鎮",
  entries: {
    "0": { key: '["酒館","老闆"]', keysecondary: "[]", content: "酒館老闆叫阿福。", comment: "酒館", disable: false, constant: false },
    "1": { key: "[]", content: "常駐：這是一個小鎮。", constant: true },
  },
};
const TXT = "她是酒館的女兒。\n\n【性格】爽朗。";

describe("classifyMmdFile", () => {
  it("正則匯出檔：規則、功能欄、降低層級、開場白", () => {
    const got = classifyMmdFile("角色-regex.json", JSON.stringify(EXPORT));
    expect(got.part).toBe("rules");
    if (got.part !== "rules") return;
    expect(got.set.rules.map((r) => r.name)).toEqual(["《美1》", "台詞"]);
    expect(got.set.statusbar).toBe("《美1》《状1》");
    expect(got.set.lowered).toBe(true);
    expect(got.welcome).toBe(EXPORT.beginning);
  });

  it("「導出正則」列表與 API 回包 {code,data} 都是規則", () => {
    for (const raw of [LIST, { code: 200, data: LIST }]) {
      const got = classifyMmdFile("list.json", JSON.stringify(raw));
      expect(got.part).toBe("rules");
      if (got.part !== "rules") return;
      expect(got.set.rules.map((r) => [r.find, r.replace])).toEqual([["《美1》", "<style>.x{}</style>"], ["《状1》", "<div>HP</div>"]]);
      expect(got.set.lowered).toBe(false);
    }
  });

  it("世界書 JSON：關鍵詞是 JSON 字串也讀得出來", () => {
    const got = classifyMmdFile("book.json", JSON.stringify(BOOK));
    expect(got.part).toBe("book");
    if (got.part !== "book") return;
    expect(got.book.name).toBe("小鎮");
    expect(got.book.entries?.[0].keys).toEqual(["酒館", "老闆"]);
    expect(got.book.entries?.[1].constant).toBe(true);
  });

  it("純文字就是角色設定；空檔與壞 JSON 各自報錯", () => {
    const got = classifyMmdFile("莉亞.txt", TXT);
    expect(got).toEqual({ part: "definition", fileName: "莉亞.txt", text: TXT });
    expect(() => classifyMmdFile("a.txt", "   ")).toThrow("mmd_empty");
    expect(() => classifyMmdFile("a.json", "{ broken")).toThrow("mmd_invalid_json");
    expect(() => classifyMmdFile("a.json", JSON.stringify({ hello: 1 }))).toThrow("mmd_unknown");
    expect(() => classifyMmdFile("a.json", JSON.stringify({ name: "b", entries: {} }))).toThrow("mmd_empty");
  });
});

describe("mergeMmdFiles", () => {
  const files = [
    classifyMmdFile("regex.json", JSON.stringify(EXPORT)),
    classifyMmdFile("book.json", JSON.stringify(BOOK)),
    classifyMmdFile("莉亞.txt", TXT),
  ];

  it("三個檔拼成一份：設定、開場白、世界書、正則全到位，名字取設定檔的檔名", () => {
    const got = mergeMmdFiles(files, { language: "zh-Hant" });
    expect(got.spec).toBe("mmd");
    expect(got.parts).toEqual({ rules: true, book: true, definition: true });
    expect(got.draft.roleName).toBe("莉亞");
    expect(got.draft.roleDetailDesc).toBe(TXT);
    expect(got.draft.roleWelcome).toBe(EXPORT.beginning);
    expect(got.draft.language).toBe("zh-Hant");
    expect(got.worldbook?.format).toBe("tavern");
    expect(got.worldbook?.name).toBe("小鎮");
    expect(got.worldbook?.entries.map((e) => e.keywords)).toEqual([["酒館", "老闆"], []]);
    expect(got.worldbook?.entries[1].isConstant).toBe(true);
    expect(got.regex?.rules).toHaveLength(2);
    expect(got.regex?.lowered).toBe(true);
    expect(got.image).toBeNull();
    expect(got.dropped).toEqual([]);
  });

  it("只有兩個檔：缺的部分留空，清單標出來；名字退而用世界書名", () => {
    const got = mergeMmdFiles([files[0], files[1]], { language: "en" });
    expect(got.parts).toEqual({ rules: true, book: true, definition: false });
    expect(got.draft.roleDetailDesc).toBe("");
    expect(got.draft.roleName).toBe("小鎮");
    const only = mergeMmdFiles([files[2]], { language: "en" });
    expect(only.parts).toEqual({ rules: false, book: false, definition: true });
    expect(only.worldbook).toBeNull();
    expect(only.regex).toBeNull();
    expect(only.draft.roleWelcome).toBe("");
  });

  it("stemOf 去副檔名", () => {
    expect(stemOf("莉亞.v2.txt")).toBe("莉亞.v2");
    expect(stemOf("noext")).toBe("noext");
  });
});
