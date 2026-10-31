import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { i18n, loadLocale } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";
import { setProvider } from "../src/lib/provider";
import { ApiError } from "../src/lib/api";
import ResourcesPage from "../src/pages/ResourcesPage.vue";

// 資源頁的「生成圖片」：生成在生圖頁做（結果先進快取區），這裡只是入口——帶著正在看的資料夾與參考圖過去。
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
let router: ReturnType<typeof createRouter>;
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
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/resources", component: ResourcesPage }, { path: "/studio", component: { template: "<p>studio</p>" } }] });
  await router.push(path);
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(ResourcesPage).use(pinia).use(router).use(i18n);
  app.mount(root);
  await settle();
}
const entry = () => [...root.querySelectorAll<HTMLButtonElement>(".resource-actions button")].find((b) => b.getAttribute("aria-label") === "Generate image");

it("stays hidden until Harbor offers signed-in generation", async () => {
  mocks.models.mockRejectedValue(new ApiError(404, "not found"));
  await mount();
  expect(entry()).toBeUndefined();
});

it("opens the studio with the open folder as the place to save", async () => {
  mocks.models.mockResolvedValue(models);
  await mount("/resources?folder=f-art");
  entry()!.click();
  await settle();
  expect(router.currentRoute.value.path).toBe("/studio");
  expect(router.currentRoute.value.query).toEqual({ dir: "card/art" });
  expect(mocks.create).not.toHaveBeenCalled();
});

it("opens the studio with an image in the library as the reference", async () => {
  mocks.models.mockResolvedValue(models);
  saved = ["portrait.png"];
  await mount("/resources?folder=f-art");
  root.querySelector<HTMLButtonElement>('button[aria-label="Use as reference"]')!.click();
  await settle();
  expect(router.currentRoute.value.query).toEqual({ dir: "card/art", ref: "https://assets.test/card/art/portrait.png" });
});

it("offers no reference entry when no model takes reference images", async () => {
  mocks.models.mockResolvedValue(models.map(({ maxReferences: _, ...m }) => m));
  saved = ["portrait.png"];
  await mount("/resources?folder=f-art");
  expect(root.querySelector('button[aria-label="Use as reference"]')).toBeNull();
});
