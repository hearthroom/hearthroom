import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { i18n, loadLocale } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";
import { setProvider } from "../src/lib/provider";
import { ApiError } from "../src/lib/api";
import ResourcesPage from "../src/pages/ResourcesPage.vue";

// 資源頁的「生成圖片」：用登入身分生成，成功就放進正在看的資料夾，錯誤用使用者聽得懂的話講。
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  folders: vi.fn(),
  token: vi.fn(),
  connect: vi.fn(),
  models: vi.fn(),
  create: vi.fn(),
  wait: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../src/lib/connections", () => ({ accountToken: mocks.token, connectAccount: mocks.connect }));
vi.mock("../src/lib/resource-client", () => ({
  resourceClient: () => ({ list: mocks.list, folders: mocks.folders, folder: vi.fn(), upload: vi.fn(), remove: vi.fn() }),
}));
vi.mock("../src/lib/media-generation", () => ({
  generationClient: () => ({ models: mocks.models, create: mocks.create, wait: mocks.wait, save: mocks.save }),
}));

const capabilities = { kinds: ["image"], formats: ["image/png"], maxFileBytes: 1e8, search: true, sorts: ["newest"], overwrite: true, relativePaths: true, moves: true };
const folders = [{ folderId: "f-art", name: "card/art", imageCount: 0 }];
const models = [
  { id: "gpt-image-2-dawn", name: "GPT Image 2", laneName: "Dawn", credits: 35, priced: 1, sizes: ["1024x1024", "1536x1024"], maxImages: 2 },
  { id: "gpt-image-2-dew", name: "GPT Image 2", laneName: "Dew", credits: 61, priced: 1, sizes: ["1024x1024"], maxImages: 2 },
  { id: "gpt-image-2", name: "GPT Image 2", credits: 52, priced: 3, sizes: ["1024x1024"], maxImages: 4, maxReferences: 4 },
];
let saved: string[] = [];

