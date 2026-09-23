import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, reactive, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import ResourcesPage from "../src/pages/ResourcesPage.vue";
import { confirmState, settleConfirm } from "../src/lib/confirm";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  folders: vi.fn(async () => []),
  remove: vi.fn(async () => {}),
  folder: vi.fn(),
  upload: vi.fn(),
  token: vi.fn(async () => "token"),
}));
vi.mock("../src/lib/connections", () => ({
  accountToken: mocks.token,
  connectAccount: vi.fn(),
}));
vi.mock("../src/lib/resource-client", () => ({
  resourceClient: (provider: string) => ({
    list: (q: unknown) => mocks.list(provider, q),
    folders: mocks.folders,
    remove: mocks.remove,
    folder: mocks.folder,
    upload: mocks.upload,
  }),
}));
const state = reactive({
  profile: { identities: [{ provider: "harbor", externalId: 2 }] },
  ensureProfile: async () => {},
});
vi.mock("../src/lib/session", () => ({ useSession: () => state }));
let app: App;
let root: HTMLElement;
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};
const page = (name = "a.png", total = 60) => ({
  items: [
    {
      id: name,
      imageUrl: "https://test/" + name,
      fileName: name,
      kind: "image",
      byteSize: 12,
    },
  ],
  total,
  usedBytes: 12,
  byteQuota: 1024,
  libraryPrefix: "",
  capabilities: {
    kinds: ["image"],
    formats: ["image/png"],
    maxFileBytes: 1024,
    search: true,
    sorts: ["newest", "name"],
    overwrite: false,
  },
});
async function mount(path = "/resources") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/resources", component: ResourcesPage }],
  });
  await router.push(path);
  root = document.createElement("div");
  document.body.append(root);
  app = createApp({ template: "<RouterView />" }).use(router).use(i18n);
  app.mount(root);
  await flush();
  return router;
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  state.profile.identities = [{ provider: "harbor", externalId: 2 }];
  mocks.list.mockImplementation(async () => page());
});
afterEach(() => {
  app?.unmount();
  root?.remove();
});
describe("provider resource library", () => {
  it("keeps the prefix available while upload details stay collapsed until requested", async () => {
    mocks.list.mockResolvedValue({ ...page(), libraryPrefix: "https://assets.example/u/author/" });
    await mount();
    const toggle = root.querySelector<HTMLButtonElement>('[aria-controls="resource-details"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector("#resource-details")).toBeNull();
    expect(root.querySelector(".resource-prefix code")?.textContent).toContain("/u/author/");
    toggle!.click();
    await flush();
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector("#resource-details")?.textContent).toContain("PNG");
    toggle!.click();
    await flush();
    expect(root.querySelector("#resource-details")).toBeNull();
    expect(root.querySelector(".resource-prefix button")).not.toBeNull();
  });
  it("shows each provider's prefix without expanding and copies exactly the displayed prefix", async () => {
    state.profile.identities.push({ provider: "lunatalk", externalId: 3 });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mocks.list.mockImplementation(async (provider: string) => ({
      ...page(), libraryPrefix: `https://assets.example/${provider}/u/test${provider === "harbor" ? "/" : ""}`,
    }));
    await mount();
    const prefix = () => root.querySelector<HTMLElement>(".resource-prefix")!;
    expect(prefix().closest("details:not([open])")).toBeNull();
    expect(prefix().querySelector("code")?.textContent).toBe("https://assets.example/harbor/u/test/");
    prefix().querySelector<HTMLButtonElement>("button")!.click();
    await flush();
    expect(writeText).toHaveBeenLastCalledWith("https://assets.example/harbor/u/test/");
    expect(root.querySelector('[data-provider="lunatalk"]')).toBeNull();
  });
  it("restores a linked sort before capabilities have loaded", async () => {
    await mount("/resources?provider=harbor&sort=name&page=2");
    expect(mocks.list.mock.calls[0][1]).toMatchObject({
      sort: "name",
      page: 2,
    });
  });
  it("auto-selects the only linked provider and exposes inline preview", async () => {
    await mount();
    expect(root.textContent).toContain("HarperHarbor");
    expect(root.querySelector("[data-provider]")).toBeNull();
    expect(mocks.list.mock.calls[0][0]).toBe("harbor");
    root.querySelector<HTMLButtonElement>("[data-preview]")!.click();
    await flush();
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
  });
  it("ignores a retired provider URL", async () => {
    state.profile.identities.push({ provider: "lunatalk", externalId: 3 });
    await mount("/resources?provider=lunatalk");
    expect(mocks.list.mock.calls[0][0]).toBe("harbor");
  });
  it("keeps the current page on failure and retries without skipping", async () => {
    const router = await mount();
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    root.querySelector<HTMLButtonElement>("[data-next]")!.click();
    await flush();
    expect(router.currentRoute.value.query.page ?? "1").toBe("1");
    root.querySelector<HTMLButtonElement>("[data-next]")!.click();
    await flush();
    expect(mocks.list.mock.calls.at(-1)?.[1].page).toBe(2);
    expect(router.currentRoute.value.query.page).toBe("2");
  });
});

