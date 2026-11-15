import { describe, expect, it } from "vitest";
import { CONSTANT_CHAR_LIMIT, constantChars, firstDemoted, moveItem, needsCapacityChoice, publishChecklist, publishState, tierLabel, usageState, type SelectionItem, type WorkshopDraft } from "../src/lib/workshop";

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
  it("has three states: draft, live, live with unpublished edits", () => {
    expect(publishState("draft")).toBe("draft");
    expect(publishState("live")).toBe("live");
    expect(publishState("live_changed")).toBe("livechg");
  });
});

describe("publishChecklist", () => {
  const draft = (over: Partial<WorkshopDraft> = {}) => ({
    kind: "dlc" as WorkshopDraft["kind"], name: "雪夜篇", summary: "冬天的支線", rating: "G",
    worldbook: [entry("燈塔")], rules: { version: 1 as const, rules: [], statusbar: "", lowered: false } as unknown as WorkshopDraft["rules"],
    opening: { mode: "greeting" as const, welcome: "", alternates: [], prologue: [], openingPage: "" },
    ...over,
  });
  const failed = (d: ReturnType<typeof draft>) => publishChecklist(d).filter((i) => !i.ok).map((i) => i.key);
  it("passes without a cover or an update note (both optional)", () => {
    expect(failed(draft())).toEqual([]);
    expect(publishChecklist(draft()).map((i) => i.key)).toEqual(["basics", "rating", "content", "constant"]);
  });
  it("blocks missing rating, content and over-limit resident text", () => {
    expect(failed(draft({ rating: null, worldbook: [] }))).toEqual(["rating", "content"]);
    expect(failed(draft({ worldbook: [entry("一".repeat(CONSTANT_CHAR_LIMIT + 1))] }))).toEqual(["constant"]);
  });
  it("an author DLC counts regex or an opening as content", () => {
    expect(failed(draft({ worldbook: [], opening: { mode: "greeting", welcome: "雪停了", alternates: [], prologue: [], openingPage: "" } }))).toEqual([]);
  });
  it("a player extension counts only lorebook entries, even if old regex or openings are still stored", () => {
    const opening = { mode: "greeting" as const, welcome: "雪停了", alternates: [], prologue: [], openingPage: "" };
    expect(failed(draft({ kind: "lorebook", worldbook: [], opening }))).toEqual(["content"]);
    expect(failed(draft({ kind: "lorebook" }))).toEqual([]);
  });
});

describe("needsCapacityChoice", () => {
  const u = (over: object) => ({ requestFits: false, currentTierSufficient: false, currentContextTokens: 32000, ...over });
  it("asks only when the request does not fit at a known current tier", () => {
    expect(needsCapacityChoice(u({}))).toBe(true);
    expect(needsCapacityChoice(u({ requestFits: true }))).toBe(false);
  });
  it("does not ask when the current tier is unknown (nothing true to say; the server still demotes if needed)", () => {
    expect(needsCapacityChoice(u({ currentContextTokens: null }))).toBe(false);
    expect(needsCapacityChoice(u({ currentContextTokens: 0 }))).toBe(false);
  });
});
