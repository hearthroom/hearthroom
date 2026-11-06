/**
 * 對話頁頁首的收藏與卡片資訊：舞台只給 roleId，本站用 PlayPage 登記的卡號去查、去改。
 * 沒登記（試玩、審核、非公開）或已經換到別張卡，就回 null，舞台不畫那兩顆。
 * 有登記就有卡片資訊入口；作者關掉評論只收起面板裡的評論分頁（記在 playSocial.detail）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { fetchRoleDetail } from "../src/lib/api";
import { libraryRequest } from "../src/lib/library";
import { playSocial, playSocialHost, registerPlayCard, reloadPlayDetail } from "../src/lib/play-social";

vi.mock("../src/lib/api", () => ({ fetchRoleDetail: vi.fn() }));
vi.mock("../src/lib/library", () => ({ libraryRequest: vi.fn() }));

const deps = (signedIn = true) => ({ signedIn: () => signedIn, token: async () => "t", lang: () => "zh-Hant" });

describe("playSocialHost", () => {
  beforeEach(() => { vi.resetAllMocks(); registerPlayCard(null); });

  it("has nothing for a card the page did not register", async () => {
    await expect(playSocialHost(deps()).social("role")).resolves.toBeNull();
    registerPlayCard({ roleId: "other", cardId: "c1", provider: "harbor" });
    await expect(playSocialHost(deps()).social("role")).resolves.toBeNull();
    expect(libraryRequest).not.toHaveBeenCalled();
  });

  it("reads favorite state from the site card; the author's comment switch and README go to the panel", async () => {
    registerPlayCard({ roleId: "role", cardId: "c1", provider: "harbor" });
    vi.mocked(fetchRoleDetail).mockResolvedValueOnce({ previewShowComments: false, roleReadme: "# hi" });
    vi.mocked(libraryRequest).mockResolvedValueOnce({ active: true });
    // Comments turned off still leaves the info entry: social() answers for the registered card.
    await expect(playSocialHost(deps()).social("role")).resolves.toEqual({ favorite: true, favorited: true });
    expect(playSocial.detail).toEqual({ comments: false, readme: "# hi" });
    expect(libraryRequest).toHaveBeenCalledWith("favorites/c1", "t");
    expect(fetchRoleDetail).toHaveBeenCalledWith("role", undefined, "zh-Hant", "harbor");
  });

  it("hides favorite without a site sign-in but still offers the info entry with comments", async () => {
    registerPlayCard({ roleId: "role", cardId: "c1", provider: "harbor" });
    vi.mocked(fetchRoleDetail).mockResolvedValueOnce({});
    await expect(playSocialHost(deps(false)).social("role")).resolves.toEqual({ favorite: false, favorited: false });
    expect(playSocial.detail).toEqual({ comments: true, readme: "" });
    expect(libraryRequest).not.toHaveBeenCalled();
  });

  it("drops a late answer after the page switched cards", async () => {
    registerPlayCard({ roleId: "role", cardId: "c1", provider: "harbor" });
    let finish!: (v: { active: boolean }) => void;
    vi.mocked(fetchRoleDetail).mockResolvedValueOnce({});
    vi.mocked(libraryRequest).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = playSocialHost(deps()).social("role");
    registerPlayCard({ roleId: "next", cardId: "c2", provider: "harbor" });
    finish({ active: true });
    await expect(pending).resolves.toBeNull();
    expect(playSocial.detail).toBeNull();
  });

  it("writes favorites to the registered card and opens comments only for it", async () => {
    registerPlayCard({ roleId: "role", cardId: "c1", provider: "harbor" });
    vi.mocked(libraryRequest).mockResolvedValueOnce({ active: true });
    const host = playSocialHost(deps());
    await expect(host.setFavorite("role", true)).resolves.toBe(true);
    expect(libraryRequest).toHaveBeenCalledWith("favorites/c1", "t", "PUT");
    vi.mocked(libraryRequest).mockResolvedValueOnce({ active: false });
    await expect(host.setFavorite("role", false)).resolves.toBe(false);
    expect(libraryRequest).toHaveBeenLastCalledWith("favorites/c1", "t", "DELETE");
    await expect(host.setFavorite("other", true)).rejects.toThrow();
  });

  it("toggles the info panel only for the registered card, reports changes, and resets on card change", async () => {
    registerPlayCard({ roleId: "role", cardId: "c1", provider: "harbor" });
    const host = playSocialHost(deps());
    const seen: boolean[] = [];
    const stop = host.onInfoChange((open) => seen.push(open));
    host.toggleInfo("other");
    expect(playSocial.open).toBe(false);
    host.toggleInfo("role");
    expect(playSocial.open).toBe(true);
    expect(playSocial.tab).toBe("info");
    playSocial.tab = "rankings";
    host.toggleInfo("role");
    expect(playSocial.open).toBe(false);
    await Promise.resolve();
    // Reopening returns to the last tab the player used.
    host.toggleInfo("role");
    expect(playSocial.tab).toBe("rankings");
    await nextTick();
    expect(seen.at(-1)).toBe(true);
    registerPlayCard(null);
    expect(playSocial.open).toBe(false);
    expect(playSocial.tab).toBe("info");
    await nextTick();
    expect(seen.at(-1)).toBe(false);
    stop();
  });

  it("marks the card details as failed when they cannot be read, and reloads them on request", async () => {
    registerPlayCard({ roleId: "role", cardId: "c1", provider: "harbor" });
    expect(playSocial.detailStatus).toBe("idle");
    vi.mocked(fetchRoleDetail).mockRejectedValueOnce(new Error("down"));
    await expect(playSocialHost(deps(false)).social("role")).resolves.toEqual({ favorite: false, favorited: false });
    expect(playSocial.detailStatus).toBe("failed");
    expect(playSocial.detail).toBeNull();
    vi.mocked(fetchRoleDetail).mockResolvedValueOnce({ roleReadme: "hi" });
    const pending = reloadPlayDetail("zh-Hant");
    expect(playSocial.detailStatus).toBe("loading");
    await pending;
    expect(playSocial.detailStatus).toBe("ready");
    expect(playSocial.detail).toEqual({ comments: true, readme: "hi" });
    registerPlayCard(null);
    expect(playSocial.detailStatus).toBe("idle");
  });

  it("lets only the latest detail read write, so a late failure cannot cover a reload that worked", async () => {
    registerPlayCard({ roleId: "role", cardId: "c1", provider: "harbor" });
    let failFirst!: (e: Error) => void;
    vi.mocked(fetchRoleDetail).mockReturnValueOnce(new Promise((_, reject) => { failFirst = reject; }));
    const first = reloadPlayDetail("zh-Hant");
    vi.mocked(fetchRoleDetail).mockResolvedValueOnce({ roleReadme: "ok" });
    await reloadPlayDetail("zh-Hant");
    failFirst(new Error("late"));
    await first;
    expect(playSocial.detailStatus).toBe("ready");
    expect(playSocial.detail).toEqual({ comments: true, readme: "ok" });
  });
});
