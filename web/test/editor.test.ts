/**
 * 建卡編輯器的整條路：匯入一張酒館卡 → 建立並儲存 → 改一個欄位再存。
 *
 * 上游 API 全部換成假的，看的是「送出去的請求對不對」：建卡、寫欄位、寫開場白、建世界書並綁定，
 * 順序與內容都要對；第二次儲存只能送改過的那一欄。這一層在瀏覽器裡沒辦法自動跑
 * （建卡頁在 OAuth 後面），所以在這裡把整個元件掛起來測。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { embedIntoPng, parseTavernFile, type TavernCard } from "../src/lib/tavern";
import { writeChunks } from "../src/lib/png-chunks";
import CardEditorPage from "../src/pages/CardEditorPage.vue";
import { confirmState, settleConfirm } from "../src/lib/confirm";

const platforms = vi.hoisted(()=>({profile:undefined as any, saveCopies:vi.fn(async()=>[] as any[])}));
vi.mock("../src/lib/authoring-platforms",()=>({saveCopies:platforms.saveCopies,savedDistributionTargets:async()=>[]}));
const api = vi.hoisted(() => ({
  registerCardIdentity: vi.fn(async () => ({id:"100021",num:100021,provider:"harbor",sourceRoleId:"r1"})),
  fetchCard: vi.fn(async () => ({id:"100021",num:100021,provider:"harbor",sourceRoleId:"r1",roleId:"frozen-r1"})),
  createRole: vi.fn(async () => ({ roleId: "r1" })),
  patchRoleDocument: vi.fn(async () => ({})),
  patchRoleWelcome: vi.fn(async () => ({})),
  unpublishRole: vi.fn(async () => ({})),
  createWorldbook: vi.fn(async () => "wb1"),
  patchWorldbookDocument: vi.fn(async () => ({})),
  reorderWorldbookEntries: vi.fn(async () => {}),
  unbindWorldbook: vi.fn(async () => {}),
  findWorldbookByName: vi.fn(async (): Promise<{ worldbookId: string; name: string; description: string; entryCount: number } | null> => null),
  deleteWorldbook: vi.fn(async () => {}),
  fetchWorldbookEntries: vi.fn(async () => [
    { entryId: "e1", name: "黑麥鎮", content: "北境小鎮。", keywords: ["黑麥鎮"], secondaryKeywords: [], isEnabled: true, isConstant: true, category: "location" },
    { entryId: "e2", name: "採石場", content: "廢棄了。", keywords: ["採石場"], secondaryKeywords: ["排水渠"], isEnabled: true, isConstant: false },
  ]),
  fetchRoleValidation: vi.fn(async () => ({ status: "ok", blockers: [], warnings: [] })),
  fetchRoleDetail: vi.fn(async () => ({})),
  fetchRoleWorldbooks: vi.fn(async () => [{ worldbookId: "wb-bound", name: "北境設定", description: "", entryCount: 2 }]),
  fetchMyWorldbooks: vi.fn(async () => [
    { worldbookId: "wb9", name: "北境設定", description: "舊描述", entryCount: 2, iconUrl: "https://img.test/wb.png", visibility: "private", tags: "北境,懸疑" },
  ]),
  submitRoleForReview: vi.fn(async () => ({})),
  registerCard: vi.fn(async () => ({status:'pending'})),
  beginCardEdit: vi.fn(async ():Promise<{resubmit:boolean;nsfw?:boolean}> => ({resubmit:false})),
  deleteRole: vi.fn(async () => {}),
  unregisterCard: vi.fn(async () => {}),
  uploadImage: vi.fn(async () => "https://img.test/avatar.png"),
  fetchAuthorAsset: vi.fn(async () => ({ rules: [], mountTrigger: "", mountLayer: "", pageMode: "classic", status: "none", version: 0 })),
  saveAuthorAsset: vi.fn(async (_roleId: string, body: { version: number }) => ({ ...body, status: "passed", version: body.version + 1 })),
}));
vi.mock("../src/lib/api", () => api);
vi.mock("../src/lib/session", () => ({
  useSession: () => ({ profile:platforms.profile, accessToken: async () => "tok", me: { accountNumId: 7, nickName: "作者", avatar: "" } }),
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "create", setSurface: () => {} }));

/** 一張帶了所有東西的 V2 卡：三段人設、備選開場白、對話示例、世界書（含次要關鍵詞）、太多標籤。 */
const CARD: TavernCard = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "阿芙拉",
    description: "金麥穗酒館的老闆娘。",
    personality: "嘴硬心軟。",
    scenario: "北境邊鎮，商隊失蹤的那一週。",
    first_mes: "*她把杯子倒扣在木架上。*「北境每天都有遲到的車隊。」",
    alternate_greetings: ["雷雨夜，酒館只剩你一個客人。"],
    mes_example: "<START>\n{{user}}: 我聽說有支商隊沒到。\n{{char}}: 「當它是雨聲。」",
    creator_notes: "一張慢熱的懸疑卡。",
    system_prompt: "回覆用第三人稱。",
    post_history_instructions: "不要替玩家做決定。",
    tags: Array.from({ length: 12 }, (_, i) => `標籤${i + 1}`),
    creator: "someone",
    character_book: {
      name: "黑麥鎮",
      entries: [
        { keys: ["黑麥鎮"], content: "北境小鎮。", constant: true, enabled: true },
        { keys: ["採石場"], secondary_keys: ["排水渠"], content: "廢棄了。", comment: "採石場" },
      ],
    },
    extensions: { regex_scripts: [{ id: 1, scriptName: "status", findRegex: "/<status>([\\s\\S]*?)<\\/status>/g", replaceString: "<div class=\"hp\">$1</div>" }] },
  },
};

let app: App | null = null;
let router: Router;
let root: HTMLElement;

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

async function mount(path: string) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/create", component: CardEditorPage },
      { path: "/cards/:roleId/edit", component: CardEditorPage },
      { path: "/mine", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp({ template: "<RouterView />" }).use(createPinia()).use(i18n).use(router);
  app.mount(root);
  await flush();
}