it("uses server search across the collection and keeps capability controls while loading", async () => {
  await mount();
  const field = root.querySelector<HTMLInputElement>(".resource-search input")!;
  field.value = "forest";
  field.dispatchEvent(new Event("input"));
  field
    .closest("form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await flush();
  expect(mocks.list.mock.calls.at(-1)?.[1]).toMatchObject({
    q: "forest",
    page: 1,
    sort: "newest",
  });
  expect(root.querySelector(".resource-search")).not.toBeNull();
});
it("clears selections when changing pages", async () => {
  await mount();
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((b) => b.textContent?.trim() === "管理")!
    .click();
  await flush();
  root.querySelector<HTMLInputElement>(".resource-check")!.click();
  await flush();
  expect(root.textContent).toContain("已選 1");
  root.querySelector<HTMLButtonElement>("[data-next]")!.click();
  await flush();
  expect(root.querySelector<HTMLInputElement>(".resource-check")?.checked).toBe(
    false,
  );
});
it("does not show an empty library or zero capacity when authorization expires", async () => {
  mocks.token.mockResolvedValueOnce(null as any);
  await mount();
  expect(root.textContent).toContain("重新連結");
  expect(root.textContent).toContain("尚未取得");
  expect(mocks.list).not.toHaveBeenCalled();
  expect(root.querySelector(".resource-content .empty")).toBeNull();
});
it("retries only failed upload entries", async () => {
  await mount();
  mocks.upload
    .mockResolvedValueOnce("ok")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce("ok");
  const input = root.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", {
    value: [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ],
  });
  input.dispatchEvent(new Event("change"));
  await flush();
  expect(mocks.upload).toHaveBeenCalledTimes(2);
  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((b) => b.textContent?.trim() === "重試失敗檔案")!
    .click();
  await flush();
  expect(mocks.upload).toHaveBeenCalledTimes(3);
  expect(mocks.upload.mock.calls[2][0].name).toBe("b.png");
});

it("uploads a thousand directory files with authored paths after one overwrite confirmation", async () => {
  mocks.list.mockImplementation(async () => ({ ...page(), libraryPrefix:"https://assets.test/u/author", capabilities:{...page().capabilities,overwrite:true,relativePaths:true} }));
  mocks.upload.mockResolvedValue("ok");
  await mount();
  const input=root.querySelector<HTMLInputElement>("input[webkitdirectory]")!;
  expect(input).not.toBeNull();
  const files=Array.from({length:1000},(_,i)=>{
    const file=new File(["x"],`image-${i%100}.png`,{type:"image/png"});
    Object.defineProperty(file,"webkitRelativePath",{value:`my-card/scene-${Math.floor(i/100)}/${file.name}`});
    return file;
  });
  Object.defineProperty(input,"files",{value:files});
  input.dispatchEvent(new Event("change"));
  await flush();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(confirmState.current?.danger).toBe(true);
  settleConfirm(true);
  await flush();
  expect(mocks.upload).toHaveBeenCalledTimes(1000);
  expect(mocks.upload.mock.calls[999][0].webkitRelativePath).toBe("my-card/scene-9/image-99.png");
  expect(root.textContent).toContain("my-card/scene-9/image-99.png");
  expect(root.querySelectorAll(".upload-list li").length).toBeGreaterThan(0);
  expect(root.querySelectorAll(".upload-list li").length).toBeLessThanOrEqual(24);
}, 30_000);
