import { describe, expect, it } from "vitest";
import { buildFolderTree, findByFolderId, findNode, flattenTree, relativeName } from "../src/lib/resource-tree";

// 真實資料的形狀：目錄上傳只會建「最深那一層」的夾，所以 card/art 與 card/art/blur 都在，card 本身不在。
const folders = [
  { folderId: "f-art", name: "01a0f07d/art", imageCount: 30 },
  { folderId: "f-blur", name: "01a0f07d/art/blur", imageCount: 20 },
  { folderId: "f-blades", name: "forged-in-fire/blades", imageCount: 3 },
  { folderId: "f-plain", name: "cli-rm-test", imageCount: 1 },
];

describe("resource folder tree", () => {
  it("nests path-named folders and fills in missing parents as virtual nodes", () => {
    const root = buildFolderTree(folders);
    expect(root.children.map((c) => c.name)).toEqual(["01a0f07d", "cli-rm-test", "forged-in-fire"]);
    const card = findNode(root, "01a0f07d")!;
    expect(card.folderId).toBeUndefined();
    expect(card.own).toBe(0);
    expect(card.count).toBe(50);
    const art = findNode(root, "01a0f07d/art")!;
    expect(art.folderId).toBe("f-art");
    expect(art.own).toBe(30);
    expect(art.count).toBe(50);
    expect(art.children.map((c) => c.path)).toEqual(["01a0f07d/art/blur"]);
    expect(findNode(root, "01a0f07d/art/blur")!.count).toBe(20);
    expect(findNode(root, "nope")).toBeUndefined();
  });
  it("flattens depth-first with depth for the sidebar and finds nodes by folder id", () => {
    const root = buildFolderTree(folders);
    expect(flattenTree(root).map((r) => `${r.depth}:${r.node.name}`)).toEqual([
      "0:01a0f07d",
      "1:art",
      "2:blur",
      "0:cli-rm-test",
      "0:forged-in-fire",
      "1:blades",
    ]);
    expect(findByFolderId(root, "f-blur")?.path).toBe("01a0f07d/art/blur");
    expect(findByFolderId(root, "missing")).toBeUndefined();
  });
  it("shows file names relative to the open folder", () => {
    expect(relativeName("01a0f07d/art/blur/a.webp", "01a0f07d/art")).toBe("blur/a.webp");
    expect(relativeName("elsewhere/a.webp", "01a0f07d/art")).toBe("elsewhere/a.webp");
    expect(relativeName("a.webp", "")).toBe("a.webp");
  });
  it("keeps one node per path even when two applications hold the same folder name", () => {
    const root = buildFolderTree([
      { folderId: "a", name: "shared", imageCount: 2 },
      { folderId: "b", name: "shared", imageCount: 3 },
    ]);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]!.folderId).toBe("a");
    expect(root.children[0]!.count).toBe(5);
  });
});