const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
// 條目彈窗 Teleport 到 body，不在掛載的 root 裡面
const $d = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const btnIn = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
/** 打開條目彈窗；沒開過就先按「管理條目」。 */
async function openEntries() {
  if (!document.querySelector(".wbd")) {
    btnIn(root, "管理條目").click();
    await flush();
  }
}
/** 選中左邊清單的第 n 條。 */
async function pickEntry(n: number) {
  document.querySelectorAll<HTMLButtonElement>(".wbd__row-name")[n].click();
  await flush();
}
// 導覽鈕的文字之外還可能帶條數徽章（世界書 12），只比標籤那一段
const byText = (text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.querySelector(".side__label") ?? b).textContent?.trim() === text,
  )!;

async function pickFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await flush();
}

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event("input"));
  await flush();
}

async function submit() {
  $("form").dispatchEvent(new Event("submit", { cancelable: true }));
  await flush();
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  platforms.profile=undefined; platforms.saveCopies.mockClear();
  for (const fn of Object.values(api)) fn.mockClear();
  // happy-dom 沒有 object URL；預覽用的立繪縮圖走這條
  if (!("createObjectURL" in URL)) {
    Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });
  }
});
afterEach(() => {
  app?.unmount();
  document.querySelectorAll(".wbd").forEach((el) => el.remove());
  app = null;
  root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("卡片匯出", () => {
  function captureDownload() {
    const blobs: Blob[] = [];
    const filenames: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:export-test";
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      filenames.push(this.download);
    });
    return { blobs, filenames };
  }

  it("PNG 匯出使用直式背景，忽略舊的獨立頭像", async () => {
    const avatar = "https://assets.harbor.ai/u/test/avatar.png";
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Export test", roleAvatar: "https://assets.harbor.ai/old.png", roleBackground: avatar, roleDetailDesc: "Synthetic settings" });
    await mount("/cards/r1/edit");
    const { blobs, filenames } = captureDownload();
    const png = writeChunks([{ type: "IHDR", data: new Uint8Array(13) }, { type: "IEND", data: new Uint8Array() }]);
    const fetchSpy = vi.fn(async () => new Response(png));
    vi.stubGlobal("fetch", fetchSpy);
    byText("匯出 PNG").click();
    await flush();
    expect(fetchSpy).toHaveBeenCalledWith(`/v1/image?u=${encodeURIComponent(avatar)}`);
    expect(filenames).toEqual(["Export test.png"]);
    const imported = await parseTavernFile(new File([blobs[0]], filenames[0], { type: "image/png" }));
    expect(imported.card.data.name).toBe("Export test");
    expect(imported.card.data.description).toContain("Synthetic settings");
    expect(root.textContent).not.toContain(i18n.global.t("export.pngFallback"));
  });

  it("圖片讀取失敗會下載 JSON 並說明 PNG 匯出失敗", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Export test", roleAvatar: "https://assets.harbor.ai/u/test/avatar.png" });
    await mount("/cards/r1/edit");
    const { blobs, filenames } = captureDownload();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    byText("匯出 PNG").click();
    await flush();
    expect(filenames).toEqual(["Export test.json"]);
    expect(JSON.parse(await blobs[0].text()).data.name).toBe("Export test");
    expect(root.textContent).toContain(i18n.global.t("export.pngFallback"));
    expect(root.textContent).not.toContain("拿不到頭像");
  });

  it("沒有頭像也能直接匯出 JSON，且不發出圖片請求", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Export test" });
    await mount("/cards/r1/edit");
    const { blobs, filenames } = captureDownload();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    byText("匯出 JSON").click();
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(filenames).toEqual(["Export test.json"]);
    expect(JSON.parse(await blobs[0].text()).data.name).toBe("Export test");
    expect(root.textContent).not.toContain(i18n.global.t("export.pngFallback"));
  });
});

