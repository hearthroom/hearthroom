import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { i18n, loadLocale } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";
import { setProvider } from "../src/lib/provider";
import { ApiError } from "../src/lib/api";
import { rememberRecipe } from "../src/lib/studio";
import StudioPage from "../src/pages/StudioPage.vue";

// 生圖頁：生成的圖先進快取區（Harbor 的生成紀錄），挑了、取了名字才存進資源庫或下載；技能、參數、參考圖都在輸入框。
const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  connect: vi.fn(),
  models: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  wait: vi.fn(),
  save: vi.fn(),
  folders: vi.fn(),
  upload: vi.fn(),
  plan: vi.fn(),
  canPlan: vi.fn(),
}));
vi.mock("../src/lib/connections", () => ({ accountToken: mocks.token, connectAccount: mocks.connect }));
vi.mock("../src/lib/media-generation", () => ({
  generationClient: () => ({ models: mocks.models, list: mocks.list, create: mocks.create, wait: mocks.wait, save: mocks.save, plan: mocks.plan, canPlan: mocks.canPlan }),
}));
vi.mock("../src/lib/api", async (actual) => ({ ...(await actual<object>()), fetchLibraryFolders: mocks.folders, uploadImage: mocks.upload }));
vi.mock("../src/lib/track", () => ({ track: () => {} }));

const models = [
  { id: "dawn", name: "GPT Image 2", laneName: "Dawn", credits: 35, priced: 1, sizes: ["1024x1024", "1024x1536", "1536x1024"], maxImages: 2, maxReferences: 0 },
  { id: "refs", name: "GPT Image 2", credits: 52, priced: 1, sizes: ["1024x1024", "1024x1536"], maxImages: 4, maxReferences: 4 },
];
const done = (id: string, n = 1, extra = {}) => ({
  id, status: "completed", model: "dawn", size: "1024x1536", credits: 35 * n, createdAt: 1_800_000_000, expiresAt: Math.floor(Date.now() / 1000) + 6 * 86400,
  urls: Array.from({ length: n }, (_, i) => `https://assets.test/media-gen/${id}/${i}.png`), saved: Array(n).fill(""), ...extra,
});

let app: ReturnType<typeof createApp>;
let root: HTMLElement;
afterEach(() => {
  app?.unmount();
  root?.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});
const settle = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
  await nextTick();
};
async function mount(path = "/studio", withModels = true) {
  setProvider("harbor");
  await loadLocale("en");
  i18n.global.locale.value = "en";
  mocks.token.mockResolvedValue("token-harbor");
  mocks.connect.mockResolvedValue(undefined);
  if (withModels) mocks.models.mockResolvedValue(models);
  if (!mocks.canPlan.getMockImplementation()) mocks.canPlan.mockResolvedValue(false);
  mocks.folders.mockResolvedValue([{ folderId: "f1", name: "Mira", imageCount: 2 }]);
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSession();
  session.me = { accountNumId: 7, nickName: "Fixture", avatar: "" };
  session.profile = { identities: [{ provider: "harbor", externalId: 7 }] } as never;
  session.ensureProfile = async () => {};
  session.accessToken = async () => "tok";
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/studio", component: StudioPage }] });
  await router.push(path);
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(StudioPage).use(pinia).use(router).use(i18n);
  app.mount(root);
  await settle();
}
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
async function type(text: string) {
  const area = root.querySelector<HTMLTextAreaElement>(".composer__input")!;
  area.value = text;
  area.dispatchEvent(new Event("input"));
  await settle();
}
async function generate() {
  root.querySelector<HTMLFormElement>(".composer")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
}

it("shows recent generations newest first, with the description this device remembers", async () => {
  rememberRecipe("t1", { prompt: "a girl under a red umbrella" });
  mocks.list.mockResolvedValue([done("t2", 2), done("t1")]);
  await mount();
  const runs = [...root.querySelectorAll(".run")];
  expect(runs).toHaveLength(2);
  expect(runs[0]!.querySelectorAll(".shot img")).toHaveLength(2);
  expect(runs[1]!.textContent).toContain("a girl under a red umbrella");
  expect(runs[1]!.textContent).toContain("Cleared in 6 day(s)");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("explains the empty cache instead of showing nothing", async () => {
  mocks.list.mockResolvedValue([]);
  await mount();
  expect(root.textContent).toContain("No images yet");
});

it("generates with a skill and the chosen ratio, and leaves the result in the cache unsaved", async () => {
  mocks.list.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "t9", status: "queued", urls: [], saved: [] });
  mocks.wait.mockImplementation(async (t: { id: string }) => done(t.id));
  await mount();
  // 打「/」叫出技能，選「角色立繪」：預選直圖
  await type("/port");
  const skill = [...root.querySelectorAll<HTMLButtonElement>(".pop__row")].find((b) => b.textContent?.includes("Character portrait"))!;
  skill.click();
  await settle();
  expect(root.querySelector(".composer__skill")?.textContent).toContain("Character portrait");
  await type("silver hair, navy coat");
  expect(button(root, "Generate · 35 credits")).toBeTruthy();
  await generate();
  expect(mocks.create).toHaveBeenCalledWith(
    { model: "dawn", prompt: `${i18n.global.t("studio.skill.portrait.prompt")}\nsilver hair, navy coat`, size: "1024x1536", n: 1, images: [] },
    expect.any(String),
  );
  const run = root.querySelector(".run")!;
  expect(run.querySelector(".shot img")?.getAttribute("src")).toBe("https://assets.test/media-gen/t9/0.png");
  expect(run.textContent).toContain("silver hair, navy coat");
  expect(mocks.save).not.toHaveBeenCalled();
});

