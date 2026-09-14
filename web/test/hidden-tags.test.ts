import { describe, expect, it, vi, afterEach } from "vitest";
import { hideParam, visibleCatalog } from "../src/lib/hidden-tags";
import { TAG_CATALOG } from "../../shared/tag-catalog";
import { fetchBoard, setViewerHiddenTags } from "../src/lib/api";

afterEach(() => { vi.unstubAllGlobals(); setViewerHiddenTags(null); });

describe("不想看的類型：類型列與查詢字串", () => {
  it("隱藏的籤不畫；正點著的那個籤就算隱藏也留著", () => {
    const keys = (list: { key: string }[]) => list.map((x) => x.key);
    expect(visibleCatalog(TAG_CATALOG, [], "")).toBe(TAG_CATALOG);
    expect(keys(visibleCatalog(TAG_CATALOG, ["womens-fiction", "r18g"], ""))).not.toContain("womens-fiction");
    expect(keys(visibleCatalog(TAG_CATALOG, ["womens-fiction", "r18g"], ""))).not.toContain("r18g");
    expect(keys(visibleCatalog(TAG_CATALOG, ["womens-fiction", "r18g"], "womens-fiction"))).toContain("womens-fiction");
    expect(keys(visibleCatalog(TAG_CATALOG, ["womens-fiction", "r18g"], "womens-fiction"))).not.toContain("r18g");
  });

  it("查詢字串排序去重，同一組名單同一串", () => {
    expect(hideParam(["womens-fiction", "r18g", "womens-fiction", ""])).toBe("r18g,womens-fiction");
    expect(hideParam([])).toBe("");
  });

  it("榜單與搜尋拿清單時帶 hide；作者頁不帶（看一個人的作品不套個人口味）", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify({ items: [], total: 0, hasNext: false, limit: 24, offset: 0, sort: "hot" }), { status: 200 }); }));
    setViewerHiddenTags(async () => ["womens-fiction", "r18g"]);
    await fetchBoard({ zone: "zh", sort: "hot" });
    await fetchBoard({ zone: "zh", q: "貓", sort: "relevance" });
    await fetchBoard({ author: "aaabaaab" });
    expect(new URL(calls[0], "https://x.test").searchParams.get("hide")).toBe("r18g,womens-fiction");
    expect(new URL(calls[1], "https://x.test").searchParams.get("hide")).toBe("r18g,womens-fiction");
    expect(new URL(calls[2], "https://x.test").searchParams.get("hide")).toBeNull();
    setViewerHiddenTags(async () => []);
    await fetchBoard({ zone: "zh" });
    expect(new URL(calls[3], "https://x.test").searchParams.has("hide")).toBe(false);
  });
});
