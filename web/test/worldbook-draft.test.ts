/**
 * 世界書草稿 composable 的純邏輯：差分、髒判斷、本機草稿的存取、建草稿與放掉。
 * 網路那半（建書、送段、讀回）由頁面測試與線上驗證涵蓋。
 */
import { describe, expect, it } from "vitest";
import { useWorldbookDraft } from "../src/lib/worldbook-draft";

const deps = { untitled: () => "untitled", fallbackName: () => "Mika", language: () => "zh-Hant" };

describe("useWorldbookDraft", () => {
  it("starts empty, creates a draft with one blank entry, and does not count blanks as content", () => {
    const b = useWorldbookDraft(deps);
    expect(b.dirty()).toBe(false);
    b.createDraft();
    expect(b.pending).toBe(true);
    expect(b.name).toBe("Mika");
    expect(b.entries).toHaveLength(1);
    expect(b.hasContent()).toBe(false);
    expect(b.ops()).toEqual([]);
    expect(b.dirty()).toBe(true);
    expect(b.stored()).toEqual({ name: "Mika", format: undefined, entries: b.entries });
    b.release();
    expect(b.dirty()).toBe(false);
    expect(b.stored()).toBeNull();
  });

  it("diffs entries against the saved baseline into create / update / delete", () => {
    const b = useWorldbookDraft(deps);
    b.id = "book1";
    b.original = [
      { entryId: "e1", name: "Keep", content: "same", keywords: ["k"], secondaryKeywords: [], isEnabled: true, isConstant: false },
      { entryId: "e2", name: "Gone", content: "x", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false },
      { entryId: "e3", name: "Edit", content: "old", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: true },
    ];
    b.entries = [
      JSON.parse(JSON.stringify(b.original[0])),
      { ...JSON.parse(JSON.stringify(b.original[2])), content: "new" },
      { name: "", content: "fresh", keywords: ["ren"], secondaryKeywords: [], isEnabled: true, isConstant: false },
      { name: "blank", content: "   ", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false },
    ];
    const ops = b.ops().map((o) => o.op);
    expect(ops).toEqual([
      { op: "delete", entryId: "e2" },
      { op: "update", entryId: "e3", name: "Edit", content: "new", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: true },
      { op: "create", name: "ren", content: "fresh", keywords: ["ren"], secondaryKeywords: [], isEnabled: true, isConstant: false },
    ]);
    expect(b.dirty()).toBe(true);
    // 刪掉一條也算順序變了：上游的順序是以現存 id 清單為準，少一個 id 就得重送一次。
    expect(b.orderChanged()).toBe(true);
  });

  it("restores a stored draft and imports entries without ids", () => {
    const b = useWorldbookDraft(deps);
    b.restore({ name: "Saved", entries: [{ name: "a", content: "b", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false }] });
    expect(b.pending).toBe(true);
    expect(b.name).toBe("Saved");
    b.imported({ name: "", entries: [{ entryId: "old", name: "x", content: "y", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false }], format: "tavern" });
    expect(b.entries[0].entryId).toBeUndefined();
    expect(b.format).toBe("tavern");
    expect(b.name).toBe("Saved");
  });

  it("only reports metadata changes when the upstream baseline is known", () => {
    const b = useWorldbookDraft(deps);
    b.name = "renamed";
    expect(b.metadataChanged()).toBe(false);
    b.meta = { worldbookId: "book1", name: "orig", description: "", entryCount: 0, iconUrl: "", visibility: "private", tags: "" };
    expect(b.metadataChanged()).toBe(true);
    expect(b.metadataPatch()).toMatchObject({ name: "renamed", visibility: "private", tags: [] });
  });
});
