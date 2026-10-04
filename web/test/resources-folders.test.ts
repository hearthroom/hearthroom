import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { i18n, loadLocale } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";
import { setProvider } from "../src/lib/provider";
import ResourcesPage from "../src/pages/ResourcesPage.vue";

// 我的資源頁：資料夾以路徑名歸類成樹，進夾看相對檔名，整批複製網址。
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  folders: vi.fn(),
  folder: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  token: vi.fn(),
}));
vi.mock("../src/lib/connections", () => ({ accountToken: mocks.token, connectAccount: vi.fn() }));
vi.mock("../src/lib/resource-client", () => ({
  resourceClient: () => ({
    list: mocks.list,
    folders: mocks.folders,
    folder: mocks.folder,
    upload: mocks.upload,
    remove: mocks.remove,
  }),
}));

const capabilities = {
  kinds: ["image", "font"],
  formats: ["image/png", "image/webp"],
  maxFileBytes: 104857600,
  search: true,
  sorts: ["newest", "oldest", "name", "size"],
  overwrite: true,
  relativePaths: true,
};
const file = (id: string, fileName: string) => ({
  id,
  fileName,
  imageUrl: `https://assets.example.test/u/u1/${fileName}`,
  kind: "image",
  mimeType: "image/webp",
  byteSize: 1024,
});
// 真實資料的形狀：card/art 與 card/art/blur 各有自己的夾，card 本身沒有。
const folders = [
  { folderId: "f-art", name: "card/art", imageCount: 2 },
  { folderId: "f-blur", name: "card/art/blur", imageCount: 1 },
  { folderId: "f-misc", name: "misc", imageCount: 1 },
];
const pages: Record<string, ReturnType<typeof file>[]> = {
  unfiled: [file("loose", "loose.png")],
  all: [file("loose", "loose.png"), file("a1", "card/art/a.webp"), file("a2", "card/art/b.webp"), file("b1", "card/art/blur/a.webp"), file("m1", "misc/m.png")],
  "f-art": [file("a1", "card/art/a.webp"), file("a2", "card/art/b.webp")],
  "f-blur": [file("b1", "card/art/blur/a.webp")],
  "f-misc": [file("m1", "misc/m.png")],
};

let app: ReturnType<typeof createApp>;
let root: HTMLElement;
afterEach(() => {
  app?.unmount();
  root?.remove();
  vi.clearAllMocks();
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
  mocks.list.mockImplementation(async (q: { scope: string; folderId?: string; q?: string }) => {
    let items = q.scope === "all" ? pages.all! : q.scope === "unfiled" ? pages.unfiled! : (pages[q.folderId!] ?? []);
    if (q.q) items = items.filter((r) => r.fileName.includes(q.q!));
    return { items, total: items.length, usedBytes: 10, byteQuota: 100, libraryPrefix: "https://assets.example.test/u/u1/", capabilities };
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
  return router;
}
const texts = (sel: string) => [...root.querySelectorAll(sel)].map((e) => e.textContent?.trim());
const click = (sel: string, text: string) => {
  const el = [...root.querySelectorAll<HTMLButtonElement>(sel)].find((b) => b.textContent?.trim() === text);
  expect(el, `${sel} "${text}"`).toBeTruthy();
  el!.click();
};

const rows = () =>
  [...root.querySelectorAll(".resource-table tbody tr")].map(
    (r) => (r.classList.contains("row-folder") ? "d:" : "f:") + r.querySelector(".row-name")?.textContent?.trim(),
  );
const openRow = (label: string) => click(".resource-table .row-name", label);

it("lands on a file-manager view: folders first, loose files below, no thumbnails", async () => {
  await mount();
  expect(mocks.list.mock.lastCall?.[0]).toMatchObject({ scope: "unfiled" });
  expect(rows()).toEqual(["d:card", "d:misc", "f:loose.png"]);
  expect(root.querySelector(".resource-table img")).toBeNull();
  expect(root.querySelector(".resource-sidebar")).toBeNull();
});

it("opens a folder with a breadcrumb, child folders first and names relative to that folder", async () => {
  await mount();
  openRow("card");
  await settle();
  // card exists only as a path: it lists its subfolders, and nothing else
  expect(rows()).toEqual(["d:art"]);
  expect(root.querySelector(".resource-pager")).toBeNull();
  openRow("art");
  await settle();
  expect(mocks.list.mock.lastCall?.[0]).toMatchObject({ scope: "folder", folderId: "f-art" });
  expect(texts(".resource-crumbs .crumb")).toEqual(["All", "card", "art"]);
  expect(rows()).toEqual(["d:blur", "f:a.webp", "f:b.webp"]);
  openRow("blur");
  await settle();
  expect(mocks.list.mock.lastCall?.[0]).toMatchObject({ scope: "folder", folderId: "f-blur" });
  expect(rows()).toEqual(["f:a.webp"]);
  expect(texts(".resource-path-actions button")).toContain("Rename");
  click(".resource-crumbs .crumb", "All");
  await settle();
  expect(mocks.list.mock.lastCall?.[0]).toMatchObject({ scope: "unfiled" });
});

it("searches across every file with full paths, and copies the selected URLs in one go", async () => {
  await mount();
  const input = root.querySelector(".resource-search input") as HTMLInputElement;
  input.value = "a.webp";
  input.dispatchEvent(new Event("input"));
  click(".resource-search button", "Search");
  await settle();
  expect(mocks.list.mock.lastCall?.[0]).toMatchObject({ scope: "all", q: "a.webp" });
  expect(rows()).toEqual(["f:card/art/a.webp", "f:card/art/blur/a.webp"]);
  expect(root.textContent).toContain("Results from all files");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  click(".resource-toolbar button", "Manage");
  await settle();
  (root.querySelector(".resource-batch input[type=checkbox]") as HTMLInputElement).click();
  await settle();
  click(".resource-batch button", "Copy selected URLs");
  await settle();
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0]![0].split("\n")).toHaveLength(2);
  expect(root.textContent).toContain("Copied 2 URLs");
});