describe("匯入酒館卡 → 建立 → 編輯", () => {
  it("只保留直式與橫式圖片，直式 GIF 原樣上傳且不改橫圖", async () => {
    const avatar = "https://assets.harbor.ai/u/test/new.gif";
    const background = "https://assets.harbor.ai/u/test/background.png";
    const landscape = "https://assets.harbor.ai/u/test/landscape.png";
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Avatar test", roleAvatar: "https://assets.harbor.ai/u/test/old.png", roleBackground: background, roleBackgroundLandscape: landscape });
    api.uploadImage.mockResolvedValueOnce(avatar);
    await mount("/cards/r1/edit");
    const field = [...root.querySelectorAll(".field")].find((el) => el.querySelector("label")?.textContent === i18n.global.t("editor.background"))!;
    expect(root.querySelectorAll(".frame")).toHaveLength(2);
    const file = new File(["GIF89a synthetic animation bytes"], "new.gif", { type: "image/gif" });
    await pickFile(field.querySelector("input[type=file]")!, file);
    expect(api.uploadImage).toHaveBeenCalledWith(file, "tok", "r1");
    expect(field.querySelector("img")?.getAttribute("src")).toBe(avatar);
    expect(root.querySelector(`img[src="${background}"]`)).toBeNull();
    expect(root.querySelector(`img[src="${landscape}"]`)).not.toBeNull();
    await submit();
    expect(api.patchRoleDocument).toHaveBeenCalledWith("r1", { roleBackground: avatar, roleAvatar: avatar }, "tok");
  });

  it("匯入把每一區都填好，儲存照順序打四個端點，內容對得上", async () => {
    await mount("/create");
    await pickFile($("input[type=file]"), new File([JSON.stringify(CARD)], "avra.json", { type: "application/json" }));

    // 報告：標籤多了兩個、正則腳本一條
    const report = root.textContent ?? "";
    expect(report).toContain("讀到了：阿芙拉");
    expect(report).toContain("多出來的 2 個標籤");
    // 正則腳本不再是「沒能帶過來」：套用後變成這張卡的規則，對話區的按鈕上會帶著數量
    expect(report).not.toContain("正則腳本");
    // 原作者署名現在有落點（V3 的 creator），不再進報告，套用後出現在署名那一格
    expect(report).not.toContain("someone");

    byText("套用到表單").click();
    await flush();

    expect($<HTMLInputElement>("#f-name").value).toBe("阿芙拉");
    expect($<HTMLInputElement>("#f-creator").value).toBe("someone");
    expect($<HTMLTextAreaElement>("#f-desc").value).toBe("一張慢熱的懸疑卡。");
    expect($<HTMLTextAreaElement>("#f-detail").value).toBe("金麥穗酒館的老闆娘。\n\n【性格】\n嘴硬心軟。\n\n【場景】\n北境邊鎮，商隊失蹤的那一週。");
    expect($<HTMLTextAreaElement>("#f-welcome").value).toContain("北境每天都有遲到的車隊");
    expect($<HTMLTextAreaElement>("#f-contract").value).toBe("回覆用第三人稱。");
    expect($<HTMLTextAreaElement>("#f-jb").value).toBe("不要替玩家做決定。");
    expect($<HTMLInputElement>("#f-tags").value.split("、")).toHaveLength(10);
    const regexButton = [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(i18n.global.t("regex.open")))!;
    expect(regexButton.querySelector(".chip")?.textContent?.trim()).toBe("1");
    // 左欄：三個必填都有了，不該再有紅點
    expect(root.querySelectorAll(".side__dot")).toHaveLength(0);
    // 右欄不再是卡片預覽（它既不是對話測試也不是發布）：換成對話測試與我的資源兩塊面板
    expect(root.querySelector(".rail__tile")).toBeNull();
    expect($(".rail__tabs").textContent).toContain("對話測試");
    // 還沒存過的卡沒有東西可以聊，面板要說清楚而不是給一個空的 iframe
    expect(root.querySelector(".ct__frame")).toBeNull();
    expect($(".ct__state").textContent).toContain("先存一次");

    await submit();

    expect(api.createRole).toHaveBeenCalledWith({ roleName: "阿芙拉", language: "zh-Hant" }, "tok");
    const [, fields] = api.patchRoleDocument.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fields).toMatchObject({
      roleName: "阿芙拉",
      roleDesc: "一張慢熱的懸疑卡。",
      roleOutputContract: "回覆用第三人稱。",
      jailbreak: "不要替玩家做決定。",
      cardMeta: { creator: "someone" },
      talkExample: [
        { roleType: "user", content: "我聽說有支商隊沒到。" },
        { roleType: "ai", content: "「當它是雨聲。」" },
      ],
    });
    expect((fields.roleTag as string[]).length).toBe(10);
    expect(api.patchRoleWelcome).toHaveBeenCalledWith(
      "r1",
      { roleWelcome: CARD.data.first_mes, alternates: ["雷雨夜，酒館只剩你一個客人。"], prologue: [] },
      "tok",
    );
    expect(api.createWorldbook).toHaveBeenCalledWith({ name: "黑麥鎮", language: "zh-Hant", format: "tavern" }, "tok");
    const [bookId, doc] = api.patchWorldbookDocument.mock.calls[0] as unknown as [string, { entries: unknown[]; binding?: unknown }];
    expect(bookId).toBe("wb1");
    expect(doc.binding).toEqual({ roleId: "r1" });
    expect(doc.entries).toEqual([
      { op: "create", name: "黑麥鎮", content: "北境小鎮。", keywords: ["黑麥鎮"], secondaryKeywords: [], isEnabled: true, isConstant: true, matchOptions: { caseSensitive: false, matchWholeWords: false, selectiveLogic: 0 } },
      // 酒館的 secondary_keys 直接落到條目的 AND 門，不再併進 keywords
      { op: "create", name: "採石場", content: "廢棄了。", keywords: ["採石場"], secondaryKeywords: ["排水渠"], isEnabled: true, isConstant: false, matchOptions: { caseSensitive: false, matchWholeWords: false, selectiveLogic: 0 } },
    ]);
    // 卡片存完才存正則：匯入帶進來的那條規則，帶著版本 0 整份送到上游的作者資產
    expect(api.saveAuthorAsset).toHaveBeenCalledTimes(1);
    const [regexRole, asset] = api.saveAuthorAsset.mock.calls[0] as unknown as [string, { rules: { name: string; find: string }[]; version: number; mountLayer: string; mountTrigger: string }];
    expect(regexRole).toBe("r1");
    expect(asset.version).toBe(0);
    expect(asset.mountLayer).toBe("over");
    expect(asset.rules.map((r) => r.name)).toEqual(["status"]);
    // 建立完成 → 網址換成編輯頁，本機草稿清掉
    expect(window.location.pathname).toBe("/cards/100021/edit");
    expect(localStorage.getItem("hearthroom.draft.create")).toBeNull();

    // 第二次儲存：只改簡介，就只送簡介；開場白與世界書一個請求都不該再發
    await type($("#f-desc"), "改過的簡介");
    await submit();
    expect(api.patchRoleDocument).toHaveBeenCalledTimes(2);
    expect(api.patchRoleDocument.mock.calls[1][1]).toEqual({ roleDesc: "改過的簡介" });
    expect(api.patchRoleWelcome).toHaveBeenCalledTimes(1);
    expect(api.patchWorldbookDocument).toHaveBeenCalledTimes(1);
    expect(api.saveAuthorAsset).toHaveBeenCalledTimes(1);
  });

  it("改世界書條目再存：只送那一條的 update，刪掉的送 delete", async () => {
    await mount("/create");
    await pickFile($("input[type=file]"), new File([JSON.stringify(CARD)], "avra.json"));
    byText("套用到表單").click();
    await flush();
    await submit();
    // 存完之後條目帶著上游給的 id（fetchWorldbookEntries 的假回應）
    byText("世界書").click();
    await flush();
    await openEntries();
    expect(document.querySelectorAll(".wbd__row")).toHaveLength(2);
    await pickEntry(0);
    await type($d<HTMLTextAreaElement>("#wbd-content"), "北境小鎮，三條商路交會。");
    // 第二條刪掉（已存在的條目會先問一聲：這裡直接走確認）
    const { settleConfirm } = await import("../src/lib/confirm");
    document.querySelectorAll<HTMLButtonElement>(".wbd button[aria-label='刪除條目']")[1].click();
    await flush();
    settleConfirm(true);
    await flush();
    await submit();
    const [, doc] = api.patchWorldbookDocument.mock.calls[1] as unknown as [string, { entries: unknown[]; binding?: unknown }];
    expect(doc.binding).toBeUndefined();
    expect(doc.entries).toEqual([
      { op: "delete", entryId: "e2" },
      { op: "update", entryId: "e1", name: "黑麥鎮", content: "北境小鎮，三條商路交會。", keywords: ["黑麥鎮"], secondaryKeywords: [], isEnabled: true, isConstant: true, category: "location" },
    ]);
  });

  it("條目超過上限：送出前就攔下並點名那一條，一個請求都不打", async () => {
    await mount("/create");
    await pickFile($("input[type=file]"), new File([JSON.stringify(CARD)], "avra.json"));
    byText("套用到表單").click();
    await flush();
    byText("世界書").click();
    await flush();
    await openEntries();
    await pickEntry(0);
    await type($d<HTMLTextAreaElement>("#wbd-content"), "字".repeat(3001));
    btnIn($d(".wbd"), "編好了").click();
    await flush();
    await submit();
    expect($("[role=alert]").textContent).toContain("黑麥鎮");
    expect($("[role=alert]").textContent).toContain("3000");
    expect(api.createRole).not.toHaveBeenCalled();
    expect(api.patchWorldbookDocument).not.toHaveBeenCalled();
  });

  it("PNG 卡：自帶的立繪上傳後當直式背景", async () => {
    await mount("/create");
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, 1);
    new DataView(ihdr.buffer).setUint32(4, 1);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const png = embedIntoPng(writeChunks([{ type: "IHDR", data: ihdr }, { type: "IEND", data: new Uint8Array(0) }]), CARD);
    await pickFile($("input[type=file]"), new File([png as BlobPart], "avra.png", { type: "image/png" }));
    expect(root.textContent).toContain("自帶立繪 1 張");
    byText("套用到表單").click();
    await flush();
    await flush();
    expect(api.uploadImage).toHaveBeenCalledTimes(1);
    expect((api.uploadImage.mock.calls[0] as unknown as [File])[0].name).toBe("card.png");
    // 直式背景就在「基本」分區、名稱底下，不用切分區
    await flush();
    expect(root.querySelector("img[src='https://img.test/avatar.png']")).not.toBeNull();
  });

  it("世界書檔匯入：沒綁書、也沒有同名的書就順手建", async () => {
    await mount("/create");
    await type($("#f-name"), "測試");
    byText("世界書").click();
    await flush();
    const info = { entries: { "0": { key: ["eldoria"], content: "A forest.", comment: "eldoria" }, "1": { key: ["glade"], keysecondary: ["safe"], content: "A glade.", constant: true } } };
    const inputs = root.querySelectorAll<HTMLInputElement>("input[type=file]");
    await pickFile(inputs[inputs.length - 1], new File([JSON.stringify(info)], "eldoria.json"));
    expect(root.textContent).toContain("匯入了 2 條");
    await openEntries();
    expect(document.querySelectorAll(".wbd__row")).toHaveLength(2);
    // 清單那一行的摘要看得到次要關鍵詞
    expect(document.querySelectorAll(".wbd__row-keys")[1].textContent).toContain("+ safe");
    await submit();
    expect(api.createWorldbook).toHaveBeenCalledWith({ name: "測試", language: "zh-Hant" }, "tok");
  });

  it("世界書檔匯入：整本覆蓋手上這本，舊條目全刪、檔案裡的全建", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "北境", roleWelcome: "雨還在下。" });
    await mount("/cards/r1/edit");
    byText("世界書").click();
    await flush();
    api.patchWorldbookDocument.mockClear();
    const info = { entries: { "0": { key: ["eldoria"], content: "A forest.", comment: "eldoria" } } };
    const inputs = root.querySelectorAll<HTMLInputElement>("input[type=file]");
    await pickFile(inputs[inputs.length - 1], new File([JSON.stringify(info)], "eldoria.json"));
    await submit();
    const [id, doc] = api.patchWorldbookDocument.mock.calls[0] as unknown as [string, { entries: { op: string; entryId?: string }[] }];
    expect(id).toBe("wb-bound");
    expect(doc.entries.map((e) => e.op + (e.entryId ?? ""))).toEqual(["deletee1", "deletee2", "create"]);
    expect(api.createWorldbook).not.toHaveBeenCalled();
  });

  it("世界書檔匯入：作者已經有同名的一本就覆蓋那一本，不再多建一本", async () => {
    api.findWorldbookByName.mockResolvedValueOnce({ worldbookId: "wb9", name: "Eldoria", description: "", entryCount: 2 });
    await mount("/create");
    await type($("#f-name"), "測試");
    byText("世界書").click();
    await flush();
    const info = { name: "Eldoria", entries: { "0": { key: ["eldoria"], content: "A forest.", comment: "eldoria" } } };
    const inputs = root.querySelectorAll<HTMLInputElement>("input[type=file]");
    await pickFile(inputs[inputs.length - 1], new File([JSON.stringify(info)], "eldoria.json"));
    await flush();
    await submit();
    expect(api.findWorldbookByName).toHaveBeenCalledWith("tok", "Eldoria");
    expect(api.createWorldbook).not.toHaveBeenCalled();
    const [id, doc] = api.patchWorldbookDocument.mock.calls[0] as unknown as [string, { entries: { op: string }[]; binding?: unknown }];
    expect(id).toBe("wb9");
    expect(doc.entries.map((e) => e.op)).toEqual(["delete", "delete", "create"]);
    expect(doc.binding).toEqual({ roleId: "r1" });
  });

  it("書名不重複：建新書撞到自己另一本的名字就不建，告訴作者怎麼辦", async () => {
    await mount("/create");
    await type($("#f-name"), "測試");
    byText("世界書").click();
    await flush();
    byText("建一本").click();
    await flush();
    await openEntries();
    await type($d<HTMLTextAreaElement>("#wbd-content"), "北境的規矩。");
    btnIn(document.querySelector(".wbd")!, "編好了").click();
    await flush();
    api.findWorldbookByName.mockResolvedValueOnce({ worldbookId: "wb-other", name: "測試", description: "", entryCount: 3 });
    await submit();
    expect(api.createWorldbook).not.toHaveBeenCalled();
    expect(root.textContent).toContain("你已經有一本叫「測試」的世界書");
  });

  it("刪除舊世界書：在「用已經有的一本」選了就能刪；還綁著卡的不給刪", async () => {
    api.fetchMyWorldbooks.mockResolvedValue([
      { worldbookId: "wb9", name: "北境設定", description: "", entryCount: 2, visibility: "private", tags: "", usedByCards: 0 },
      { worldbookId: "wb-used", name: "在用", description: "", entryCount: 5, visibility: "private", tags: "", usedByCards: 2 },
    ] as never);
    await mount("/create");
    await type($("#f-name"), "測試");
    byText("世界書").click();
    await flush();
    const select = $<HTMLSelectElement>("#wb-reuse");
    const del = () => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "刪除")!;
    select.value = "wb-used";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(del().disabled).toBe(true);
    expect(root.textContent).toContain("這本還綁在 2 張卡上");

    select.value = "wb9";
    select.dispatchEvent(new Event("change"));
    await flush();
    del().click();
    await flush();
    const { settleConfirm } = await import("../src/lib/confirm");
    settleConfirm(true);
    await flush();
    expect(api.deleteWorldbook).toHaveBeenCalledWith("wb9", "tok");
    api.fetchMyWorldbooks.mockReset();
    api.fetchMyWorldbooks.mockImplementation(async () => [
      { worldbookId: "wb9", name: "北境設定", description: "舊描述", entryCount: 2, iconUrl: "https://img.test/wb.png", visibility: "private", tags: "北境,懸疑" },
    ] as never);
  });

  it("條目分類：選了就跟著送出去，上游讀回來的分類不會在下次儲存掉了", async () => {
    await mount("/create");
    await type($("#f-name"), "測試");
    byText("世界書").click();
    await flush();
    byText("建一本").click();
    await flush();
    await openEntries();
    await type($d<HTMLTextAreaElement>("#wbd-content"), "北境的規矩：天黑不出城。");
    const category = $d<HTMLSelectElement>("#wbd-cat");
    category.value = "rule";
    category.dispatchEvent(new Event("change"));
    await flush();
    await submit();

    const [, doc] = api.patchWorldbookDocument.mock.calls[0] as unknown as [string, { entries: { category?: string }[] }];
    expect(doc.entries[0].category).toBe("rule");
  });

  it("挑一本自己已經有的世界書：不建新書，只送一次綁定，條目不重建", async () => {
    await mount("/create");
    await type($("#f-name"), "測試");
    byText("世界書").click();
    await flush();

    const select = $<HTMLSelectElement>("#wb-reuse");
    select.value = "wb9";
    select.dispatchEvent(new Event("change"));
    await flush();
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "用這一本")!.click();
    await flush();

    // 讀回來的兩條就照原樣顯示，作者不必重打
    await openEntries();
    expect(document.querySelectorAll(".wbd__row")).toHaveLength(2);

    await submit();
    expect(api.createWorldbook).not.toHaveBeenCalled();
    // 一條都沒改，但綁定還是得送出去——只送綁定，不帶任何條目操作
    expect(api.patchWorldbookDocument).toHaveBeenCalledTimes(1);
    expect(api.patchWorldbookDocument).toHaveBeenCalledWith("wb9", { binding: { roleId: "r1" } }, "tok");
  });

  it("換一本再建新的：舊書的條目不會被當成要刪的送進新書", async () => {
    await mount("/create");
    await pickFile($("input[type=file]"), new File([JSON.stringify(CARD)], "avra.json"));
    byText("套用到表單").click();
    await flush();
    await submit();
    api.patchWorldbookDocument.mockClear();

    byText("世界書").click();
    await flush();
    const { settleConfirm } = await import("../src/lib/confirm");
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "換一本")!.click();
    await flush();
    settleConfirm(true);
    await flush();

    // 換掉之後從頭建一本：舊書那兩條的 id 不能跟著跑進新書的差分
    api.createWorldbook.mockResolvedValueOnce("wb2");
    byText("建一本").click();
    await flush();
    await openEntries();
    await type($d<HTMLTextAreaElement>("#wbd-content"), "新的一條。");
    btnIn(document.querySelector(".wbd")!, "編好了").click();
    await flush();
    await submit();

    expect(api.createWorldbook).toHaveBeenCalledTimes(2);
    const [, doc] = api.patchWorldbookDocument.mock.calls[0] as unknown as [string, { entries: { op: string }[] }];
    expect(doc.entries.map((e) => e.op)).toEqual(["create"]);
    // 綁定是追加的：換掉的舊書要明確解綁，不然重新進來讀到的還是它
    expect(api.unbindWorldbook).toHaveBeenCalledWith("wb1", "r1", "tok");
  });

  it("改書名：送 metadata，圖示標籤可見性原樣帶回去，不會被清成空的", async () => {
    await mount("/create");
    await type($("#f-name"), "測試");
    byText("世界書").click();
    await flush();
    const select = $<HTMLSelectElement>("#wb-reuse");
    select.value = "wb9";
    select.dispatchEvent(new Event("change"));
    await flush();
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "用這一本")!.click();
    await flush();

    // 描述讀得回來，改得動
    expect($<HTMLInputElement>("#wb-desc").value).toBe("舊描述");
    await type($("#wb-name"), "北境設定 v2");
    await type($("#wb-desc"), "新描述");
    await submit();

    const [, doc] = api.patchWorldbookDocument.mock.calls[0] as unknown as [string, { metadata?: unknown }];
    expect(doc.metadata).toEqual({
      name: "北境設定 v2",
      description: "新描述",
      iconUrl: "https://img.test/wb.png",
      visibility: "private",
      tags: ["北境", "懸疑"],
    });
  });

  it("觸發區域：選了跟著送，上游讀回來的值不會在下次儲存掉了", async () => {
    await mount("/create");
    await type($("#f-name"), "測試");
    byText("世界書").click();
    await flush();
    byText("建一本").click();
    await flush();
    await openEntries();
    await type($d<HTMLTextAreaElement>("#wbd-content"), "那句暗號只有玩家講得出來。");
    const trigger = $d<HTMLSelectElement>("#wbd-tr");
    trigger.value = "user_only";
    trigger.dispatchEvent(new Event("change"));
    await flush();
    await submit();

    const [, doc] = api.patchWorldbookDocument.mock.calls[0] as unknown as [string, { entries: { triggerRegion?: string }[] }];
    expect(doc.entries[0].triggerRegion).toBe("user_only");
  });

  it("版本化卡片：儲存只修改草稿，頁上說明已發布版本繼續可玩", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "北境", roleDesc: "舊簡介", roleVisibility: "public" });
    await mount("/cards/r1/edit");
    expect(document.body.textContent).toContain(i18n.global.t("workspace.editNotice"));
    api.unpublishRole.mockClear();
    api.patchRoleDocument.mockClear();
    const desc = $<HTMLTextAreaElement>("#f-desc");
    desc.value = "改過的簡介";
    desc.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await submit();
    expect(api.unpublishRole).toHaveBeenCalledWith("r1", "tok");
    expect(api.patchRoleDocument).toHaveBeenCalledTimes(1);
    expect(api.unpublishRole.mock.invocationCallOrder[0]).toBeLessThan(api.patchRoleDocument.mock.invocationCallOrder[0]);
    // 轉過一次就不再轉：再存一次不會又打一次
    api.unpublishRole.mockClear();
    desc.value = "再改一次";
    desc.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await submit();
    expect(api.unpublishRole).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("這張卡已經公開");
    app.unmount(); root.remove();

    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "北境", roleVisibility: "waitReview" });
    await mount("/cards/r2/edit");
    expect(document.body.textContent).toContain(i18n.global.t("workspace.editNotice"));
  });

  it("只調順序也存得下來：不送任何條目操作，只送新的順序", async () => {
    // 角色本身一個字都不動：只把條目換個位置，儲存鍵也得是活的
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "北境", roleWelcome: "雨還在下。" });
    await mount("/cards/r1/edit");
    byText("世界書").click();
    await flush();
    api.patchWorldbookDocument.mockClear();

    // 讀回來是 e1、e2；把第二條往上搬
    await openEntries();
    const up = [...document.querySelectorAll<HTMLButtonElement>(".wbd button[aria-label='往上移']")];
    expect(up).toHaveLength(2);
    up[1].click();
    await flush();
    btnIn(document.querySelector(".wbd")!, "編好了").click();
    await flush();
    await submit();

    expect(api.patchWorldbookDocument).not.toHaveBeenCalled();
    expect(api.reorderWorldbookEntries).toHaveBeenCalledWith("wb-bound", ["e2", "e1"], "tok");
  });

  it("換綁既有的書：讀最後綁上的那本，換成別本存檔後舊的解綁", async () => {
    // 修之前換書只追加綁定：卡上會掛著兩本，最後綁上的才是作者最近選的
    api.fetchRoleWorldbooks.mockResolvedValueOnce([
      { worldbookId: "wb-old", name: "舊設定", description: "", entryCount: 1 },
      { worldbookId: "wb-bound", name: "北境設定", description: "", entryCount: 2 },
    ]);
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "北境", roleWelcome: "雨還在下。" });
    await mount("/cards/r1/edit");
    byText("世界書").click();
    await flush();
    expect(api.fetchWorldbookEntries).toHaveBeenLastCalledWith("wb-bound", "tok");
    api.patchWorldbookDocument.mockClear();
    api.unbindWorldbook.mockClear();

    const { settleConfirm } = await import("../src/lib/confirm");
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "換一本")!.click();
    await flush();
    settleConfirm(true);
    await flush();
    const select = $<HTMLSelectElement>("#wb-reuse");
    select.value = "wb9";
    select.dispatchEvent(new Event("change"));
    await flush();
    byText("用這一本").click();
    await flush();
    await submit();

    expect(api.patchWorldbookDocument).toHaveBeenCalledWith("wb9", { binding: { roleId: "r1" } }, "tok");
    expect(api.unbindWorldbook).toHaveBeenCalledWith("wb-bound", "r1", "tok");
    expect(api.unbindWorldbook).toHaveBeenCalledTimes(1);
  });

  it("對話測試：存過的卡才載入舞台，載的是這張卡自己的 /play", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "北境", roleWelcome: "雨還在下。" });
    await mount("/cards/r1/edit");

    const frame = $<HTMLIFrameElement>(".ct__frame");
    expect(frame).toBeTruthy();
    // 走的是站內既有的 /play/:roleId——那本來就是真 AI、真世界書、真正則，
    // 不必另外建試玩卡（那套是給 playground 沒有卡的情境用的）
    // 語系前綴由 lp() 決定，測試的 router 沒掛前綴；釘的是「指向這張卡的 /play」
    expect(frame.getAttribute("src")).toBe("/play/r1?mode=source&provider=harbor");
    expect(root.querySelector(".ct__state")).toBeNull();
  });

  it("按了「建一本」卻一條都沒填：存完不能永遠卡在「有未儲存的修改」", async () => {
    await mount("/create");
    await type($("#f-name"), "測試卡");
    byText("世界書").click();
    await flush();
    // 建一本會塞一條空條目進去；作者沒填內容就直接存
    byText("建一本").click();
    await flush();
    await submit();

    // 不建空書是對的，但那條空條目要一起放掉——留著的話它跟原始清單永遠對不上，
    // 儲存鍵永遠亮著，這張卡再也送不出審核，而畫面上完全看不出是為什麼
    expect(api.createWorldbook).not.toHaveBeenCalled();
    // 未存提示與儲存鍵搬到表單底下那條動作列了（右欄整條讓給對話測試的手機框）
    expect(root.querySelector(".bar .subtle")?.textContent?.trim() ?? "").not.toContain("未儲存");
    const saveBtn = [...root.querySelectorAll<HTMLButtonElement>(".bar button")]
      .find((b) => /儲存|保存/.test(b.textContent || ""))!;
    expect(saveBtn.disabled).toBe(true);
  });

  it("世界書沒取名時用角色名建：存完不能還是「有未儲存的修改」", async () => {
    await mount("/create");
    await type($("#f-name"), "測試卡");
    byText("世界書").click();
    await flush();
    byText("建一本").click();
    await flush();
    await openEntries();
    await type($d<HTMLTextAreaElement>("#wbd-content"), "北境的規矩。");
    btnIn(document.querySelector(".wbd")!, "編好了").click();
    await flush();
    // 書名那格留空：上游會拿角色名去建，但畫面上那格還是空的
    await submit();

    // 存完之後基準要對得上，否則差分永遠成立、儲存鍵永遠亮著、
    // 而且每按一次儲存都白送一次 metadata
    // 未存提示與儲存鍵搬到表單底下那條動作列了（右欄整條讓給對話測試的手機框）
    expect(root.querySelector(".bar .subtle")?.textContent?.trim() ?? "").not.toContain("未儲存");
    const saveBtn = [...root.querySelectorAll<HTMLButtonElement>(".bar button")]
      .find((b) => /儲存|保存/.test(b.textContent || ""))!;
    expect(saveBtn.disabled).toBe(true);
  });

  it("大本世界書分段送：每段最多 100 個操作、綁定只跟第一段；中途失敗再存只送剩下的", async () => {
    await mount("/create");
    await type($("#f-name"), "大本");
    byText("世界書").click();
    await flush();
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < 250; i++) entries[String(i)] = { key: [`k${i}`], content: `entry ${i}`, comment: `e${i}` };
    const inputs = root.querySelectorAll<HTMLInputElement>("input[type=file]");
    await pickFile(inputs[inputs.length - 1], new File([JSON.stringify({ entries })], "big.json"));
    expect(root.textContent).toContain("匯入了 250 條");

    // 伺服器：每段回這段新建條目的 id；第二段故意失敗一次（模擬連線被切）
    let call = 0;
    api.patchWorldbookDocument.mockImplementation(async (_id: string, doc: { entries: { op: string }[] }) => {
      call++;
      if (call === 2) throw new Error("boom");
      return { createdEntryIds: doc.entries.filter((e) => e.op === "create").map((_e, i) => `id-${call}-${i}`) };
    });
    try {
      await submit();
      for (let i = 0; i < 6; i++) await flush();
      expect(api.createWorldbook).toHaveBeenCalledTimes(1);
      expect(api.patchWorldbookDocument).toHaveBeenCalledTimes(2);
      const first = api.patchWorldbookDocument.mock.calls[0][1] as { entries: unknown[]; binding?: unknown };
      expect(first.entries).toHaveLength(100);
      expect(first.binding).toEqual({ roleId: "r1" });
      expect(root.textContent).toContain("boom");

      // 再按一次儲存：書已經有了不再建，第一段的 100 條已拿到 id 不再送，只送剩下的 150，也不再綁
      await submit();
      for (let i = 0; i < 6; i++) await flush();
      expect(api.createWorldbook).toHaveBeenCalledTimes(1);
      expect(api.patchWorldbookDocument).toHaveBeenCalledTimes(4);
      const third = api.patchWorldbookDocument.mock.calls[2][1] as { entries: unknown[]; binding?: unknown };
      const fourth = api.patchWorldbookDocument.mock.calls[3][1] as { entries: unknown[] };
      expect(third.entries).toHaveLength(100);
      expect(third.binding).toBeUndefined();
      expect(fourth.entries).toHaveLength(50);
    } finally {
      api.patchWorldbookDocument.mockImplementation(async () => ({}));
    }
  });

  it("新卡草稿存在本機：關掉再回來原樣還原，清空重來就沒了", async () => {
    await mount("/create");
    await type($("#f-name"), "半路離開的卡");
    await type($("#f-detail"), "寫了一半的人設。");
    await new Promise((r) => setTimeout(r, 500));
    expect(localStorage.getItem("hearthroom.draft.create")).toContain("半路離開的卡");
    app!.unmount();
    root.remove();

    await mount("/create");
    expect($<HTMLInputElement>("#f-name").value).toBe("半路離開的卡");
    expect(root.textContent).toContain("已恢復上次沒儲存的草稿");
    byText("清空重來").click();
    await flush();
    expect($<HTMLInputElement>("#f-name").value).toBe("");
    expect(localStorage.getItem("hearthroom.draft.create")).toBeNull();
  });

  it("刪卡：要照打角色名稱才准；先撤榜單登記再刪上游，然後回到我的卡片", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "阿芙拉", roleDesc: "老闆娘" });
    await mount("/cards/r1/edit");
    byText("發布").click();
    await flush();
    btnIn(root, "刪除這張卡").click();
    await flush();
    expect(confirmState.current?.requireText).toBe("阿芙拉");
    expect(confirmState.current?.danger).toBe(true);
    // 打錯：什麼都不會發生
    settleConfirm(true, "阿芙");
    await flush();
    expect(api.deleteRole).not.toHaveBeenCalled();
    expect(confirmState.current).not.toBeNull();
    // 打對：先撤登記、再刪卡、回到 /mine?fresh=1
    settleConfirm(true, "阿芙拉");
    await flush(); await flush();
    expect(api.unregisterCard).toHaveBeenCalledWith("r1", "tok");
    expect(api.deleteRole).toHaveBeenCalledWith("r1", "tok");
    expect(api.unregisterCard.mock.invocationCallOrder[0]).toBeLessThan(api.deleteRole.mock.invocationCallOrder[0]);
    expect(router.currentRoute.value.path).toBe("/mine");
    expect(router.currentRoute.value.query.fresh).toBe("1");
  });

  it("新卡（還沒建立）沒有刪除鍵", async () => {
    await mount("/create");
    byText("發布").click();
    await flush();
    expect([...root.querySelectorAll("button")].some((b) => b.textContent?.trim() === "刪除這張卡")).toBe(false);
  });
});

