import { describe, expect, it } from "vitest";
import {
  adaptationId, addEntry, canDeleteEntry, clearParam, deleteEntry, moveToSide, nativeMacrosValid, nativeProblems, detachEntry, detachedPrompts, duplicateEntry, entryRows, insertEntry,
  canMoveEntry, entryPlace, isPromptPack, moveEntry, moveEntryTo, newDocument, prefixLayout, paramState, profilesOf, restoreOrder, setAdaptation, setEnabled, setParamAdopted,
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

  it("上移／下移能不能按：到一區頂端或對話記錄前最後一格就不能再移（QA ⚠️2）", () => {
    const doc = imported();
    // main, charDescription, style, chatHistory, jailbreak, deep
    expect(canMoveEntry(doc, "main", -1)).toBe(false);
    expect(canMoveEntry(doc, "main", 1)).toBe(true);
    expect(canMoveEntry(doc, "style", 1)).toBe(false);
    expect(canMoveEntry(doc, "jailbreak", -1)).toBe(false);
    expect(canMoveEntry(doc, "deep", 1)).toBe(false);
    expect(canMoveEntry(doc, "deep", -1)).toBe(true);
    expect(canMoveEntry(doc, "chatHistory", 1)).toBe(false);
    // 能不能按跟實際移動一致
    for (const id of ["main", "style", "jailbreak", "deep"]) for (const dir of [-1, 1] as const) {
      const d = imported();
      expect(moveEntry(d, id, dir)).toBe(canMoveEntry(imported(), id, dir));
    }
  });

  it("玩家／角色 marker 是一步；個性、情境、世界書是空槽，不算一步", () => {
    const doc = imported();
    doc.st.prompts!.push({ identifier: "u", name: "包裹", role: "system", content: "x" }, { identifier: "b", name: "銜接", role: "system", content: "y" },
      { identifier: "personaDescription", name: "Persona", marker: true }, { identifier: "charPersonality", name: "Personality", marker: true }, { identifier: "worldInfoBefore", name: "WI", marker: true });
    const g = doc.st.prompt_order!.find((x) => x.character_id === 100001)!;
    g.order = ["main", "personaDescription", "u", "charDescription", "charPersonality", "b", "worldInfoBefore", "chatHistory", "jailbreak"].map((identifier) => ({ identifier, enabled: true }));
    expect(moveEntry(doc, "b", -1)).toBe(true);
    expect(ids(doc)).toEqual(["main", "personaDescription", "u", "b", "charDescription", "charPersonality", "worldInfoBefore", "chatHistory", "jailbreak"]);
    // charPersonality 是空槽，不畫、不算一步：跨過「角色與玩家設定」就停在角色 marker 後面
    expect(moveEntry(doc, "b", 1)).toBe(true);
    expect(ids(doc)).toEqual(["main", "personaDescription", "u", "charDescription", "b", "charPersonality", "worldInfoBefore", "chatHistory", "jailbreak"]);
    // 後面只剩世界書空槽與聊天歷史：再往下不算一步
    expect(moveEntry(doc, "b", 1)).toBe(false);
  });

  it("條目在送出順序裡的段落：最後一份玩家／角色材料之前、之後，或聊天歷史之後", () => {
    const doc = imported();
    expect(entryPlace(doc, "main")).toBe("beforePersona");
    expect(entryPlace(doc, "style")).toBe("afterPersona");
    expect(entryPlace(doc, "jailbreak")).toBe("after");
    expect(entryPlace(doc, "chatHistory")).toBeNull();
    // 沒有角色 marker：角色與玩家設定補在 main 後面（ST 預設順序最近的前一個），之後的條目算「之後」
    const g = doc.st.prompt_order!.find((x) => x.character_id === 100001)!;
    g.order = g.order.filter((o) => o.identifier !== "charDescription");
    expect(entryPlace(doc, "main")).toBe("beforePersona");
    expect(entryPlace(doc, "style")).toBe("afterPersona");
  });

  // 缺席的玩家／角色／範例材料：跟伺服器 renderPresetPrefixLayout（6376f7af）同一個補位規則
  describe("對話記錄之前的版面（跟伺服器補位一致）", () => {
    const docWith = (order: string[], extra: { id: string; marker?: boolean }[] = []) => {
      const d = imported();
      for (const e of extra) d.st.prompts!.push(e.marker ? { identifier: e.id, name: e.id, marker: true } : { identifier: e.id, name: e.id, role: "system", content: e.id });
      d.st.prompt_order!.find((x) => x.character_id === 100001)!.order = [...order, "chatHistory"].map((identifier) => ({ identifier, enabled: true }));
      return d;
    };
    const markers = ["worldInfoBefore", "charPersonality", "scenario", "worldInfoAfter", "dialogueExamples", "personaDescription"].map((id) => ({ id, marker: true }));
    const show = (d: PresetDocument, inPrefix?: (id: string) => boolean) => prefixLayout(d, inPrefix).map((r) => (r.kind === "entry" ? r.id : `${r.kind}${r.virtual ? "*" : ""}`));

    it("前面最近的錨點之後（標記 * 是伺服器補上的位置）", () => {
      const d = docWith(["main", "worldInfoBefore", "charPersonality", "scenario", "worldInfoAfter", "bridge", "dialogueExamples"], [...markers, { id: "bridge" }]);
      expect(show(d)).toEqual(["main", "persona*", "bridge", "dialogueExamples"]);
    });
    it("前面沒有就放在後面最近的錨點之前", () => {
      const d = docWith(["a", "scenario", "b", "dialogueExamples"], [...markers, { id: "a" }, { id: "b" }]);
      expect(show(d)).toEqual(["a", "persona*", "b", "dialogueExamples"]);
    });
    it("只缺角色：接在玩家設定後面，同一列", () => {
      const d = docWith(["main", "personaDescription", "c", "dialogueExamples", "d"], [...markers, { id: "c" }, { id: "d" }]);
      expect(show(d)).toEqual(["main", "persona", "c", "dialogueExamples", "d"]);
    });
    it("空的內建條目（nsfw）也算錨點；範例接在它後面", () => {
      const d = docWith(["x", "nsfw", "y"], [{ id: "x" }, { id: "nsfw" }, { id: "y" }]);
      expect(show(d)).toEqual(["x", "persona*", "nsfw", "dialogueExamples*", "y"]);
    });
    it("完全沒有錨點：放在最後（角色、玩家、範例）", () => {
      const d = docWith(["a"], [{ id: "a" }]);
      expect(show(d)).toEqual(["a", "persona*", "dialogueExamples*"]);
    });
    it("伺服器不收的條目（不支援、停用）不當錨點，但照樣列在清單裡", () => {
      const d = docWith(["main", "a", "charDescription"], [{ id: "a" }]);
      expect(show(d)).toEqual(["main", "persona*", "a", "persona", "dialogueExamples*"]);
      // main 不收：玩家設定改找後面最近的角色 marker，補在它前面，跟它併成同一列
      expect(show(d, (id) => id !== "main")).toEqual(["main", "a", "persona", "dialogueExamples*"]);
    });
    it("被自訂條目隔開的玩家與角色 marker 照實出現兩列", () => {
      const d = docWith(["personaDescription", "u", "charDescription", "bridge", "dialogueExamples"], [...markers, { id: "u" }, { id: "bridge" }]);
      expect(show(d)).toEqual(["persona", "u", "persona", "bridge", "dialogueExamples"]);
    });
  });

  it("拖曳：放到之前區最後面＝聊天歷史正前方，即使最後一個是角色 marker", () => {
    const doc = imported();
    const g = doc.st.prompt_order!.find((x) => x.character_id === 100001)!;
    g.order = ["main", "charDescription", "chatHistory", "jailbreak"].map((identifier) => ({ identifier, enabled: true }));
    expect(moveEntryTo(doc, "jailbreak", { side: "before" })).toBe(true);
    expect(ids(doc)).toEqual(["main", "charDescription", "jailbreak", "chatHistory"]);
  });

  it("拖曳：放到某條自訂條目前面，可以越過框架條目與聊天歷史（owner 2026-10-30）", () => {
    const doc = imported();
    expect(moveEntryTo(doc, "jailbreak", { beforeId: "main" })).toBe(true);
    expect(ids(doc)).toEqual(["jailbreak", "main", "charDescription", "style", "chatHistory", "deep"]);
    expect(moveEntryTo(doc, "jailbreak", { beforeId: "deep" })).toBe(true);
    expect(ids(doc)).toEqual(["main", "charDescription", "style", "chatHistory", "jailbreak", "deep"]);
  });

  it("拖曳：放到一區的最後面＝那一區最後一條自訂條目之後（之前區不越過聊天歷史，之後區放到最後）", () => {
    const doc = imported();
    expect(moveEntryTo(doc, "main", { side: "before" })).toBe(true);
    expect(ids(doc)).toEqual(["charDescription", "style", "main", "chatHistory", "jailbreak", "deep"]);
    expect(moveEntryTo(doc, "style", { side: "after" })).toBe(true);
    expect(ids(doc)).toEqual(["charDescription", "main", "chatHistory", "jailbreak", "deep", "style"]);
  });

  it("拖曳：之前區沒有自訂條目時，放進去就排在聊天歷史前面", () => {
    const doc = imported();
    moveEntryTo(doc, "main", { side: "after" });
    moveEntryTo(doc, "style", { side: "after" });
    expect(moveEntryTo(doc, "deep", { side: "before" })).toBe(true);
    expect(ids(doc)).toEqual(["charDescription", "deep", "chatHistory", "jailbreak", "main", "style"]);
  });

  it("拖曳：框架條目拖不動；放回原處不算改動", () => {
    const doc = imported();
    expect(moveEntryTo(doc, "chatHistory", { beforeId: "main" })).toBe(false);
    expect(moveEntryTo(doc, "charDescription", { side: "after" })).toBe(false);
    expect(moveEntryTo(doc, "style", { beforeId: "style" })).toBe(false);
    expect(moveEntryTo(doc, "jailbreak", { beforeId: "deep" })).toBe(false);
    expect(moveEntryTo(doc, "deep", { side: "after" })).toBe(false);
    expect(ids(doc)).toEqual(["main", "charDescription", "style", "chatHistory", "jailbreak", "deep"]);
  });

  it("上下移一步跨過一列：自訂條目或「角色與玩家設定」都算一步，框架條目留在原位、不跨聊天歷史（畫面規格 (a)）", () => {
    const doc = imported();
    expect(moveEntry(doc, "style", -1)).toBe(true);
    expect(ids(doc)).toEqual(["main", "style", "charDescription", "chatHistory", "jailbreak", "deep"]);
    expect(moveEntry(doc, "style", -1)).toBe(true);
    expect(ids(doc)).toEqual(["style", "main", "charDescription", "chatHistory", "jailbreak", "deep"]);
    expect(moveEntry(doc, "style", -1)).toBe(false);
    expect(moveEntry(doc, "main", 1)).toBe(true);
    expect(ids(doc)).toEqual(["style", "charDescription", "main", "chatHistory", "jailbreak", "deep"]);
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

  it("換區時整個排序項目搬過去，來源的開關與其他欄位不變", () => {
    const doc = imported();
    const before = structuredClone((doc.st.prompt_order as { order: unknown[] }[])[1]!.order.find((o) => (o as { identifier: string }).identifier === "style"));
    expect(moveToSide(doc, "style", "after")).toBe(true);
    const rows = entryRows(doc);
    expect(rows.at(-1)!.identifier).toBe("style");
    expect((doc.st.prompt_order as { order: unknown[] }[])[1]!.order.at(-1)).toEqual(before);
    expect(moveToSide(doc, "chatHistory", "after")).toBe(false);
  });

  it("刪掉的條目一併從不採用與已確認的調整裡拿掉，不留指向不存在條目的選擇", () => {
    const doc = imported();
    doc.selection.excludedEntryIds = ["spare", "main"];
    doc.selection.acceptedAdaptationIds = ["spare:move_to_suffix"];
    expect(deleteEntry(doc, "spare")).toBe(true);
    expect(doc.selection.excludedEntryIds).toEqual(["main"]);
    expect(doc.selection.acceptedAdaptationIds).toEqual([]);
  });

  it("另一組排序還在用的條目不能刪，畫面據此不給刪除鈕", () => {
    const doc = imported();
    detachEntry(doc, "main");
    expect(canDeleteEntry(doc, "main")).toBe(false);
    expect(canDeleteEntry(doc, "spare")).toBe(true);
  });
});

// 在本站寫的預設（native）上游只收這些欄位（Harbor ValidateNative）：建立時多一個鍵整份就被拒（2026-10-29 正式站 422）
describe("本站寫的預設只用上游收的欄位", () => {
  const ROOT = new Set(["prompts", "prompt_order", "temperature", "top_p"]);
  const PROMPT = new Set(["identifier", "name", "role", "content", "marker", "injection_position"]);
  const allowed = (doc: PresetDocument) => {
    const bad: string[] = [];
    for (const k of Object.keys(doc.st)) if (!ROOT.has(k)) bad.push(`root.${k}`);
    for (const p of doc.st.prompts as Record<string, unknown>[]) for (const k of Object.keys(p)) if (!PROMPT.has(k)) bad.push(`${p.identifier}.${k}`);
    for (const prof of doc.st.prompt_order as Record<string, unknown>[]) for (const k of Object.keys(prof)) if (k !== "character_id" && k !== "order") bad.push(`order.${k}`);
    return bad;
  };
  it("新建的預設與新增、複製後的條目都只有允許的欄位", () => {
    const doc = newDocument("主要指示");
    expect(allowed(doc)).toEqual([]);
    const id = addEntry(doc, { name: "新條目", slot: "S" });
    duplicateEntry(doc, id, "副本");
    duplicateEntry(doc, "main", "主要指示 副本");
    setParamValue(doc, "temperature", 0.8);
    expect(allowed(doc)).toEqual([]);
  });
});

describe("本站寫的預設：存檔前照上游規則找出存不進去的地方", () => {
  it("巨集只認 char、user、lastUserMessage，括號要成對", () => {
    for (const ok of ["純文字", "{{char}} 對 {{user}} 說", "回應 {{lastUserMessage}}"]) expect(nativeMacrosValid(ok)).toBe(true);
    for (const bad of ["{{random}}", "{{trim}}", "{{ char }}", "多了 }}", "少了 {{char", "{{// 註解}}"]) expect(nativeMacrosValid(bad)).toBe(false);
  });
  it("停用或移出排序的條目一樣要過；參數就算改回沿用模型，留著的值也要在範圍內", () => {
    const doc = newDocument("主要指示");
    const a = addEntry(doc, { name: "停用的", slot: "P", content: "{{random}}" });
    setEnabled(doc, a, false);
    const b = addEntry(doc, { name: "移出的", slot: "S", content: "{{trim}}" });
    detachEntry(doc, b);
    setParamValue(doc, "temperature", 3);
    setParamAdopted(doc, "temperature", false);
    expect(nativeProblems(doc).sort()).toEqual([a, b, "temperature"].sort());
    clearParam(doc, "temperature");
    expect(doc.st.temperature).toBeUndefined();
    expect(doc.selection.excludedFields).toEqual([]);
    expect(nativeProblems(doc).sort()).toEqual([a, b].sort());
  });
  it("新建、新增、複製、換位置後的值也符合（系統身分、位置 0、只有框架條目是 marker）", () => {
    const doc = newDocument("主要指示");
    const id = addEntry(doc, { name: "新", slot: "P", content: "{{char}}" });
    duplicateEntry(doc, id, "副本");
    moveToSide(doc, id, "after");
    expect(nativeProblems(doc)).toEqual([]);
  });
});
