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
import { embedIntoPng, type TavernCard } from "../src/lib/tavern";
import { writeChunks } from "../src/lib/png-chunks";
import CardEditorPage from "../src/pages/CardEditorPage.vue";

const api = vi.hoisted(() => ({
  createRole: vi.fn(async () => ({ roleId: "r1" })),
  patchRoleDocument: vi.fn(async () => ({})),
  patchRoleWelcome: vi.fn(async () => ({})),
  createWorldbook: vi.fn(async () => "wb1"),
  patchWorldbookDocument: vi.fn(async () => ({})),
  fetchWorldbookEntries: vi.fn(async () => [
    { entryId: "e1", name: "黑麥鎮", content: "北境小鎮。", keywords: ["黑麥鎮"], secondaryKeywords: [], isEnabled: true, isConstant: true },
    { entryId: "e2", name: "採石場", content: "廢棄了。", keywords: ["採石場"], secondaryKeywords: ["排水渠"], isEnabled: true, isConstant: false },
  ]),
  fetchRoleValidation: vi.fn(async () => ({ status: "ok", blockers: [], warnings: [] })),
  fetchRoleDetail: vi.fn(async () => ({})),
  fetchRoleWorldbooks: vi.fn(async () => []),
  submitRoleForReview: vi.fn(async () => ({})),
  uploadImage: vi.fn(async () => "https://img.test/avatar.png"),
}));
vi.mock("../src/lib/api", () => api);
vi.mock("../src/lib/session", () => ({
  useSession: () => ({ accessToken: async () => "tok", me: { accountNumId: 7, nickName: "作者", avatar: "" } }),
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
    extensions: { regex_scripts: [{ id: "status" }] },
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
const byText = (text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;

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
  for (const fn of Object.values(api)) fn.mockClear();
  // happy-dom 沒有 object URL；預覽用的立繪縮圖走這條
  if (!("createObjectURL" in URL)) {
    Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });
  }
});
afterEach(() => {
  app?.unmount();
  app = null;
  root.remove();
});