// 2026-09-11 一位作者：按儲存顯示失敗，上游卻多了一張只有名字的空卡；重試幾次就多幾張。
// 建卡與寫內容是兩步，第一步成功第二步失敗時，卡已經有編號——要記住它、講清楚，下次存回同一張。
describe("建卡成功、內容沒存進去", () => {
  it("講清楚卡已建立；重開頁面草稿帶著卡號回來，再存是同一張卡，不再建新的", async () => {
    api.patchRoleDocument.mockRejectedValueOnce(new Error("額外指示 812 字，超過上限 500 字。"));
    await mount("/create");
    await type($("#f-name"), "半路失敗的卡");
    await type($("#f-detail"), "人設");
    await submit();
    expect(api.createRole).toHaveBeenCalledTimes(1);
    const notice = root.textContent ?? "";
    expect(notice).toContain("已經建立");
    expect(notice).toContain("812");
    expect(localStorage.getItem("hearthroom.draft.create")).toContain("r1");

    // 關掉再開：草稿回來，而且知道它就是 r1
    app!.unmount();
    root.remove();
    await mount("/create");
    expect($<HTMLInputElement>("#f-name").value).toBe("半路失敗的卡");
    await submit();
    expect(api.createRole).toHaveBeenCalledTimes(1);
    expect(api.patchRoleDocument).toHaveBeenLastCalledWith("r1", expect.objectContaining({ roleName: "半路失敗的卡" }), "tok");
    expect(window.location.pathname).toBe("/cards/100021/edit");
    expect(localStorage.getItem("hearthroom.draft.create")).toBeNull();
  });
});




