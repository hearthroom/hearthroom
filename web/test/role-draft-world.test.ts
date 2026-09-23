/**
 * 世界模式的成員草稿：讀回、代號生成、整包送出、變更判斷、本地檢查。
 */
import { describe, expect, it } from "vitest";
import { draftFromRoleDetail, makeDraft, makeWorld, readWorld, worldCharacterId, worldChanged, worldPayload, worldProblem } from "../src/lib/role-draft";

describe("world draft", () => {
  it("reads the author view of /role/detail and ignores rows the server would reject", () => {
    const draft = draftFromRoleDetail({
      roleName: "Sakura High",
      world: { version: 1, maxSpeakers: 3, strictness: "strict", characters: [
        { id: "mika", name: "Mika", profile: "class president", description: "MIKA", lorebookId: "b1" },
        { id: "Bad Id", name: "x" },
      ] },
    }, "zh-Hant");
    expect(draft.world).toEqual({ maxSpeakers: 3, strictness: "strict", characters: [{ id: "mika", name: "Mika", avatar: "", sex: "", profile: "class president", description: "MIKA", lorebookId: "b1" }] });
    expect(draftFromRoleDetail({ roleName: "x" }, "zh-Hant").world).toBeNull();
    expect(readWorld({ version: 1, characters: [] })).toBeNull();
  });

  it("derives ids from names, falls back for CJK names, and never reuses one", () => {
    expect(worldCharacterId("Mika Chan", [], 1)).toBe("mika-chan");
    expect(worldCharacterId("美香", [], 2)).toBe("c2");
    expect(worldCharacterId("Ren", ["ren", "ren-2"], 3)).toBe("ren-3");
  });

  it("sends a complete payload and keeps saved ids", () => {
    const world = makeWorld();
    world.characters[0] = { id: "", name: "美香", avatar: " https://x/a.png ", sex: "", profile: "p", description: "d", lorebookId: "" };
    world.characters.push({ id: "ren", name: "Ren", avatar: "", sex: "male", profile: "", description: "", lorebookId: "b2" });
    expect(worldPayload(world)).toEqual({ version: 1, maxSpeakers: 2, strictness: "balanced", characters: [
      { id: "c1", name: "美香", profile: "p", description: "d", avatar: "https://x/a.png" },
      { id: "ren", name: "Ren", profile: "", description: "", sex: "male", lorebookId: "b2" },
    ] });
  });

  it("knows when the member list changed, including switching the mode on or off", () => {
    const original = makeDraft("zh-Hant");
    const draft = makeDraft("zh-Hant");
    expect(worldChanged(draft, original)).toBe(false);
    draft.world = makeWorld();
    expect(worldChanged(draft, original)).toBe(true);
    expect(worldChanged(draft, null)).toBe(true);
    original.world = JSON.parse(JSON.stringify(draft.world));
    expect(worldChanged(draft, original)).toBe(false);
    draft.world = null;
    expect(worldChanged(draft, original)).toBe(true);
  });

  it("flags the first member without a name before saving", () => {
    const world = makeWorld();
    expect(worldProblem(world)).toEqual({ index: 0, reason: "name" });
    world.characters[0].name = "Mika";
    expect(worldProblem(world)).toBeNull();
    expect(worldProblem(null)).toBeNull();
  });
});