describe("匯入酒館卡 → 建立 → 編輯", () => {
  it("匯入把每一區都填好，儲存照順序打四個端點，內容對得上", async () => {
    await mount("/create");
    await pickFile($("input[type=file]"), new File([JSON.stringify(CARD)], "avra.json", { type: "application/json" }));

    // 報告：標籤多了兩個、正則腳本一條、原作者署名
    const report = root.textContent ?? "";
    expect(report).toContain("讀到了：阿芙拉");
    expect(report).toContain("多出來的 2 個標籤");
    expect(report).toContain("1 條正則腳本");
    expect(report).toContain("someone");

    byText("套用到表單").click();
    await flush();

    expect($<HTMLInputElement>("#f-name").value).toBe("阿芙拉");
    expect($<HTMLTextAreaElement>("#f-desc").value).toBe("一張慢熱的懸疑卡。");
    expect($<HTMLTextAreaElement>("#f-detail").value).toBe("金麥穗酒館的老闆娘。\n\n【性格】\n嘴硬心軟。\n\n【場景】\n北境邊鎮，商隊失蹤的那一週。");
    expect($<HTMLTextAreaElement>("#f-welcome").value).toContain("北境每天都有遲到的車隊");
    expect($<HTMLTextAreaElement>("#f-contract").value).toBe("回覆用第三人稱。");
    expect($<HTMLTextAreaElement>("#f-jb").value).toBe("不要替玩家做決定。");
    expect($<HTMLInputElement>("#f-tags").value.split("、")).toHaveLength(10);
    // 左欄：三個必填都有了，不該再有紅點
    expect(root.querySelectorAll(".side__dot")).toHaveLength(0);
    // 右欄預覽跟著名字
    expect($(".rail__tile").textContent).toContain("阿芙拉");

    await submit();

    expect(api.createRole).toHaveBeenCalledWith({ roleName: "阿芙拉", language: "zh-Hant" }, "tok");
    const [, fields] = api.patchRoleDocument.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fields).toMatchObject({
      roleName: "阿芙拉",
      roleDesc: "一張慢熱的懸疑卡。",
      roleOutputContract: "回覆用第三人稱。",
      jailbreak: "不要替玩家做決定。",
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
    expect(api.createWorldbook).toHaveBeenCalledWith({ name: "黑麥鎮", language: "zh-Hant" }, "tok");
    const [bookId, doc] = api.patchWorldbookDocument.mock.calls[0] as unknown as [string, { entries: unknown[]; binding?: unknown }];
    expect(bookId).toBe("wb1");
    expect(doc.binding).toEqual({ roleId: "r1" });
    expect(doc.entries).toEqual([
      { op: "create", name: "黑麥鎮", content: "北境小鎮。", keywords: ["黑麥鎮"], secondaryKeywords: [], isEnabled: true, isConstant: true },
      // 酒館的 secondary_keys 直接落到條目的 AND 門，不再併進 keywords
      { op: "create", name: "採石場", content: "廢棄了。", keywords: ["採石場"], secondaryKeywords: ["排水渠"], isEnabled: true, isConstant: false },
    ]);
    // 建立完成 → 網址換成編輯頁，本機草稿清掉
    expect(window.location.pathname).toBe("/cards/r1/edit");
    expect(localStorage.getItem("hearthroom.draft.create")).toBeNull();

    // 第二次儲存：只改簡介，就只送簡介；開場白與世界書一個請求都不該再發
    await type($("#f-desc"), "改過的簡介");
    await submit();
    expect(api.patchRoleDocument).toHaveBeenCalledTimes(2);
    expect(api.patchRoleDocument.mock.calls[1][1]).toEqual({ roleDesc: "改過的簡介" });
    expect(api.patchRoleWelcome).toHaveBeenCalledTimes(1);
    expect(api.patchWorldbookDocument).toHaveBeenCalledTimes(1);
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
    // 有內容的條目預設收合：先全部展開，欄位才在 DOM 裡
    for (const btn of root.querySelectorAll<HTMLButtonElement>("button[aria-label='展開']")) btn.click();
    await flush();
    const contents = root.querySelectorAll<HTMLTextAreaElement>("textarea[id^=wb-c-]");
    expect(contents).toHaveLength(2);
    await type(contents[0], "北境小鎮，三條商路交會。");
    // 第二條刪掉（已存在的條目會先問一聲：這裡直接走確認）
    const { settleConfirm } = await import("../src/lib/confirm");
    root.querySelectorAll<HTMLButtonElement>("button[aria-label='刪除條目']")[1].click();
    await flush();
    settleConfirm(true);
    await flush();
    await submit();
    const [, doc] = api.patchWorldbookDocument.mock.calls[1] as unknown as [string, { entries: unknown[]; binding?: unknown }];
    expect(doc.binding).toBeUndefined();
    expect(doc.entries).toEqual([
      { op: "delete", entryId: "e2" },
      { op: "update", entryId: "e1", name: "黑麥鎮", content: "北境小鎮，三條商路交會。", keywords: ["黑麥鎮"], secondaryKeywords: [], isEnabled: true, isConstant: true },
    ]);
  });

  it("PNG 卡：自帶的立繪上傳後當頭像", async () => {
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
    byText("形象").click();
    await flush();
    expect(root.querySelector("img[src='https://img.test/avatar.png']")).not.toBeNull();
  });

  it("世界書檔匯入：接在原有條目後面，沒綁書就順手建", async () => {
    await mount("/create");
    await type($("#f-name"), "測試");
    byText("世界書").click();
    await flush();
    const info = { entries: { "0": { key: ["eldoria"], content: "A forest.", comment: "eldoria" }, "1": { key: ["glade"], keysecondary: ["safe"], content: "A glade.", constant: true } } };
    const inputs = root.querySelectorAll<HTMLInputElement>("input[type=file]");
    await pickFile(inputs[inputs.length - 1], new File([JSON.stringify(info)], "eldoria.json"));
    expect(root.textContent).toContain("匯入了 2 條");
    // 匯入的條目有內容，預設收合成一行摘要；摘要裡看得到次要關鍵詞
    expect(root.querySelectorAll(".entry")).toHaveLength(2);
    expect(root.querySelectorAll(".entry__summary")[1].textContent).toContain("+ safe");
    await submit();
    expect(api.createWorldbook).toHaveBeenCalledWith({ name: "測試", language: "zh-Hant" }, "tok");
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
});
