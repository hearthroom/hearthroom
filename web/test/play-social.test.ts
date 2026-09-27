/**
 * 對話頁頁首的收藏與評論：舞台只給 roleId，本站用 PlayPage 登記的卡號去查、去改。
 * 沒登記（試玩、審核、非公開）或已經換到別張卡，就回 null，舞台不畫那兩顆。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRoleDetail } from "../src/lib/api";
import { libraryRequest } from "../src/lib/library";
import { playSocial, playSocialHost, registerPlayCard } from "../src/lib/play-social";

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

  it("reads favorite state from the site card and honors the author's comment switch", async () => {
    registerPlayCard({ roleId: "role", cardId: "c1", provider: "harbor" });
    vi.mocked(fetchRoleDetail).mockResolvedValueOnce({ previewShowComments: false });
    vi.mocked(libraryRequest).mockResolvedValueOnce({ active: true });
    await expect(playSocialHost(deps()).social("role")).resolves.toEqual({ favorite: true, favorited: true, comments: false });
    expect(libraryRequest).toHaveBeenCalledWith("favorites/c1", "t");
    expect(fetchRoleDetail).toHaveBeenCalledWith("role", undefined, "zh-Hant", "harbor");
  });

  it("hides favorite without a site sign-in but still offers comments", async () => {
    registerPlayCard({ roleId: "role", cardId: "c1", provider: "harbor" });
    vi.mocked(fetchRoleDetail).mockResolvedValueOnce({});
    await expect(playSocialHost(deps(false)).social("role")).resolves.toEqual({ favorite: false, favorited: false, comments: true });
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
    host.openComments("other");
    expect(playSocial.commentsOpen).toBe(false);
    host.openComments("role");
    expect(playSocial.commentsOpen).toBe(true);
    registerPlayCard(null);
    expect(playSocial.commentsOpen).toBe(false);
  });
});