it('HarperHarbor submits once to HearthRoom with an explicit rating and no hosting destination chooser',async()=>{
 localStorage.setItem('hearthroom.provider','harbor');
 platforms.profile={identities:[{provider:'harbor',externalId:7},{provider:'harbor',externalId:8}]};
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'Synthetic card',roleDesc:'Summary',roleDetailDesc:'Private instructions',roleWelcome:'Hello',roleAvatar:'https://img.test/avatar.png'});
 await mount('/cards/r1/edit');
 byText('發布').click();await flush();
 btnIn(root,i18n.global.t('editor.publish.submit')).click();await flush();
 expect(root.querySelector('.platform-dialog')).toBeNull();
 expect(confirmState.current?.choices?.map(c=>c.value)).toEqual(['sfw','nsfw']);
 settleConfirm(true,'','sfw');await flush();await flush();
 expect(api.registerCard).toHaveBeenCalledWith('r1','tok',false,[],'harbor');
 expect(api.submitRoleForReview).not.toHaveBeenCalled();
 expect(platforms.saveCopies).not.toHaveBeenCalled();
 expect(router.currentRoute.value.path).toBe('/mine');
});

it('submits a private HarperHarbor draft to the same immutable community review',async()=>{
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'Legacy draft',roleDetailDesc:'Private instructions',roleWelcome:'Hello'});
 await mount('/cards/r1/edit');
 expect(root.textContent).toContain(i18n.global.t('workspace.editHint'));
 byText('發布').click();await flush();
 btnIn(root,i18n.global.t('editor.publish.submit')).click();await flush();
 settleConfirm(true,'','sfw');await flush();await flush();
 expect(api.submitRoleForReview).not.toHaveBeenCalled();
 expect(api.registerCard).toHaveBeenCalledWith('r1','tok',false,[],'harbor');
 expect(router.currentRoute.value.path).toBe('/mine');
});

