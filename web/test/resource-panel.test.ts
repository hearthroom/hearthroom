/**
 * 編輯頁旁的「我的資源」：多選上傳、勾選刪除。
 *
 * 2026-09-11 作者反映：編輯頁傳圖一次只能挑一張，也沒有刪除鈕，傳錯了得離開表單去資源頁刪。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import ResourcePanel from "../src/components/editor/ResourcePanel.vue";

const api = vi.hoisted(() => {
  const image = (id: number) => ({ id, imageUrl: `https://cdn.test/${id}.png`, kind: "image", byteSize: 1 << 20, moderationState: "pass", pixelWidth: 512, pixelHeight: 768, createTime: "" });
  return {
    fetchLibraryImages: vi.fn(async () => ({ items: [image(1), image(2), image(3)], total: 3, quota: 10000, usedBytes: 3 << 20, byteQuota: 500 << 20 })),
    fetchLibraryFolders: vi.fn(async () => [{ folderId: "f-1", name: "頭像框", imageCount: 1 }]),
    deleteLibraryImages: vi.fn(async () => {}),
    uploadImage: vi.fn(async () => "https://cdn.test/new.png"),
  };
});
vi.mock("../src/lib/api", () => api);
vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "tok" }) }));
vi.mock("../src/lib/confirm", () => ({ confirmDialog: async () => true }));

let app: App | null = null;
let root: HTMLElement;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
const byText = (text: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;

beforeEach(async () => {
  for (const fn of Object.values(api)) fn.mockClear();
  root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp(ResourcePanel).use(i18n);
  app.mount(root);
  await flush();
});
afterEach(() => { app?.unmount(); app = null; root.remove(); });

describe("我的資源（編輯頁側欄）", () => {
  it("一次挑三張就傳三次；在資料夾裡傳會帶 folderIds；傳完重讀列表", async () => {
    byText("頭像框").click();
    await flush();
    const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
    expect(input.multiple).toBe(true);
    const files = [1, 2, 3].map((n) => new File(["x"], `p${n}.png`, { type: "image/png" }));
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change"));
    await flush();
    expect(api.uploadImage).toHaveBeenCalledTimes(3);
    expect(api.uploadImage.mock.calls[0]).toEqual([files[0], "tok", undefined, ["f-1"]]);
    expect(root.textContent).toContain(i18n.global.t("res.panel.uploaded"));
    expect(api.fetchLibraryImages.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("一張傳失敗：其餘照傳，失敗的那張點名；不是整批當失敗", async () => {
    api.uploadImage.mockRejectedValueOnce(new Error("圖片上傳失敗，換一張或稍後再試。"));
    const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
    const files = [1, 2].map((n) => new File(["x"], `p${n}.png`, { type: "image/png" }));
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change"));
    await flush();
    expect(api.uploadImage).toHaveBeenCalledTimes(2);
    expect(root.querySelector(".notice--error")?.textContent).toContain("p1.png");
  });

  it("管理 → 勾兩張 → 刪除：送的是那兩個 id，刪完退出管理並重讀", async () => {
    byText(i18n.global.t("res.panel.manage")).click();
    await flush();
    const boxes = root.querySelectorAll<HTMLInputElement>(".tile__pick input");
    expect(boxes).toHaveLength(3);
    boxes[0].click();
    boxes[2].click();
    await flush();
    expect(root.textContent).toContain(i18n.global.t("res.selected", { n: 2 }));
    byText(i18n.global.t("dialog.delete")).click();
    await flush();
    expect(api.deleteLibraryImages).toHaveBeenCalledWith([1, 3], "tok");
    expect(root.querySelectorAll(".tile__pick")).toHaveLength(0);
    expect(root.textContent).toContain(i18n.global.t("res.deleted", { n: 2 }));
  });
});
