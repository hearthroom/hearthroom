import { describe, expect, it } from "vitest";
import {
  adaptationId, addEntry, deleteEntry, detachEntry, detachedPrompts, duplicateEntry, entryRows, insertEntry,
  isPromptPack, moveEntry, newDocument, paramState, profilesOf, restoreOrder, setAdaptation, setEnabled, setParamAdopted,
  setParamValue, type PresetDocument,
} from "../src/lib/st-preset";

// 合成的 ST Chat Completion 預設：兩組排序，帶一個不認得的擴充欄位（匯出時要原樣留著）。
function imported(): PresetDocument {
  return {
    schemaVersion: "hearthroom.st-preset.v1",
    st: {
      temperature: 0.9,
      top_p: 1,
      extensions: { regex_scripts: [{ findRegex: "x" }] },
      prompts: [
        { identifier: "main", name: "Main", role: "system", content: "寫得清楚。", system_prompt: true },
        { identifier: "charDescription", name: "Char Description", marker: true },
        { identifier: "style", name: "文風", role: "system", content: "第三人稱。" },
        { identifier: "chatHistory", name: "Chat History", marker: true },
        { identifier: "jailbreak", name: "Post", role: "system", content: "接著寫。" },
        { identifier: "deep", name: "深處", role: "system", content: "x", injection_position: 1, injection_depth: 4 },
        { identifier: "spare", name: "備用", role: "system", content: "備用文字" },
      ],
      prompt_order: [
        { character_id: 100000, order: [{ identifier: "main", enabled: true }] },
        {
          character_id: 100001,
          order: [
            { identifier: "main", enabled: true },
            { identifier: "charDescription", enabled: true },
            { identifier: "style", enabled: false },
            { identifier: "chatHistory", enabled: true },
            { identifier: "jailbreak", enabled: true },
            { identifier: "deep", enabled: true },
          ],
        },
      ],
    },
    selection: { profileId: 100001, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] },
  };
}

const ids = (doc: PresetDocument) => entryRows(doc).map((r) => r.identifier);