it('retires a pending Harbor review before saving, then submits the completed draft again',async()=>{
 localStorage.setItem('hearthroom.provider','harbor');
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'A',roleDetailDesc:'Private instructions',roleWelcome:'Hello',roleVisibility:'public'});
 api.beginCardEdit.mockResolvedValueOnce({resubmit:true,nsfw:true});
 await mount('/cards/r1/edit');
 await type($<HTMLInputElement>('#f-name'),'B revised');await submit();
 expect(api.beginCardEdit).toHaveBeenCalledWith('r1','tok','harbor');
 expect(api.beginCardEdit.mock.invocationCallOrder[0]).toBeLessThan(api.patchRoleDocument.mock.invocationCallOrder[0]);
 expect(api.unpublishRole).toHaveBeenCalledWith('r1','tok');
 expect(api.registerCard).toHaveBeenCalledWith('r1','tok',true,[],'harbor');
 expect(api.registerCard.mock.invocationCallOrder[0]).toBeGreaterThan(api.patchRoleDocument.mock.invocationCallOrder[0]);
});

it('a failed draft save never submits partial content for review',async()=>{
 localStorage.setItem('hearthroom.provider','harbor');
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'A'});
 api.beginCardEdit.mockResolvedValueOnce({resubmit:true,nsfw:false});
 api.patchRoleDocument.mockRejectedValueOnce(new Error('fixture save failed'));
 await mount('/cards/r1/edit');await type($<HTMLInputElement>('#f-name'),'B');await submit();
 expect(api.beginCardEdit).toHaveBeenCalled();
 expect(api.registerCard).not.toHaveBeenCalled();
 expect(root.textContent).toContain('fixture save failed');
 expect($<HTMLInputElement>('#f-name').value).toBe('B');
});


it('saves Harbor external image URLs directly without creating media assets', async () => {
 localStorage.setItem('hearthroom.provider', 'harbor');
 const url = 'https://objects.harbor.ai/cards/synthetic.png';
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'External image',roleAvatar:url});
 const fetchSpy = vi.spyOn(globalThis, 'fetch');
 try {
  await mount('/cards/r1/edit');
  await type($<HTMLInputElement>('#f-name'), 'Updated name');
  await submit();
  expect(api.patchRoleDocument).toHaveBeenCalled();
  expect(fetchSpy.mock.calls.some(([url])=>String(url).endsWith('/media/references'))).toBe(false);
  expect(root.querySelector(`img[src="${url}"]`)).not.toBeNull();
 } finally {fetchSpy.mockRestore();}
});

it('opens a numeric editor URL using the author source, never the published revision', async () => {
 await mount('/cards/100021/edit');
 expect(api.fetchCard).toHaveBeenCalledWith('100021', expect.any(String));
 expect(api.fetchRoleDetail).toHaveBeenCalledWith('r1','tok');
 expect(api.fetchRoleDetail).not.toHaveBeenCalledWith('frozen-r1','tok');
});
