/**
 * 我的資源：整頁掛起來、上游 API 換成假的，看送出去的請求對不對。
 *
 * 列表與資料夾各載一次；管理模式下勾兩張刪掉，送的是那兩個 id；在資料夾裡上傳，
 * folderIds 要跟著送；上游回 image_in_use 時畫面說的是「有圖片正被用」而不是通用錯誤。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import ResourcesPage from "../src/pages/ResourcesPage.vue";

const api = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(readonly status: number, message: string, readonly code = "") { super(message); }
  }
  const image = (id: number, extra: Record<string, unknown> = {}) => ({ id, imageUrl: `https://cdn.test/${id}.png`, kind: "image", byteSize: 1 << 20, moderationState: "pass", pixelWidth: 512, pixelHeight: 768, createTime: "", ...extra });
  return {
    ApiError,
    fetchLibraryImages: vi.fn(async () => ({ items: [image(1), image(2, { moderationState: "pending" }), image(3, { kind: "font", imageUrl: "https://cdn.test/3.woff2", moderationState: "unreviewed" })], total: 3, quota: 10000, usedBytes: 3 << 20, byteQuota: 200 << 20 })),
    fetchLibraryFolders: vi.fn(async () => [{ folderId: "f-1", name: "頭像框", imageCount: 1 }]),
    createLibraryFolder: vi.fn(async (name: string) => ({ folderId: "f-2", name, imageCount: 0 })),
    renameLibraryFolder: vi.fn(async () => {}),
    deleteLibraryFolder: vi.fn(async () => {}),
    addImagesToFolder: vi.fn(async () => {}),
    removeImagesFromFolder: vi.fn(async () => {}),
    deleteLibraryImages: vi.fn(async () => {}),
    uploadImage: vi.fn(async () => "https://cdn.test/new.png"),
  };
});
vi.mock("../src/lib/api", () => api);
vi.mock("../src/lib/session", () => ({
  useSession: () => ({ accessToken: async () => "tok", me: { accountNumId: 7, nickName: "作者", avatar: "" } }),
}));
vi.mock("../src/lib/confirm", () => ({ confirmDialog: async () => true }));

let app: App | null = null;
let router: Router;
let root: HTMLElement;

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

async function mount() {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/resources", component: ResourcesPage }] });
  await router.push("/resources");
  await router.isReady();
  root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp({ template: "<RouterView />" }).use(createPinia()).use(i18n).use(router);
  app.mount(root);
  await flush();
}

const byText = (text: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;

beforeEach(() => {
  for (const fn of Object.values(api)) if (typeof fn === "function" && "mockClear" in fn) (fn as ReturnType<typeof vi.fn>).mockClear();
});
afterEach(() => {
  app?.unmount();
  app = null;
  root.remove();
});

describe("我的資源", () => {
  it("進頁面載一次列表與資料夾；審核中的圖有標記；配額照上游的張數", async () => {
    await mount();
    expect(api.fetchLibraryImages).toHaveBeenCalledWith({ kind: "all" }, 1, 48, "tok", "all");
    expect(api.fetchLibraryFolders).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll(".tile").length).toBe(3);
    expect(root.querySelector(".tile__state")?.textContent).toBe("審核中");
    expect(root.querySelector(".quota__num")?.textContent).toContain("3.0 MB");
    expect(root.querySelector(".quota__num")?.textContent).toContain("200 MB");
    // 字型沒有審核狀態徽章，圖塊上是副檔名
    expect(root.querySelectorAll(".tile__state").length).toBe(1);
    expect(root.querySelector(".tile__ext")?.textContent).toBe("WOFF2");
  });

  it("管理模式勾兩張刪掉：送的是那兩個 id，刪完重抓", async () => {
    await mount();
    byText("管理").click();
    await flush();
    const picks = root.querySelectorAll<HTMLButtonElement>(".tile__pick");
    picks[0].click();
    picks[2].click();
    await flush();
    byText("刪除").click();
    await flush();
    expect(api.deleteLibraryImages).toHaveBeenCalledWith([1, 3], "tok");
    expect(api.fetchLibraryImages).toHaveBeenCalledTimes(2);
  });

  it("切到資料夾再上傳：folderIds 跟著送，列表只要那個資料夾", async () => {
    await mount();
    byText("頭像框 1").click();
    await flush();
    expect(api.fetchLibraryImages).toHaveBeenLastCalledWith({ kind: "folder", folderId: "f-1" }, 1, 48, "tok", "all");
    const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    await flush();
    expect(api.uploadImage).toHaveBeenCalledWith(file, "tok", undefined, ["f-1"]);
  });

  it("新建資料夾：Enter 送出，建好就切過去", async () => {
    await mount();
    byText("新資料夾").click();
    await flush();
    const input = root.querySelector<HTMLInputElement>(".folders__edit input")!;
    input.value = "背景";
    input.dispatchEvent(new Event("input"));
    root.querySelector("form.folders__edit")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(api.createLibraryFolder).toHaveBeenCalledWith("背景", "tok");
    expect(api.fetchLibraryImages).toHaveBeenLastCalledWith({ kind: "folder", folderId: "f-2" }, 1, 48, "tok", "all");
  });

  it("切種類籤：只要那一種，檔案挑選器也跟著收窄", async () => {
    await mount();
    byText("影片").click();
    await flush();
    expect(api.fetchLibraryImages).toHaveBeenLastCalledWith({ kind: "all" }, 1, 48, "tok", "video");
    expect(root.querySelector<HTMLInputElement>("input[type=file]")!.accept).toBe("video/mp4,video/webm");
  });

  it("上游說圖片被卡片用著：畫面照錯誤碼說話", async () => {
    api.deleteLibraryImages.mockRejectedValueOnce(new api.ApiError(400, "請求失敗", "image_in_use"));
    await mount();
    byText("管理").click();
    await flush();
    root.querySelector<HTMLButtonElement>(".tile__pick")!.click();
    await flush();
    byText("刪除").click();
    await flush();
    expect(root.querySelector("[role=alert]")?.textContent).toContain("正被角色卡當頭像或背景用");
  });
});