describe("ST 預設文件操作", () => {
  it("依選定的排序列出條目，並分到固定區、框架、生成前、歷史中間", () => {
    const doc = imported();
    expect(profilesOf(doc.st)).toEqual([100000, 100001]);
    expect(entryRows(doc).map((r) => [r.identifier, r.slot, r.enabled])).toEqual([
      ["main", "P", true],
      ["charDescription", "F", true],
      ["style", "P", false],
      ["chatHistory", "F", true],
      ["jailbreak", "S", true],
      ["deep", "D", true],
    ]);
    expect(detachedPrompts(doc).map((p) => p.identifier)).toEqual(["spare"]);
  });

  it("開關只改選定排序裡的 enabled，不動另一組排序", () => {
    const doc = imported();
    setEnabled(doc, "main", false);
    expect(entryRows(doc)[0]!.enabled).toBe(false);
    expect((doc.st.prompt_order as { order: { enabled: boolean }[] }[])[0]!.order[0]!.enabled).toBe(true);
    expect(setEnabled(doc, "chatHistory", false)).toBe(false);
  });

  it("上下移只在同一區的自訂條目之間交換，框架條目留在原位", () => {
    const doc = imported();
    expect(moveEntry(doc, "style", -1)).toBe(true);
    expect(ids(doc)).toEqual(["style", "charDescription", "main", "chatHistory", "jailbreak", "deep"]);
    expect(moveEntry(doc, "style", -1)).toBe(false);
    // 生成前區只有一條自訂條目，往上會跨過聊天歷史，不允許
    expect(moveEntry(doc, "jailbreak", -1)).toBe(false);
    expect(moveEntry(doc, "chatHistory", 1)).toBe(false);
  });

  it("移出排序後條目還在，插回固定區落在聊天歷史之前，插回生成前區落在最後", () => {
    const doc = imported();
    expect(detachEntry(doc, "style")).toBe(true);
    expect(ids(doc)).not.toContain("style");
    expect(detachedPrompts(doc).map((p) => p.identifier)).toEqual(["style", "spare"]);
    expect(detachEntry(doc, "chatHistory")).toBe(false);
    insertEntry(doc, "style", "P");
    expect(ids(doc).indexOf("style")).toBe(ids(doc).indexOf("chatHistory") - 1);
    insertEntry(doc, "spare", "S");
    expect(ids(doc).at(-1)).toBe("spare");
    expect(entryRows(doc).find((r) => r.identifier === "spare")!.enabled).toBe(true);
  });

  it("新增與複製產生新的識別碼，內容照抄", () => {
    const doc = imported();
    const id = addEntry(doc, { name: "新條目", slot: "S" });
    expect(ids(doc).at(-1)).toBe(id);
    expect(entryRows(doc).at(-1)!.prompt).toMatchObject({ name: "新條目", role: "system", content: "" });
    const copy = duplicateEntry(doc, "main", "Main（副本）")!;
    expect(copy).not.toBe("main");
    expect(ids(doc)[1]).toBe(copy);
    expect(entryRows(doc)[1]!.prompt.content).toBe("寫得清楚。");
  });

  it("刪除只限未在任何排序裡的條目；另一組排序還用著就不刪", () => {
    const doc = imported();
    expect(deleteEntry(doc, "spare")).toBe(true);
    expect(detachedPrompts(doc)).toEqual([]);
    detachEntry(doc, "main");
    expect(deleteEntry(doc, "main")).toBe(false);
    expect(deleteEntry(doc, "jailbreak")).toBe(false);
  });

  it("參數改成沿用模型設定時記在 excludedFields，原值留著匯出用", () => {
    const doc = imported();
    expect(paramState(doc, "temperature")).toEqual({ value: 0.9, adopted: true });
    setParamAdopted(doc, "temperature", false);
    expect(doc.selection.excludedFields).toEqual(["temperature"]);
    expect(doc.st.temperature).toBe(0.9);
    setParamValue(doc, "temperature", 1.1);
    expect(paramState(doc, "temperature")).toEqual({ value: 1.1, adopted: true });
    expect(paramState(doc, "top_k")).toEqual({ value: undefined, adopted: false });
  });

  it("移位確認用 <identifier>:move_to_suffix，可加可撤", () => {
    const doc = imported();
    setAdaptation(doc, "main", true);
    setAdaptation(doc, "main", true);
    expect(doc.selection.acceptedAdaptationIds).toEqual([adaptationId("main")]);
    setAdaptation(doc, "main", false);
    expect(doc.selection.acceptedAdaptationIds).toEqual([]);
  });

  it("沒碰到的來源欄位原封不動", () => {
    const doc = imported();
    moveEntry(doc, "style", -1);
    setEnabled(doc, "jailbreak", false);
    expect(doc.st.extensions).toEqual({ regex_scripts: [{ findRegex: "x" }] });
    expect((doc.st.prompts as { identifier: string; injection_depth?: number }[]).find((p) => p.identifier === "deep")!.injection_depth).toBe(4);
  });

  it("條目包用 data.prompt_order 當唯一排序，profileId 是 0", () => {
    const doc: PresetDocument = {
      schemaVersion: "hearthroom.st-preset.v1",
      st: { version: 1, type: "prompts", data: { prompts: [{ identifier: "a", name: "A", role: "system", content: "a" }], prompt_order: [{ identifier: "a", enabled: true }] } },
      selection: { profileId: 0, excludedEntryIds: [], acceptedAdaptationIds: [], excludedFields: [] },
    };
    expect(isPromptPack(doc.st)).toBe(true);
    expect(profilesOf(doc.st)).toEqual([0]);
    expect(ids(doc)).toEqual(["a"]);
    addEntry(doc, { name: "B", slot: "P" });
    expect(ids(doc)).toHaveLength(2);
  });

  it("新建的原生預設有框架條目與一條空白主要指示，排序在 100001", () => {
    const doc = newDocument("主要指示");
    expect(doc.selection.profileId).toBe(100001);
    const rows = entryRows(doc);
    expect(rows[0]).toMatchObject({ identifier: "main", slot: "P", enabled: true });
    expect(rows.map((r) => r.identifier)).toContain("chatHistory");
    expect(rows.filter((r) => r.slot === "F").length).toBeGreaterThanOrEqual(6);
  });

  it("插在歷史中間的條目照它在排序裡的位置歸到之前或之後", () => {
    const doc = imported();
    expect(entryRows(doc).map((r) => [r.identifier, r.side])).toEqual([
      ["main", "before"], ["charDescription", "before"], ["style", "before"], ["chatHistory", "before"], ["jailbreak", "after"], ["deep", "after"],
    ]);
  });

  it("還原順序回到上次儲存的排序；之後新增的留在各自那一區的最後，開關照現在的", () => {
    const saved = imported();
    const doc = imported();
    moveEntry(doc, "style", -1);
    setEnabled(doc, "main", false);
    const fresh = addEntry(doc, { name: "新", slot: "P" });
    detachEntry(doc, "jailbreak");
    restoreOrder(doc, saved);
    expect(ids(doc)).toEqual(["main", "charDescription", "style", fresh, "chatHistory", "jailbreak", "deep"]);
    expect(entryRows(doc)[0]!.enabled).toBe(false);
  });

  it("不採用的條目（excludedEntryIds）算關著；匯入的預設開關只改採用範圍，不動來源的 enabled", () => {
    const doc = imported();
    doc.selection.excludedEntryIds = ["jailbreak"];
    expect(entryRows(doc).find((r) => r.identifier === "jailbreak")!.enabled).toBe(false);
    setEnabled(doc, "main", false, { keepSource: true });
    expect(doc.selection.excludedEntryIds).toEqual(["jailbreak", "main"]);
    expect(entryRows(doc)[0]!.enabled).toBe(false);
    expect((doc.st.prompt_order as { order: { identifier: string; enabled: boolean }[] }[])[1]!.order[0]!.enabled).toBe(true);
    setEnabled(doc, "jailbreak", true, { keepSource: true });
    expect(doc.selection.excludedEntryIds).toEqual(["main"]);
    // 來源本來就關著的條目，玩家明確打開才改來源
    setEnabled(doc, "style", true, { keepSource: true });
    expect(entryRows(doc).find((r) => r.identifier === "style")!.enabled).toBe(true);
  });
});