it("saves a picked image into a library folder under the author's name, and asks again when the name is taken", async () => {
  rememberRecipe("t1", { prompt: "Mira on the cliff" });
  mocks.list.mockResolvedValue([done("t1", 2)]);
  mocks.save.mockRejectedValueOnce(new ApiError(409, "taken", "name_taken")).mockResolvedValueOnce([{ index: 1, assetId: "a2", url: "https://assets.test/Mira/hero-2.png" }]);
  await mount("/studio?dir=Mira");
  const second = root.querySelectorAll(".shot")[1]!;
  button(second, "Save to library")!.click();
  await settle();
  const dialog = document.querySelector<HTMLFormElement>('[aria-labelledby="studio-save-title"]')!;
  const name = dialog.querySelector<HTMLInputElement>("input")!;
  expect(name.value).toBe("Mira on the cliff-2");
  expect(dialog.querySelector<HTMLSelectElement>("select")!.value).toBe("Mira");
  name.value = "hero";
  name.dispatchEvent(new Event("input"));
  dialog.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  expect(mocks.save).toHaveBeenLastCalledWith("t1", { directory: "Mira" }, [{ index: 1, name: "hero" }]);
  expect(dialog.textContent).toContain("already has a file with that name");
  name.value = "hero-2";
  name.dispatchEvent(new Event("input"));
  dialog.dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  expect(document.querySelector('[aria-labelledby="studio-save-title"]')).toBeNull();
  expect(root.querySelectorAll(".shot")[1]!.querySelector(".shot__badge")?.textContent).toBe("In your library");
  expect(root.querySelectorAll(".shot")[0]!.querySelector(".shot__badge")).toBeNull();
  expect(root.textContent).toContain("hero-2.png is now in “Mira”");
});