let app: ReturnType<typeof createApp>;
let root: HTMLElement;
afterEach(() => {
  app?.unmount();
  root?.remove();
  vi.clearAllMocks();
  sessionStorage.clear();
  saved = [];
});
const settle = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
  await nextTick();
};
async function mount(path = "/resources") {
  setProvider("harbor");
  await loadLocale("en");
  i18n.global.locale.value = "en";
  mocks.token.mockResolvedValue("token-harbor");
  mocks.folders.mockResolvedValue(folders);
  mocks.list.mockImplementation(async (q: { scope: string; folderId?: string }) => {
    const items = q.folderId === "f-art" ? saved.map((n) => ({ id: n, fileName: `card/art/${n}`, imageUrl: `https://assets.test/card/art/${n}`, kind: "image", byteSize: 1 })) : [];
    return { items, total: items.length, usedBytes: 1, byteQuota: 100, libraryPrefix: "", capabilities };
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSession();
  session.me = { accountNumId: 7, nickName: "Fixture", avatar: "" };
  session.profile = { identities: [{ provider: "harbor", externalId: 7 }] } as never;
  session.ensureProfile = async () => {};
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/resources", component: ResourcesPage }] });
  await router.push(path);
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(ResourcesPage).use(pinia).use(router).use(i18n);
  app.mount(root);
  await settle();
}
const entry = () => [...root.querySelectorAll<HTMLButtonElement>(".resource-actions button")].find((b) => b.getAttribute("aria-label") === "Generate image");
const dialog = () => document.querySelector<HTMLElement>('[aria-labelledby="gen-title"]');
async function open() {
  entry()!.click();
  await settle();
  return dialog()!;
}
async function describe(text: string) {
  const box = dialog()!;
  const area = box.querySelector("textarea")!;
  area.value = text;
  area.dispatchEvent(new Event("input"));
  await settle();
  box.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await settle();
  return box;
}

it("stays hidden until Harbor offers signed-in generation", async () => {
  mocks.models.mockRejectedValue(new ApiError(404, "not found"));
  await mount();
  expect(entry()).toBeUndefined();
});

it("asks for a fresh sign-in when this sign-in lacks the generation permission, once", async () => {
  mocks.models.mockRejectedValue(new ApiError(403, "forbidden", "permission_error"));
  await mount();
  const box = await open();
  expect(box.textContent).toContain("sign in again and allow this site to generate images");
  [...box.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Sign in and allow")!.click();
  await settle();
  expect(mocks.connect).toHaveBeenCalledWith("harbor", expect.stringMatching(/^\/resources\?/));
  app.unmount();
  root.remove();
  // 授權回來還是沒有：不再帶去登入，免得繞圈
  await mount();
  expect((await open()).textContent).toContain("can’t generate images here yet");
});

it("generates with the cheapest model and puts the result into the open folder", async () => {
  mocks.models.mockResolvedValue(models);
  mocks.create.mockResolvedValue({ id: "t1", status: "queued", urls: [] });
  mocks.wait.mockImplementation(async (t: { id: string }) => ({ id: t.id, status: "completed", urls: ["https://assets.harperharbor.com/media-gen/t1.png"] }));
  mocks.save.mockImplementation(async () => {
    saved = ["t1.png"];
    return ["a1"];
  });
  await mount("/resources?folder=f-art");
  const box = await open();
  const [modelSelect] = box.querySelectorAll("select");
  expect((modelSelect as HTMLSelectElement).value).toBe("gpt-image-2-dawn");
  // 三個都叫 GPT Image 2：有線路名的帶上線路名，選項才分得出來；模型清單照頁面語言要
  expect(mocks.models).toHaveBeenCalledWith("en");
  expect([...modelSelect!.querySelectorAll("option")].map((o) => o.textContent?.trim())).toEqual([
    "GPT Image 2 · Dawn · 35 credits per image",
    "GPT Image 2 · Dew · 61 credits per image",
    "GPT Image 2 · from 52 credits per image",
  ]);
  expect(box.textContent).toContain("“card/art”");
  await describe("  a lighthouse at dusk ");
  const [input, key] = mocks.create.mock.calls[0]!;
  expect(input).toEqual({ model: "gpt-image-2-dawn", prompt: "a lighthouse at dusk", size: "1024x1024", n: 1 });
  expect(key).toMatch(/^[0-9a-f-]{36}$/);
  expect(mocks.save).toHaveBeenCalledWith("t1", { folderIds: ["f-art"] });
  expect(dialog()).toBeNull();
  expect(root.textContent).toContain("1 new image(s) are now in “card/art”.");
  expect([...root.querySelectorAll(".row-file .row-name")].map((e) => e.textContent?.trim())).toEqual(["t1.png"]);
});

it.each([
  ["/resources", {}],
  ["/resources?folder=dir:card", { directory: "card" }],
])("saves into the library root or a path-only folder (%s)", async (path, target) => {
  mocks.models.mockResolvedValue(models);
  mocks.create.mockResolvedValue({ id: "t1", status: "completed", urls: ["u"] });
  mocks.wait.mockImplementation(async (t: unknown) => t);
  mocks.save.mockResolvedValue(["a1"]);
  await mount(path);
  await open();
  await describe("a fox");
  expect(mocks.save).toHaveBeenCalledWith("t1", target);
});

it("explains a credit shortfall with a way to top up, and a refused prompt as not charged", async () => {
  mocks.models.mockResolvedValue(models);
  mocks.create.mockRejectedValueOnce(new ApiError(402, "x", "insufficient_quota"));
  await mount();
  await open();
  let box = await describe("a fox");
  expect(box.querySelector('[role="alert"]')!.textContent).toContain("gifted credits can’t be used");
  expect(box.querySelector<HTMLAnchorElement>('[role="alert"] a')!.href).toBe("https://console.harperharbor.com/me/billing");
  mocks.create.mockRejectedValueOnce(new ApiError(400, "x", "content_policy_violation"));
  box = await describe("a fox");
  expect(box.querySelector('[role="alert"]')!.textContent).toContain("nothing was charged");
  expect(mocks.create.mock.calls[0]![1]).not.toBe(mocks.create.mock.calls[1]![1]);
});

it("retries a dropped submission with the same order key, and only saves again after storage fills", async () => {
  mocks.models.mockResolvedValue(models);
  mocks.create.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ id: "t9", status: "completed", urls: ["https://assets.test/t9.png"] });
  mocks.wait.mockImplementation(async (t: unknown) => t);
  mocks.save.mockRejectedValueOnce(new ApiError(507, "x", "insufficient_quota")).mockResolvedValueOnce(["a9"]);
  await mount();
  await open();
  let box = await describe("a fox");
  expect(box.querySelector('[role="alert"]')!.textContent).toContain("The connection dropped");
  expect(box.querySelector('button[type="submit"]')!.textContent?.trim()).toBe("Continue");
  box.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await settle();
  expect(mocks.create.mock.calls[1]![1]).toBe(mocks.create.mock.calls[0]![1]);
  expect(box.querySelector('[role="alert"]')!.textContent).toContain("file storage is full");
  expect(box.querySelector<HTMLAnchorElement>('[role="alert"] .gen__links a')!.href).toBe("https://assets.test/t9.png");
  expect(box.querySelector('button[type="submit"]')!.textContent?.trim()).toBe("Save again");
  box.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  await settle();
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(dialog()).toBeNull();
});

it("keeps generating after the dialog closes and still saves the result", async () => {
  mocks.models.mockResolvedValue(models);
  let finish!: (t: unknown) => void;
  mocks.create.mockResolvedValue({ id: "t5", status: "in_progress", urls: [] });
  mocks.wait.mockImplementation(() => new Promise((r) => (finish = r)));
  mocks.save.mockResolvedValue(["a5"]);
  await mount();
  await open();
  const box = await describe("a fox");
  expect(box.textContent).toContain("keeps going if you close this window");
  [...box.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Keep going in background")!.click();
  await settle();
  expect(dialog()!.closest<HTMLElement>(".modal-backdrop")!.style.display).toBe("none");
  expect(root.textContent).toContain("still being generated");
  finish({ id: "t5", status: "completed", urls: ["u"] });
  await settle();
  expect(mocks.save).toHaveBeenCalledWith("t5", {});
  expect(dialog()).toBeNull();
});

// 「以這張為參考」：圖片列有入口，框裡看得到參考圖，只列收參考圖的模型，送出帶 images；拿掉參考就回到全部模型。
it("generates from an image in the library as the reference", async () => {
  mocks.models.mockResolvedValue(models);
  mocks.create.mockResolvedValue({ id: "t7", status: "completed", urls: ["u"] });
  mocks.wait.mockImplementation(async (t: unknown) => t);
  mocks.save.mockResolvedValue(["a7"]);
  saved = ["portrait.png"];
  await mount("/resources?folder=f-art");
  const use = root.querySelector<HTMLButtonElement>('button[aria-label="Use as reference"]');
  expect(use).not.toBeNull();
  use!.click();
  await settle();
  const box = dialog()!;
  expect(box.querySelector<HTMLImageElement>(".gen__reference img")!.src).toBe("https://assets.test/card/art/portrait.png");
  expect(box.textContent).toContain("keep this character’s face, hair and outfit");
  const options = () => [...box.querySelector("select")!.querySelectorAll("option")].map((o) => o.value);
  expect(options()).toEqual(["gpt-image-2"]);
  await describe("the same girl under a red umbrella");
  expect(mocks.create.mock.calls[0]![0]).toEqual({
    model: "gpt-image-2", prompt: "the same girl under a red umbrella", size: "1024x1024", n: 1,
    images: ["https://assets.test/card/art/portrait.png"],
  });

  root.querySelector<HTMLButtonElement>('button[aria-label="Use as reference"]')!.click();
  await settle();
  [...dialog()!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Remove reference")!.click();
  await settle();
  expect(dialog()!.querySelector(".gen__reference")).toBeNull();
  expect([...dialog()!.querySelector("select")!.querySelectorAll("option")].map((o) => o.value)).toEqual(["gpt-image-2-dawn", "gpt-image-2-dew", "gpt-image-2"]);
});

it("offers no reference entry when no model takes reference images", async () => {
  mocks.models.mockResolvedValue(models.map(({ maxReferences: _, ...m }) => m));
  saved = ["portrait.png"];
  await mount("/resources?folder=f-art");
  expect(root.querySelector('button[aria-label="Use as reference"]')).toBeNull();
});
