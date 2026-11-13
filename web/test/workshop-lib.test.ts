import { describe, expect, it } from "vitest";
import { CONSTANT_CHAR_LIMIT, constantChars, firstDemoted, moveItem, publishChecklist, publishState, tierLabel, updateNoteValid, usageState, type SelectionItem, type WorkshopDraft } from "../src/lib/workshop";

const entry = (content: string, isEnabled = true, isConstant = true) => ({ content, isEnabled, isConstant, name: "", keywords: [], secondaryKeywords: [] });

describe("constantChars", () => {
  it("counts only enabled constant entries, by Unicode character not UTF-16 unit", () => {
    // 「𠮷」是一個字、兩個 UTF-16 單位；表情符號同理
    expect(constantChars([entry("𠮷😀ab"), entry("不算", false), entry("也不算", true, false)])).toBe(4);
  });
  it("sums across entries with no count limit", () => {
    const many = Array.from({ length: 30 }, () => entry("一".repeat(50)));
    expect(constantChars(many)).toBe(CONSTANT_CHAR_LIMIT);
  });
});

describe("usageState", () => {
  it("over only when the request does not fit; soft when it fits below the recommendation", () => {
    expect(usageState({ requestFits: false, currentTierSufficient: true })).toBe("over");
    expect(usageState({ requestFits: true, currentTierSufficient: false })).toBe("soft");
    expect(usageState({ requestFits: true, currentTierSufficient: true })).toBe("ok");
  });
});

it("tierLabel writes tokens as K and nothing for unknown", () => {
  expect(tierLabel(32000)).toBe("32K");
  expect(tierLabel(128000)).toBe("128K");
  expect(tierLabel(null)).toBe("");
});

it("moveItem swaps neighbours and ignores moves past either end", () => {
  expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
  expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
});

it("firstDemoted is the top-most enabled, still-available extension that has resident content", () => {
  const row = (workshopId: string, over: Partial<SelectionItem> = {}): SelectionItem => ({ workshopId, enabled: true, name: workshopId, coverUrl: "", kinds: ["lore"], residentChars: 100, availability: "open", ...over });
  expect(firstDemoted([row("off", { enabled: false }), row("gone", { availability: "removed" }), row("empty", { residentChars: 0 }), row("a"), row("b")])).toBe("a");
  expect(firstDemoted([row("x", { enabled: false })])).toBeNull();
});

describe("publishState", () => {
  it("maps every review status", () => {
    expect(publishState("draft", "visible")).toBe("draft");
    expect(publishState("pending", "visible")).toBe("review");
    expect(publishState("rejected", "visible")).toBe("rejected");
    expect(publishState("live", "visible")).toBe("live");
    expect(publishState("live_changed", "visible")).toBe("livechg");
    expect(publishState("live_pending", "visible")).toBe("liveup");
    expect(publishState("live_rejected", "visible")).toBe("liverej");
  });
  it("owner hide wins; a return shows until the maker resubmits", () => {
    expect(publishState("live", "hidden")).toBe("hidden");
    expect(publishState("live_changed", "returned")).toBe("returned");
    expect(publishState("live_pending", "returned")).toBe("liveup");
  });
});

describe("publishChecklist", () => {
  const draft = (over: Partial<WorkshopDraft> = {}) => ({
    name: "雪夜篇", summary: "冬天的支線", coverUrl: "https://x/c.png", rating: "G",
    worldbook: [entry("燈塔")], rules: { version: 1 as const, rules: [], statusbar: "", lowered: false },
    opening: { mode: "greeting" as const, welcome: "", alternates: [], prologue: [], openingPage: "" },
    published: null, updateNote: "", ...over,
  });
  const failed = (d: ReturnType<typeof draft>) => publishChecklist(d).filter((i) => !i.ok).map((i) => i.key);
  it("passes a complete first version without an update note", () => {
    expect(failed(draft())).toEqual([]);
  });
  it("blocks missing cover, rating, content and over-limit resident text", () => {
    expect(failed(draft({ coverUrl: "", rating: null, worldbook: [] }))).toEqual(["cover", "rating", "content"]);
    expect(failed(draft({ worldbook: [entry("一".repeat(CONSTANT_CHAR_LIMIT + 1))] }))).toEqual(["constant"]);
  });
  it("needs an update note once published", () => {
    expect(failed(draft({ published: { version: 3 }, updateNote: "短" }))).toEqual(["note"]);
    expect(failed(draft({ published: { version: 3 }, updateNote: "新增三條世界書條目，修正手機換行" }))).toEqual([]);
  });
});

it("updateNoteValid needs 10 visible characters and at most 200", () => {
  expect(updateNoteValid("  一二三四五 六七八九  ")).toBe(false);
  expect(updateNoteValid("一二三四五六七八九十")).toBe(true);
  expect(updateNoteValid("一".repeat(201))).toBe(false);
});