it("downloads a picked image under the name the author typed", async () => {
  mocks.list.mockResolvedValue([done("t1")]);
  const fetcher = vi.fn(async () => new Response(new Blob(["png"]), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  const clicked: string[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  });
  try {
    await mount();
    button(root.querySelector(".shot")!, "Download")!.click();
    await settle();
    const dialog = document.querySelector<HTMLFormElement>('[aria-labelledby="studio-save-title"]')!;
    expect(dialog.querySelector("select")).toBeNull();
    const name = dialog.querySelector<HTMLInputElement>("input")!;
    name.value = "cliff";
    name.dispatchEvent(new Event("input"));
    dialog.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(fetcher).toHaveBeenCalledWith("https://assets.test/media-gen/t1/0.png", { mode: "cors" });
    expect(clicked).toEqual(["cliff.png"]);
    expect(mocks.save).not.toHaveBeenCalled();
  } finally {
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("uses a cached result as the reference, switching to a model that takes references", async () => {
  mocks.list.mockResolvedValue([done("t1")]);
  mocks.create.mockResolvedValue(done("t2"));
  await mount();
  button(root.querySelector(".shot")!, "Use as reference")!.click();
  await settle();
  expect(root.querySelector<HTMLImageElement>(".composer__ref img")!.getAttribute("src")).toBe("https://assets.test/media-gen/t1/0.png");
  await type("same girl, full body");
  await generate();
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ model: "refs", images: ["https://assets.test/media-gen/t1/0.png"] }), expect.any(String));
});

it("starts with the library image the resources page handed over as the reference", async () => {
  mocks.list.mockResolvedValue([]);
  await mount("/studio?ref=https%3A%2F%2Fassets.test%2Fu%2F7%2Fportrait.png");
  expect(root.querySelector<HTMLImageElement>(".composer__ref img")!.getAttribute("src")).toBe("https://assets.test/u/7/portrait.png");
});

it("explains a credit shortfall with a way to top up, and keeps the order key only for a dropped connection", async () => {
  mocks.list.mockResolvedValue([]);
  mocks.create.mockRejectedValueOnce(new ApiError(402, "no credits")).mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(done("t3"));
  await mount();
  await type("a lighthouse");
  await generate();
  expect(root.querySelector(".run__error")?.textContent).toContain("don’t have enough purchased credits");
  expect(root.querySelector(".run__error a")?.textContent).toContain("Top up");
  await generate();
  const dropped = root.querySelectorAll(".run")[0]!;
  expect(dropped.textContent).toContain("connection dropped");
  const firstKey = mocks.create.mock.calls[1]![1];
  button(dropped, "Continue")!.click();
  await settle();
  expect(mocks.create.mock.calls[2]![1]).toBe(firstKey);
  expect(mocks.create.mock.calls[0]![1]).not.toBe(firstKey);
  expect(root.querySelectorAll(".run")[0]!.querySelector(".shot img")).not.toBeNull();
});

it("asks for a fresh sign-in when this sign-in lacks the generation permission", async () => {
  mocks.models.mockRejectedValue(new ApiError(403, "forbidden", "permission_error"));
  await mount("/studio", false);
  expect(root.textContent).toContain("sign in again and allow this site to generate images");
  button(root, "Sign in and allow")!.click();
  await settle();
  expect(mocks.connect).toHaveBeenCalledWith("harbor", "/studio");
});

// Agent 模式：想法排成計畫、作者改過才生成；第一組先畫，「同一個角色」的幾組拿它的第一張當參考圖。
it("plans a set from one idea, lets the author edit it, and draws the followers from the first result", async () => {
  mocks.canPlan.mockResolvedValue(true);
  mocks.list.mockResolvedValue([]);
  mocks.plan.mockResolvedValue({ summary: "A card kit for Mira", credits: 3, shots: [
    { title: "Portrait", skill: "portrait", prompt: "Mira, silver hair, navy coat, full body", shape: "tall", count: 1, reference: "none" },
    { title: "Lighthouse", skill: "scene", prompt: "a lighthouse at dusk, no people", shape: "wide", count: 1, reference: "none" },
    { title: "Faces", skill: "expressions", prompt: "Mira, four expressions", shape: "square", count: 4, reference: "anchor" },
    { title: "Extra", skill: "", prompt: "something unwanted", shape: "square", count: 1, reference: "none" },
  ] });
  const order: string[] = [];
  mocks.create.mockImplementation(async (input: { prompt: string }) => {
    order.push(input.prompt);
    return done(`t${order.length}`);
  });
  await mount();
  const mode = [...root.querySelectorAll<HTMLButtonElement>(".pill")].find((b) => b.textContent?.trim() === "Generate")!;
  mode.click();
  await settle();
  [...root.querySelectorAll<HTMLButtonElement>(".pop__row")].find((b) => b.textContent?.includes("Agent mode"))!.click();
  await settle();
  await type("a card kit for Mira");
  expect(button(root, "Make a plan")).toBeTruthy();
  await generate();
  expect(mocks.plan).toHaveBeenCalledWith({ idea: "a card kit for Mira", language: "en", hasReference: false, maxImages: 2 });
  expect(mocks.create).not.toHaveBeenCalled();
  const plan = root.querySelector(".plan")!;
  expect(plan.textContent).toContain("A card kit for Mira");
  expect(plan.textContent).toContain("This plan cost 3 credits to write.");
  // 刪掉不要的一組，改第一組的描述
  plan.querySelector<HTMLButtonElement>('button[aria-label="Remove shot 4"]')!.click();
  await settle();
  const prompt = plan.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description of shot 1"]')!;
  prompt.value = "Mira, silver hair, red scarf, full body";
  prompt.dispatchEvent(new Event("input"));
  await settle();
  // dawn 35 × 1 + 35 × 1；表情要參考圖，換成收參考圖的 refs，52 × 4
  button(plan, "Generate all · about 278 credits")!.click();
  await settle();
  await settle();
  expect(mocks.create).toHaveBeenCalledTimes(3);
  expect(mocks.create.mock.calls[0]![0]).toEqual({ model: "dawn", prompt: "Mira, silver hair, red scarf, full body", size: "1024x1536", n: 1, images: [] });
  expect(mocks.create.mock.calls[1]![0]).toEqual({ model: "dawn", prompt: "a lighthouse at dusk, no people", size: "1536x1024", n: 1, images: [] });
  expect(mocks.create.mock.calls[2]![0]).toEqual({ model: "refs", prompt: "Mira, four expressions", size: "1024x1024", n: 4, images: ["https://assets.test/media-gen/t1/0.png"] });
  expect(root.querySelector(".plan")!.textContent).toContain("Every shot is sent");
  expect(root.querySelectorAll(".run")).toHaveLength(3);
});

it("says so when the plan comes back unusable, and hides agent mode where the server has none", async () => {
  mocks.canPlan.mockResolvedValue(true);
  mocks.list.mockResolvedValue([]);
  mocks.plan.mockRejectedValue(new ApiError(502, "unusable", "plan_unreadable"));
  await mount();
  [...root.querySelectorAll<HTMLButtonElement>(".pill")].find((b) => b.textContent?.trim() === "Generate")!.click();
  await settle();
  [...root.querySelectorAll<HTMLButtonElement>(".pop__row")].find((b) => b.textContent?.includes("Agent mode"))!.click();
  await settle();
  await type("something");
  await generate();
  expect(root.textContent).toContain("The plan came back unusable");
  expect(root.querySelector(".plan")).toBeNull();
  app.unmount();
  root.remove();
  mocks.canPlan.mockResolvedValue(false);
  await mount();
  expect([...root.querySelectorAll(".pill")].some((b) => b.textContent?.trim() === "Generate")).toBe(false);
});
