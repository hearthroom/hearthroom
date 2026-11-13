const rollout=vi.hoisted(()=>({enabled:true}));
vi.mock('../src/lib/work-visibility-capability',async()=>{const {ref}=await import('vue');return {useWorkVisibilityCapability:()=>ref(rollout.enabled)};});

const visibilityMocks=vi.hoisted(()=>({read:vi.fn(),change:vi.fn(),operation:vi.fn()}));
vi.mock('../src/lib/work-visibility',async original=>({...await original<typeof import('../src/lib/work-visibility')>(),fetchWorkVisibility:visibilityMocks.read,changeWorkVisibility:visibilityMocks.change,fetchVisibilityOperation:visibilityMocks.operation}));
vi.mock('../src/lib/share-ref',async original=>({...await original<typeof import('../src/lib/share-ref')>(),currentReferralCode:async()=>null,ownReferralCode:async()=>null}));
const visibilityPolicy=(extra:any={})=>({access:'private',effectiveAccess:'owner',review:'none',update:'none',everPublic:false,revisionState:'unknown',restorable:false,restoreReason:'no_approval',draftChanged:false,restriction:'none',policyRevision:'1',approvalRevision:'0',actions:['set_private','set_unlisted','submit_review'],syncState:'complete',...extra});
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
import { ratingState } from "../src/lib/rating";
import { makeDraft } from "../src/lib/role-draft";
import { formatReviewLength } from "../src/lib/review-length";

const GENERAL = { version: 1, topics: {}, other: "other.none" };
const ADULT = { version: 1, topics: { sex: "sex.explicit" }, other: "other.none" };

const platforms = vi.hoisted(()=>({profile:undefined as any, saveCopies:vi.fn(async()=>[] as any[])}));
vi.mock("../src/lib/authoring-platforms",()=>({saveCopies:platforms.saveCopies,savedDistributionTargets:async()=>[]}));
const api = vi.hoisted(() => ({
 fetchApprovedDraft:vi.fn(async()=>({operationId:'00000000-0000-4000-8000-000000000001',approvedRoleId:"approved-r1",approvalRevision:"approval",policyRevision:"draft"})),
 saveApprovedDraft:vi.fn(async()=>({approvedRoleId:"approved-r1",approvalRevision:"approval",policyRevision:"saved"})),
 fetchCardDeletion:vi.fn(async():Promise<{deletion:any}>=>({deletion:null})),
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
  fetchWorldbookEntries: vi.fn(async (_id?:string, _token?:string) => [
    { entryId: "e1", name: "黑麥鎮", content: "北境小鎮。", keywords: ["黑麥鎮"], secondaryKeywords: [], isEnabled: true, isConstant: true, category: "location" },
    { entryId: "e2", name: "採石場", content: "廢棄了。", keywords: ["採石場"], secondaryKeywords: ["排水渠"], isEnabled: true, isConstant: false },
  ]),
  fetchRoleValidation: vi.fn(async () => ({ status: "ok", blockers: [], warnings: [] })),
  fetchDraftState: vi.fn(async ():Promise<any> => ({status:'unlisted',draftChanged:false})),
  fetchRoleDetail: vi.fn(async () => ({})),
  fetchRoleWorldbooks: vi.fn(async () => [{ worldbookId: "wb-bound", name: "北境設定", description: "", entryCount: 2 }]),
  fetchMyWorldbooks: vi.fn(async () => [
    { worldbookId: "wb9", name: "北境設定", description: "舊描述", entryCount: 2, iconUrl: "https://img.test/wb.png", visibility: "private", tags: "北境,懸疑" },
  ]),
  submitRoleForReview: vi.fn(async () => ({})),
  registerCard: vi.fn(async () => ({status:'pending'})),
  fetchFandoms: vi.fn(async () => []),
  beginCardEdit: vi.fn(async ():Promise<{resubmit:boolean;ratingAnswers?:unknown}> => ({resubmit:false})),
  fetchRatingDraft: vi.fn(async ():Promise<unknown> => null),
  saveRatingDraft: vi.fn(async () => {}),
  deleteRole: vi.fn(async () => {}),
  unregisterCard: vi.fn(async () => {}),
  uploadImage: vi.fn(async () => "https://img.test/avatar.png"),
  fetchAuthorAsset: vi.fn(async () => ({ rules: [], mountTrigger: "", mountLayer: "", pageMode: "classic", status: "none", version: 0 })),
  saveAuthorAsset: vi.fn(async (_roleId: string, body: { version: number }) => ({ ...body, status: "passed", version: body.version + 1 })),
  putRoleState: vi.fn(async (_roleId: string, _body: unknown, _token: string): Promise<{ state: unknown }> => ({ state: {} })),
  deleteRoleState: vi.fn(async () => ({ state: null })),
}));
vi.mock("../src/lib/api", async original => ({...api, ApiError:(await original<typeof import("../src/lib/api")>()).ApiError}));
vi.mock("../src/lib/session", () => ({
  useSession: () => ({ profile:platforms.profile, accessToken: async () => "tok", me: { accountNumId: 7, nickName: "作者", avatar: "" } }),
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "create", setSurface: () => {} }));
// 編輯器裡的「生成」：入口狀態與授權由 use-image-generation 管（資源頁的測試跑的是真的那份）
const gen = vi.hoisted(() => ({
  imageGen: null as unknown,
  create: vi.fn(),
  wait: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../src/lib/use-image-generation", async () => {
  const { ref } = await import("vue");
  return {
    useImageGeneration: () => ({
      imageGen: ref(gen.imageGen),
      generator: async () => ({ create: gen.create, wait: gen.wait, save: gen.save }),
      probeGeneration: async () => {},
      markReauthorizing: () => {},
    }),
  };
});

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

it('shows the authoritative exemption instead of a remaining-character warning',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({enabled:true})));
  api.fetchRoleDetail.mockResolvedValueOnce({roleName:'Synthetic short card',roleDetailDesc:'Short',roleWelcome:'Opening'});
  await mount('/cards/r1/edit');
  expect($('[data-review-count]').textContent).toContain(i18n.global.t('lengthExemption.author'));
  expect($('[data-review-count]').textContent).not.toContain('還差');
  expect($('[data-review-count]').textContent).not.toContain('至少');
});

it.each(['entries', 'bindings'] as const)('blocks writes and offers a retry when Lorebook %s cannot load', async (part) => {
  api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Before', roleWelcome: 'Opening' });
  (part === 'entries' ? api.fetchWorldbookEntries : api.fetchRoleWorldbooks).mockRejectedValueOnce(new Error('unavailable'));
  await mount('/cards/r1/edit');
  await type($("#f-name"), 'Keep this unsaved name');
  expect(root.querySelector('.wb [role="alert"]')?.textContent).toContain(i18n.global.t('state.loadFailed'));
  expect(root.querySelector('.wb')?.textContent).not.toContain(i18n.global.t('wb.entries.empty'));
  expect(btnIn(root, i18n.global.t('wb.entries.manage'))).toBeUndefined();
  expect($<HTMLButtonElement>('.bar button[type="submit"]').disabled).toBe(true);
  await submit(); // Keyboard/programmatic submission must not bypass the disabled button.
  expect(api.beginCardEdit).not.toHaveBeenCalled();
  expect(api.patchRoleDocument).not.toHaveBeenCalled();
  expect(api.patchWorldbookDocument).not.toHaveBeenCalled();
  btnIn(root, i18n.global.t('resource.retry')).click();
  await flush();
  expect($<HTMLInputElement>('#f-name').value).toBe('Keep this unsaved name');
  expect(root.querySelector('.wb [role="alert"]')).toBeNull();
  expect(root.querySelector('.wb')?.textContent).toContain('黑麥鎮');
  expect(root.querySelector('.body__scroll > .notice--error')).toBeNull();
  await submit();
  expect(api.beginCardEdit).toHaveBeenCalledTimes(1);
  expect(api.patchRoleDocument).toHaveBeenCalledWith('r1', expect.objectContaining({roleName:'Keep this unsaved name'}), 'tok');
});

it('keeps a successfully loaded empty Lorebook editable', async () => {
  api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Empty', roleWelcome: 'Opening' });
  api.fetchWorldbookEntries.mockResolvedValueOnce([]);
  await mount('/cards/r1/edit');
  expect(root.querySelector('.wb [role="alert"]')).toBeNull();
  expect(root.querySelector('.wb')?.textContent).toContain(i18n.global.t('wb.entries.empty'));
  expect(btnIn(root, i18n.global.t('wb.entries.manage'))).toBeTruthy();
});

describe('review count next to the character definition', () => {
  const counted = (length: Parameters<typeof formatReviewLength>[0]) => formatReviewLength(length, String(i18n.global.locale.value));
  const t = (key: string, params: Record<string, string> = {}) => i18n.global.t(key, params);

  it('counts the definition and enabled always-on entries the way the review check does, beside the field limit', async () => {
    // 角色設定：<b>設定</b>，{{user}} 😀 → 2；常駐條目「北境小鎮。」→ 4；非常駐條目不計
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Count', roleDetailDesc: '<b>設定</b>，{{user}} 😀', roleWelcome: 'Opening' });
    await mount('/cards/r1/edit');
    // 角色設定下面只留一行「常駐 N 字 · 還差 M 字」；拆項與計算說明在頂列（ui.md §2.1）
    const block = $('[data-section="persona"] [data-review-count]');
    const params = counted({ persona: 2, constantWorldbook: 4, total: 6, required: 3001, remaining: 2995, eligible: false, welcome: 0 });
    expect(block.textContent).toContain(t('reviewLength.constantTotal', params));
    expect(block.textContent).toContain(t('reviewLength.remaining', params));
    // 欄位上限的計數照舊：原始字元數
    expect($('[data-section="persona"] .count').textContent).toContain(String([...'<b>設定</b>，{{user}} 😀'].length));

    await type($('#f-detail'), '字'.repeat(2997));
    const met = counted({ persona: 2997, constantWorldbook: 4, total: 3001, required: 3001, remaining: 0, eligible: true, welcome: 0 });
    expect(block.textContent).toContain(t('reviewLength.constantTotal', met));
    expect(block.textContent).toContain(t('reviewLength.eligible'));
    expect(block.textContent).not.toContain(t('reviewLength.remaining', met));
  });

  it('persistently shows card always-on characters and threshold in the top bar and total Lorebook characters in the Lorebook section, updating live on edits', async () => {
    // 角色設定：<b>設定</b>，{{user}} 😀 → 2；常駐條目「北境小鎮。」→ 4；非常駐條目「廢棄了。」→ 3
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Count', roleDetailDesc: '<b>設定</b>，{{user}} 😀', roleWelcome: 'Opening' });
    await mount('/cards/r1/edit');

    const topBar = $('[data-card-constant-count]');
    const initial = counted({ persona: 2, constantWorldbook: 4, total: 6, required: 3001, remaining: 2995, eligible: false, welcome: 0 });
    expect(topBar.textContent).toContain(t('reviewLength.constantTotal', initial));
    expect(topBar.textContent).toContain(t('reviewLength.threshold', initial));

    const wbTotal = $('[data-section="worldbook"] [data-worldbook-total]');
    expect(wbTotal.textContent).toContain(t('wb.totalChars', { n: '7' }));

    // 編輯非常駐條目：世界書總字數即時更新，頂欄常駐字數不變
    await openEntries();
    expect($d('[data-worldbook-dialog-total]').textContent).toContain(t('wb.totalChars', { n: '7' }));
    await pickEntry(1);
    await type($d<HTMLTextAreaElement>('#wbd-content'), '廢棄的採石場，有十個字。');
    expect($d('[data-worldbook-dialog-total]').textContent).toContain(t('wb.totalChars', { n: '14' }));
    expect($('[data-section="worldbook"] [data-worldbook-total]').textContent).toContain(t('wb.totalChars', { n: '14' }));
    expect($('[data-card-constant-count]').textContent).toContain(t('reviewLength.constantTotal', initial));

    // 將非常駐條目改為常駐：頂欄常駐字數即時增加（2 + 4 + 10 = 16），世界書總字數仍為 14
    const constantCheckbox = $d<HTMLInputElement>('.wbd__recall input[type="checkbox"]');
    constantCheckbox.checked = true;
    constantCheckbox.dispatchEvent(new Event('change'));
    await flush();
    const afterConstant = counted({ persona: 2, constantWorldbook: 14, total: 16, required: 3001, remaining: 2985, eligible: false, welcome: 0 });
    expect($('[data-card-constant-count]').textContent).toContain(t('reviewLength.constantTotal', afterConstant));
    expect($('[data-section="worldbook"] [data-worldbook-total]').textContent).toContain(t('wb.totalChars', { n: '14' }));

    // 編輯人設達標：頂欄常駐字數即時更新並標示達標
    await type($('#f-detail'), '字'.repeat(2987));
    const met = counted({ persona: 2987, constantWorldbook: 14, total: 3001, required: 3001, remaining: 0, eligible: true, welcome: 0 });
    expect($('[data-card-constant-count]').textContent).toContain(t('reviewLength.constantTotal', met));
    expect($('[data-card-constant-count]').classList.contains('is-met')).toBe(true);
  });

  it('counts every bound Lorebook like review, with live edits replacing the current book', async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Multi', roleDetailDesc: '角色設定', roleWelcome: 'Opening' });
    api.fetchRoleWorldbooks.mockResolvedValueOnce([
      {worldbookId:'other',name:'Other',description:'',entryCount:1},
      {worldbookId:'wb-bound',name:'Current',description:'',entryCount:1},
    ]);
    for(let i=0;i<2;i++) api.fetchWorldbookEntries.mockImplementationOnce(async(id) => [{entryId:id+'-entry',name:id==='other'?'Other':'Current',content:'字'.repeat(id==='other'?10:20),keywords:[],secondaryKeywords:[],isEnabled:true,isConstant:true}]);
    await mount('/cards/r1/edit');
    const expectTotal = (total:number) => expect($('[data-card-constant-count]').textContent).toContain(t('reviewLength.constantTotal', {total:String(total)}));
    expectTotal(34);
    expect($('[data-worldbook-total]').textContent).toContain(t('wb.totalChars', {n:'20'}));
    await openEntries();
    await type($d('#wbd-content'), '字'.repeat(25));
    expectTotal(39);
    const constant = $d<HTMLInputElement>('.wbd__recall input[type="checkbox"]');
    constant.checked=false; constant.dispatchEvent(new Event('change')); await flush();
    expectTotal(14);
  });

  it('omits the submission threshold in the top bar when the card is exempt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: true })));
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Exempt card', roleDetailDesc: '角色設定', roleWelcome: 'Opening' });
    await mount('/cards/r1/edit');
    const topBar = $('[data-card-constant-count]');
    const params = counted({ persona: 4, constantWorldbook: 4, total: 8, required: 3001, remaining: 2993, eligible: false, welcome: 0 });
    expect(topBar.textContent).toContain(t('reviewLength.constantTotal', params));
    expect(topBar.textContent).toContain(t('lengthExemption.enabled'));
    expect(topBar.textContent).not.toContain(t('reviewLength.threshold', params));
  });

  it('does not show a count while the Lorebook it depends on is unavailable', async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Count', roleDetailDesc: '設定', roleWelcome: 'Opening' });
    api.fetchWorldbookEntries.mockRejectedValueOnce(new Error('unavailable'));
    await mount('/cards/r1/edit');
    expect(root.querySelector('[data-review-count]')).toBeNull();
    expect(root.querySelector('[data-card-constant-count]')).toBeNull();
    expect(root.querySelector('[data-worldbook-total]')).toBeNull();
  });
});

it('blocks all draft writes when a world character Lorebook failed to load', async () => {
  api.fetchRoleDetail.mockResolvedValueOnce({roleName:'World',world:{version:1,maxSpeakers:2,strictness:'balanced',characters:[{id:'ren',name:'Ren',profile:'',description:'A synthetic character',lorebookId:'member-book'}]}});
  api.fetchWorldbookEntries.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('unavailable'));
  await mount('/cards/r1/edit');
  await type($("#f-name"), 'Changed world');
  await submit();
  expect(api.beginCardEdit).not.toHaveBeenCalled();
  expect(api.patchRoleDocument).not.toHaveBeenCalled();
  expect(api.patchWorldbookDocument).not.toHaveBeenCalled();
  expect(root.querySelector('.world-char__book [role="alert"]')?.textContent).toContain(i18n.global.t('state.loadFailed'));
});

it('lets the author save an unchanged draft to retire an unfinished publication',async()=>{
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'合成草稿',roleDetailDesc:'合成設定',roleWelcome:'合成開場',language:'zh-Hant'});
 localStorage.setItem('hearthroom:publication:harbor:r1','fixture-unfinished-operation');
 try{
  await mount('/cards/r1/edit');
  const save=$<HTMLButtonElement>('.bar button[type=submit]');
  expect(save.disabled).toBe(false);
  save.click();await flush();
  expect(api.beginCardEdit).toHaveBeenCalled();
 }finally{localStorage.removeItem('hearthroom:publication:harbor:r1');}
});
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
 api.fetchCardDeletion.mockResolvedValue({deletion:null});
  ratingState.current = null;
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

describe('new-card author-asset draft recovery', () => {
  const ruleFile = (replace = 'Retained replacement') => new File([JSON.stringify({
    beginning: 'recovery-marker', statusbar: 'recovery-marker', pageDepth: 1,
    regex_scripts: [{ id: 'recovery', scriptName: 'Retained rule', findRegex: 'recovery-marker', replaceString: replace }],
  })], 'recovery.json');
  async function reopen() {
    app!.unmount(); root.remove();
    await mount('/create');
  }

  it('autosaves rules even when only rules changed and restores them', async () => {
    await mount('/create');
    await type($('#f-name'), 'Recovery fixture');
    await new Promise(r => setTimeout(r, 450));
    await pickFile($('.rxbar input[type=file]'), ruleFile());
    await new Promise(r => setTimeout(r, 450));
    // Read before unmount: beforeunload must not be the only protection.
    expect(JSON.parse(localStorage.getItem('hearthroom.draft.create')!).authorAsset.set.rules[0].replace).toBe('Retained replacement');
    await reopen();
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledWith('r1', expect.objectContaining({
      version: 0, mountTrigger: 'recovery-marker', mountLayer: 'under',
      rules: [expect.objectContaining({ name: 'Retained rule', replace: 'Retained replacement' })],
    }), 'tok');
  });

  it('retains the acknowledged version and later rule edits when a later save step fails', async () => {
    await mount('/create'); await type($('#f-name'), 'Partial recovery');
    await pickFile($('.rxbar input[type=file]'), ruleFile());
    api.patchRoleWelcome.mockRejectedValueOnce(new Error('synthetic welcome failure'));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[role=alert]')?.textContent).toContain('synthetic welcome failure');
    await pickFile($('.rxbar input[type=file]'), ruleFile('Edited after partial save'));
    await new Promise(r => setTimeout(r, 450));
    expect(JSON.parse(localStorage.getItem('hearthroom.draft.create')!).authorAsset.set.rules[0].replace,
      root.querySelector('[role=alert]')?.textContent ?? '').toBe('Edited after partial save');
    await reopen();
    expect(JSON.parse(localStorage.getItem('hearthroom.draft.create')!).authorAsset.version).toBe(1);
    expect(JSON.parse(localStorage.getItem('hearthroom.draft.create')!).authorAsset.set.rules[0].replace).toBe('Edited after partial save');
    await submit();
    expect(root.querySelector('.body__scroll > .notice--error')).toBeNull();
    expect(api.createRole).toHaveBeenCalledTimes(1);
    expect(api.saveAuthorAsset).toHaveBeenLastCalledWith('r1', expect.objectContaining({
      version: 1, rules: [expect.objectContaining({ replace: 'Edited after partial save' })],
    }), 'tok');
    expect(localStorage.getItem('hearthroom.draft.create')).toBeNull();
  });

  it('loads the saved asset for legacy partial drafts rather than overwriting it with an empty version zero', async () => {
    localStorage.setItem('hearthroom.draft.create', JSON.stringify({
      draft: { ...makeDraft('zh-Hant'), roleName: 'Legacy partial', roleWelcome: 'Opening' },
      tagsText: '', worldbook: null, pendingCreate: { roleId: 'r1' }, savedAt: Date.now(),
    }));
    api.fetchAuthorAsset.mockResolvedValueOnce({ rules: [{ id: 'remote', name: 'Saved rule', find: 'x', replace: 'Saved replacement', enabled: true }],
      mountTrigger: 'x', mountLayer: 'over', pageMode: 'sandbox', status: 'none', version: 7 });
    await mount('/create');
    expect(api.fetchAuthorAsset).toHaveBeenCalledWith('r1', 'tok');
    await submit();
    expect(api.saveAuthorAsset).not.toHaveBeenCalled();
    await pickFile($('.rxbar input[type=file]'), ruleFile('After legacy recovery'));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenLastCalledWith('r1', expect.objectContaining({ version: 7 }), 'tok');
  });

  it('preserves a rejected local rule and expected version across reload without overwriting a concurrent revision', async () => {
    await mount('/create'); await type($('#f-name'), 'Conflict recovery');
    await pickFile($('.rxbar input[type=file]'), ruleFile());
    const { ApiError } = await import('../src/lib/api');
    api.saveAuthorAsset.mockRejectedValueOnce(new ApiError(409, 'version_conflict', 'version_conflict'));
    await submit(); await reopen();
    api.saveAuthorAsset.mockRejectedValueOnce(new ApiError(409, 'version_conflict', 'version_conflict'));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenLastCalledWith('r1', expect.objectContaining({
      version: 0, rules: [expect.objectContaining({ replace: 'Retained replacement' })],
    }), 'tok');
    expect(JSON.parse(localStorage.getItem('hearthroom.draft.create')!).authorAsset.version).toBe(0);
    expect(api.createRole).toHaveBeenCalledTimes(1);
  });

  it('retains an author-asset-only draft and clears its rules and version when discarded', async () => {
    await mount('/create');
    await pickFile($('.rxbar input[type=file]'), ruleFile());
    await new Promise(r => setTimeout(r, 450));
    await reopen();
    expect(root.textContent).toContain('已恢復上次沒儲存的草稿');
    byText('清空重來').click(); await flush();
    await type($('#f-name'), 'Fresh after discard');
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledWith('r1', expect.objectContaining({ version: 0, rules: [], mountTrigger: '', pageMode: 'sandbox' }), 'tok');
  });

  it('does not write defaults after a legacy partial asset read fails and preserves a later import on retry', async () => {
    localStorage.setItem('hearthroom.draft.create', JSON.stringify({
      draft: { ...makeDraft('zh-Hant'), roleName: 'Read recovery', roleWelcome: 'Opening' },
      tagsText: '', worldbook: null, pendingCreate: { roleId: 'r1' }, savedAt: Date.now(),
    }));
    api.fetchAuthorAsset.mockRejectedValueOnce(new Error('synthetic unavailable'));
    await mount('/create');
    api.fetchAuthorAsset.mockRejectedValueOnce(new Error('synthetic unavailable'));
    await submit();
    expect(api.beginCardEdit).not.toHaveBeenCalled();
    expect(api.patchRoleDocument).not.toHaveBeenCalled();
    expect(api.saveAuthorAsset).not.toHaveBeenCalled();
    await pickFile($('.rxbar input[type=file]'), ruleFile('Imported while offline'));
    await new Promise(r => setTimeout(r, 450));
    api.fetchAuthorAsset.mockResolvedValueOnce({ rules: [], mountTrigger: '', mountLayer: 'over', pageMode: 'sandbox', status: 'none', version: 4 });
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledWith('r1', expect.objectContaining({
      version: 4, rules: [expect.objectContaining({ replace: 'Imported while offline' })],
    }), 'tok');
  });

  it('keeps rule input entered while a pending asset read is in flight', async () => {
    localStorage.setItem('hearthroom.draft.create', JSON.stringify({
      draft: { ...makeDraft('zh-Hant'), roleName: 'Delayed read', roleWelcome: 'Opening' },
      tagsText: '', worldbook: null, pendingCreate: { roleId: 'r1' }, savedAt: Date.now(),
    }));
    api.fetchAuthorAsset.mockRejectedValueOnce(new Error('synthetic unavailable'));
    await mount('/create');
    await pickFile($('.rxbar input[type=file]'), ruleFile('Before read'));
    await new Promise(r => setTimeout(r, 450));
    let complete!: (value: any) => void;
    api.fetchAuthorAsset.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await submit();
    await pickFile($('.rxbar input[type=file]'), ruleFile('During read'));
    await new Promise(r => setTimeout(r, 450));
    complete({ rules: [], mountTrigger: '', mountLayer: 'over', pageMode: 'sandbox', status: 'none', version: 4 });
    await flush(); await flush();
    expect(api.saveAuthorAsset).toHaveBeenCalledWith('r1', expect.objectContaining({
      version: 4, rules: [expect.objectContaining({ replace: 'During read' })],
    }), 'tok');
  });

  it.each([true, false])('reconciles a lost write acknowledgement only when the remote asset matches: %s', async matching => {
    await mount('/create'); await type($('#f-name'), 'Lost acknowledgement');
    await pickFile($('.rxbar input[type=file]'), ruleFile('Submitted replacement'));
    await new Promise(r => setTimeout(r, 450));
    api.saveAuthorAsset.mockImplementationOnce(async (_id, body) => {
      const saved = { ...body, status: 'none', version: 1 } as any;
      if (!matching) saved.rules = [{ ...saved.rules[0], replace: 'A different revision' }];
      api.fetchAuthorAsset.mockResolvedValueOnce(saved);
      throw new TypeError('synthetic lost acknowledgement');
    });
    await submit(); await reopen();
    expect(api.fetchAuthorAsset).toHaveBeenCalledWith('r1', 'tok');
    await submit();
    expect(api.createRole).toHaveBeenCalledTimes(1);
    if (matching) {
      expect(api.saveAuthorAsset).toHaveBeenCalledTimes(1);
      expect(api.patchRoleWelcome).toHaveBeenCalled();
      expect(localStorage.getItem('hearthroom.draft.create')).toBeNull();
    } else {
      expect(api.saveAuthorAsset).toHaveBeenLastCalledWith('r1', expect.objectContaining({
        version: 0, rules: [expect.objectContaining({ replace: 'Submitted replacement' })],
      }), 'tok');
    }
  });
});

describe('bounded author workspace scrolling', () => {
  it.each([114, 230, 160])('keeps a settled anchor and manual adjacent sections aligned at viewport top %i', async (top) => {
    await mount('/create');
    const viewport = $('.body__scroll') as HTMLElement;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 297 },
      scrollHeight: { configurable: true, value: 9000 },
      scrollTop: { configurable: true, value: 5800 },
    });
    viewport.style.scrollPaddingTop = '8px';
    viewport.getBoundingClientRect = () => ({ top }) as DOMRect;
    $('.side').getBoundingClientRect = () => ({ bottom: top - 8 }) as DOMRect;
    let destination = 'publish';
    const keys = ['basic', 'persona', 'opening', 'worldbook', 'display', 'advanced', 'publish'];
    root.querySelectorAll<HTMLElement>('[data-section]').forEach(el => {
      el.style.scrollMarginTop = '8px';
      el.getBoundingClientRect = () => ({ top: top + 16 + (keys.indexOf(el.dataset.section!) - keys.indexOf(destination)) * 500 }) as DOMRect;
    });
    const now = Date.now();
    byText(i18n.global.t('editor.section.publish')).click();
    vi.spyOn(Date, 'now').mockReturnValue(now + 1600);
    for (const key of ['publish', 'worldbook', 'opening', 'publish']) {
      destination = key;
      viewport.dispatchEvent(new Event('scroll'));
      await new Promise(r => setTimeout(r, 40));
      await nextTick();
      expect($('.side__item[aria-current=true]').textContent).toContain(i18n.global.t(`editor.section.${key}`));
    }
  });
  it('tracks the last section from the form viewport instead of document scroll', async () => {
    await mount('/create');
    const viewport = root.querySelector<HTMLElement>('.body__scroll');
    expect(viewport, 'the form viewport stays separate from persistent actions').not.toBeNull();
    Object.defineProperties(viewport!, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 900 },
      scrollTop: { configurable: true, value: 600 },
    });
    root.querySelector('.side')!.getBoundingClientRect = () => ({ bottom: 100 }) as DOMRect;
    root.querySelectorAll<HTMLElement>('[data-section]').forEach(e => {
      e.getBoundingClientRect = () => ({ top: 200 }) as DOMRect;
    });
    viewport!.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 40));
    await nextTick();
    expect(root.querySelector('.side__item[aria-current=true]')?.textContent).toContain(i18n.global.t('editor.section.publish'));
  });
});

describe('mobile editor tool dialog', () => {
  it('isolates the background and returns focus after Escape without changing the form', async () => {
    await mount('/create');
    root.id = 'app';
    const input = root.querySelector<HTMLInputElement>('#f-name')!;
    input.value = 'Retained while using tools';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const opener = root.querySelector<HTMLButtonElement>('.bar__panel')!;
    opener.focus(); opener.click(); await flush();
    const sheet = document.querySelector<HTMLElement>('.rail--sheet')!;
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.getAttribute('aria-label')).toBe(i18n.global.t('editor.test.title'));
    expect(sheet.closest('#app')).toBeNull();
    expect(root.inert).toBe(true);
    expect(sheet.contains(document.activeElement)).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }));
    await flush();
    expect(api.createRole).not.toHaveBeenCalled();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    expect(document.querySelector('.rail--sheet')).toBeNull();
    expect(root.inert).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(input.value).toBe('Retained while using tools');
  });

  it('lets the chat iframe consume Escape before closing the outer sheet', async () => {
    await mount('/cards/r1/edit'); root.id = 'app';
    const opener = root.querySelector<HTMLButtonElement>('.bar__panel')!;
    opener.focus(); opener.click(); await flush();
    const frame = document.querySelector<HTMLIFrameElement>('.rail--sheet iframe')!;
    const doc = frame.contentDocument!;
    doc.body.innerHTML = '<button>Inner tool</button>';
    doc.addEventListener('keydown', event => event.preventDefault(), { once: true });
    doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    expect(document.querySelector('.rail--sheet')).not.toBeNull();
    doc.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    expect(document.querySelector('.rail--sheet')).toBeNull();
    expect(root.inert).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('restores focus on Close and removes background isolation on unmount', async () => {
    await mount('/create'); root.id = 'app';
    const opener = root.querySelectorAll<HTMLButtonElement>('.bar__panel')[1];
    opener.focus(); opener.click(); await flush();
    document.querySelector<HTMLButtonElement>('[data-sheet-close]')!.click(); await flush();
    expect(root.inert).toBe(false);
    expect(document.activeElement).toBe(opener);
    opener.click(); await flush(); expect(root.inert).toBe(true);
    app!.unmount(); app = null;
    expect(root.inert).toBe(false);
  });

  it('returns focus to the desktop tool tab when resizing hides the mobile opener', async () => {
    localStorage.setItem('hearthroom.editor.panel', 'closed');
    await mount('/create'); root.id = 'app';
    const opener = root.querySelectorAll<HTMLButtonElement>('.bar__panel')[1];
    opener.focus(); opener.click(); await flush();
    // Happy DOM has no responsive layout: model display:none rejecting focus.
    vi.spyOn(opener, 'focus').mockImplementation(() => {});
    vi.stubGlobal('innerWidth', 1440);
    window.dispatchEvent(new Event('resize')); await flush();
    const desktopTool = [...root.querySelectorAll<HTMLButtonElement>('.rail__tabs [role=tab]')]
      .find(button => button.textContent?.includes(i18n.global.t('editor.panel.resources')))!;
    expect(document.querySelector('.rail--sheet')).toBeNull();
    expect(root.inert).toBe(false);
    expect(document.activeElement).toBe(desktopTool);
    expect(root.querySelector('.rail--wide')).toBeNull();
  });
});

describe("正則匯入的聊天頁模式", () => {
  const oldMmd = { beginning: "<identity>", statusbar: "<theme>", regex_scripts: [{ scriptName: "theme", findRegex: "<theme>", replaceString: "<style>body{color:red}</style>", placement: [2] }] };

  it.each(["sandbox", "classic", "immersive"])("已存 %s 卡重匯未指定模式的舊檔，沿用模式並保存完整新規則", async (pageMode) => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Local fixture", roleWelcome: "Existing opening" });
    api.fetchAuthorAsset.mockResolvedValueOnce({ rules: [], mountTrigger: "", mountLayer: "over", pageMode, status: "passed", version: 7 });
    await mount("/cards/r1/edit");
    await pickFile($(".rxbar input[type=file]"), new File([JSON.stringify(oldMmd)], "old-mmd.json"));
    expect($(".chatpage [aria-checked=true]").textContent?.trim()).toBe(i18n.global.t(pageMode === "sandbox" ? "editor.chatPage.sandbox" : "editor.chatPage.classic"));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledWith("r1", expect.objectContaining({ pageMode, version: 7, mountTrigger: "<theme>", rules: [expect.objectContaining({ name: "theme", find: "<theme>", replace: oldMmd.regex_scripts[0].replaceString })] }), "tok");
    expect($<HTMLTextAreaElement>("#f-welcome").value).toBe("Existing opening");
  });

  it("已存的首屏網頁與風月格式：重匯一份規則檔後照樣存回去，不會被洗掉", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Local fixture", roleWelcome: "", rolePrologue: ["我推開門。"] });
    api.fetchAuthorAsset.mockResolvedValueOnce({ rules: [], mountTrigger: "", mountLayer: "over", pageMode: "sandbox", cardFormat: "fengyue", openingPage: "<div>首屏</div>", status: "passed", version: 3 });
    await mount("/cards/r1/edit");
    expect($<HTMLTextAreaElement>("#f-opening-page").value).toBe("<div>首屏</div>");
    await pickFile($(".rxbar input[type=file]"), new File([JSON.stringify(oldMmd)], "old-mmd.json"));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledWith("r1", expect.objectContaining({ openingPage: "<div>首屏</div>", cardFormat: "fengyue", version: 3 }), "tok");
  });

  it("新卡首次匯入無 chatVersion 的舊檔預設傳統頁（B120），保存後重匯也保持傳統頁；帶 chatVersion: 1 則為沙箱", async () => {
    await mount("/create");
    await type($("#f-name"), "Local fixture");
    await pickFile($(".rxbar input[type=file]"), new File([JSON.stringify(oldMmd)], "old-mmd.json"));
    expect($(".chatpage [aria-checked=true]").textContent?.trim()).toBe(i18n.global.t("editor.chatPage.classic"));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenLastCalledWith("r1", expect.objectContaining({ pageMode: "classic", version: 0 }), "tok");
    const changed = { ...oldMmd, regex_scripts: [{ ...oldMmd.regex_scripts[0], replaceString: "<style>body{color:blue}</style>" }] };
    await pickFile($(".rxbar input[type=file]"), new File([JSON.stringify(changed)], "updated-mmd.json"));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenLastCalledWith("r1", expect.objectContaining({ pageMode: "classic", version: 1 }), "tok");
  });

  it("新卡首次匯入 chatVersion: 1 檔案設為沙箱，保存後重匯未指定模式的更新檔也保持沙箱", async () => {
    await mount("/create");
    await type($("#f-name"), "Local fixture");
    await pickFile($(".rxbar input[type=file]"), new File([JSON.stringify({ chatVersion: 1, ...oldMmd })], "sandbox-mmd.json"));
    expect($(".chatpage [aria-checked=true]").textContent?.trim()).toBe(i18n.global.t("editor.chatPage.sandbox"));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenLastCalledWith("r1", expect.objectContaining({ pageMode: "sandbox", version: 0 }), "tok");
    const changed = { ...oldMmd, regex_scripts: [{ ...oldMmd.regex_scripts[0], replaceString: "<style>body{color:blue}</style>" }] };
    await pickFile($(".rxbar input[type=file]"), new File([JSON.stringify(changed)], "updated-mmd.json"));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenLastCalledWith("r1", expect.objectContaining({ pageMode: "sandbox", version: 1 }), "tok");
  });

  it.each(["sandbox", "classic"])("檔案明確指定 %s 時採用該模式", async (pageMode) => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Local fixture" });
    api.fetchAuthorAsset.mockResolvedValueOnce({ rules: [], mountTrigger: "", mountLayer: "over", pageMode: pageMode === "sandbox" ? "classic" : "sandbox", status: "passed", version: 2 });
    await mount("/cards/r1/edit");
    await pickFile($(".rxbar input[type=file]"), new File([JSON.stringify({ version: 1, pageMode, rules: [{ find: "x", replace: "y" }] })], "explicit.json"));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledWith("r1", expect.objectContaining({ pageMode, version: 2 }), "tok");
  });
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
    // 直式、橫式、分享圖三格
    expect(root.querySelectorAll(".frame")).toHaveLength(3);
    const file = new File(["GIF89a synthetic animation bytes"], "new.gif", { type: "image/gif" });
    await pickFile(field.querySelector("input[type=file]")!, file);
    expect(api.uploadImage).toHaveBeenCalledWith(file, "tok", "r1");
    expect(field.querySelector("img")?.getAttribute("src")).toBe(avatar);
    expect(root.querySelector(`img[src="${background}"]`)).toBeNull();
    expect(root.querySelector(`img[src="${landscape}"]`)).not.toBeNull();
    await submit();
    expect(api.patchRoleDocument).toHaveBeenCalledWith("r1", { roleBackground: avatar, roleAvatar: avatar }, "tok");
  });

  it("直式與橫式旁可以直接生成：預選直圖／橫圖尺寸、描述帶卡名與簡介，挑中那張才存進卡名資料夾並填進欄位", async () => {
    gen.imageGen = { access: "ready", models: [{ id: "gpt-image-2-dawn", name: "GPT Image 2", credits: 35, priced: 1, sizes: ["1024x1024", "1024x1536", "1536x1024"], maxImages: 2 }] };
    gen.create.mockImplementation(async (input: { size: string }) => ({ id: input.size === "1024x1536" ? "3f2a9c1e-tall" : "77aa00bb-wide", status: "queued", urls: [], saved: [] }));
    gen.wait.mockImplementation(async (t: { id: string }) => ({ id: t.id, status: "completed", urls: [`https://gen.test/${t.id}.png`], saved: [""] }));
    gen.save.mockImplementation(async (id: string) => [{ index: 0, assetId: `asset-${id}`, url: `https://assets.test/Mira/${id}.png` }]);
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Mira", roleDesc: "A lighthouse keeper.", roleDetailDesc: "Synthetic settings" });
    try {
      await mount("/cards/r1/edit");
      const fieldOf = (key: string) => [...root.querySelectorAll(".field")].find((el) => el.querySelector("label")?.textContent === i18n.global.t(key))!;
      const generate = i18n.global.t("editor.image.generate");
      const dialog = () => document.querySelector<HTMLFormElement>('[aria-labelledby="gen-title"]');
      const pick = async (n: number) => {
        dialog()!.querySelectorAll<HTMLButtonElement>(".gen__choice")[n]!.click();
        await flush();
      };

      btnIn(fieldOf("editor.background"), generate).click();
      await flush();
      const box = dialog()!;
      const [, size] = box.querySelectorAll("select");
      expect((size as HTMLSelectElement).value).toBe("1024x1536");
      const prompt = box.querySelector("textarea")!;
      expect(prompt.value).toContain("Mira");
      expect(prompt.value).toContain("A lighthouse keeper.");
      // 作者可以改描述
      await type(prompt, "Mira on the cliff at dusk");
      box.dispatchEvent(new Event("submit", { cancelable: true }));
      await flush();
      expect(gen.create).toHaveBeenCalledWith({ model: "gpt-image-2-dawn", prompt: "Mira on the cliff at dusk", size: "1024x1536", n: 1 }, expect.any(String));
      // 先看再存：生成好還沒進資源庫
      expect(gen.save).not.toHaveBeenCalled();
      expect(dialog()!.querySelector(".gen__choice img")?.getAttribute("src")).toBe("https://gen.test/3f2a9c1e-tall.png");
      await pick(0);
      expect(gen.save).toHaveBeenCalledWith("3f2a9c1e-tall", { directory: "Mira" }, [{ index: 0 }]);
      expect(dialog()).toBeNull();
      expect(fieldOf("editor.background").querySelector("img")?.getAttribute("src")).toBe("https://assets.test/Mira/3f2a9c1e-tall.png");

      btnIn(fieldOf("editor.backgroundLandscape"), generate).click();
      await flush();
      expect((dialog()!.querySelectorAll("select")[1] as HTMLSelectElement).value).toBe("1536x1024");
      dialog()!.dispatchEvent(new Event("submit", { cancelable: true }));
      await flush();
      await pick(0);
      expect(fieldOf("editor.backgroundLandscape").querySelector("img")?.getAttribute("src")).toBe("https://assets.test/Mira/77aa00bb-wide.png");

      await submit();
      expect(api.patchRoleDocument).toHaveBeenCalledWith("r1", {
        roleBackground: "https://assets.test/Mira/3f2a9c1e-tall.png",
        roleAvatar: "https://assets.test/Mira/3f2a9c1e-tall.png",
        roleBackgroundLandscape: "https://assets.test/Mira/77aa00bb-wide.png",
      }, "tok");
    } finally {
      gen.imageGen = null;
      gen.create.mockReset();
      gen.wait.mockReset();
      gen.save.mockReset();
    }
  });

  it("一次生成兩張：只存挑中的那張；按 Esc 一張都不存，圖片留在生圖頁", async () => {
    gen.imageGen = { access: "ready", models: [{ id: "m", name: "M", credits: 35, priced: 1, sizes: ["1024x1536"], maxImages: 2 }] };
    gen.create.mockResolvedValue({ id: "a1b2c3d4-two", status: "completed", urls: ["https://gen.test/1.png", "https://gen.test/2.png"], saved: ["", ""] });
    gen.save.mockResolvedValue([{ index: 1, assetId: "asset-2", url: "https://assets.test/Mira/2.png" }]);
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Mira", roleDesc: "", roleDetailDesc: "Synthetic settings" });
    try {
      await mount("/cards/r1/edit");
      const field = () => [...root.querySelectorAll(".field")].find((el) => el.querySelector("label")?.textContent === i18n.global.t("editor.background"))!;
      const dialog = () => document.querySelector<HTMLFormElement>('[aria-labelledby="gen-title"]');
      const generateOnce = async () => {
        btnIn(field(), i18n.global.t("editor.image.generate")).click();
        await flush();
        const count = dialog()!.querySelectorAll("select")[2] as HTMLSelectElement;
        count.value = "2";
        count.dispatchEvent(new Event("change"));
        await flush();
        dialog()!.dispatchEvent(new Event("submit", { cancelable: true }));
        await flush();
      };
      await generateOnce();
      expect(gen.create).toHaveBeenLastCalledWith(expect.objectContaining({ n: 2 }), expect.any(String));
      const choices = [...dialog()!.querySelectorAll<HTMLButtonElement>(".gen__choice")];
      expect(choices.map((b) => b.querySelector("img")?.getAttribute("src"))).toEqual(["https://gen.test/1.png", "https://gen.test/2.png"]);
      expect(dialog()!.textContent).toContain(i18n.global.t("resource.gen.choose", { folder: "Mira" }));
      choices[1]!.click();
      await flush();
      expect(gen.save).toHaveBeenCalledWith("a1b2c3d4-two", { directory: "Mira" }, [{ index: 1 }]);
      expect(dialog()).toBeNull();
      expect(field().querySelector("img")?.getAttribute("src")).toBe("https://assets.test/Mira/2.png");

      // 再生一次，按 Esc 關掉：一張都不存、欄位不動，狀態列說圖片在生圖頁
      gen.save.mockClear();
      await generateOnce();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await flush();
      expect(dialog()).toBeNull();
      expect(gen.save).not.toHaveBeenCalled();
      expect(field().querySelector("img")?.getAttribute("src")).toBe("https://assets.test/Mira/2.png");
      expect(root.querySelector(".editor-status")?.textContent).toBe(i18n.global.t("editor.image.kept"));
    } finally {
      gen.imageGen = null;
      gen.create.mockReset();
      gen.save.mockReset();
    }
  });

  it("生成中離開編輯器不攔：結果留在生圖頁的生成紀錄裡，拿得回來", async () => {
    gen.imageGen = { access: "ready", models: [{ id: "m", name: "M", credits: 35, priced: 1, sizes: ["1024x1536"], maxImages: 1 }] };
    gen.create.mockResolvedValue({ id: "a1b2c3d4-slow", status: "queued", urls: [], saved: [] });
    gen.wait.mockImplementation(() => new Promise(() => {}));
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Mira", roleDesc: "", roleDetailDesc: "Synthetic settings" });
    try {
      await mount("/cards/r1/edit");
      const field = () => [...root.querySelectorAll(".field")].find((el) => el.querySelector("label")?.textContent === i18n.global.t("editor.background"))!;
      btnIn(field(), i18n.global.t("editor.image.generate")).click();
      await flush();
      document.querySelector<HTMLFormElement>('[aria-labelledby="gen-title"]')!.dispatchEvent(new Event("submit", { cancelable: true }));
      await flush();
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
      await router.push("/mine");
      await flush();
      expect(confirmState.current).toBeFalsy();
      expect(router.currentRoute.value.path).toBe("/mine");
    } finally {
      gen.imageGen = null;
      gen.create.mockReset();
      gen.wait.mockReset();
    }
  });

  it("還沒有卡名就不生成：圖片要放進卡名資料夾", async () => {
    gen.imageGen = { access: "ready", models: [{ id: "m", name: "M", credits: 35, priced: 1, sizes: ["1024x1024"], maxImages: 1 }] };
    try {
      await mount("/create");
      const field = [...root.querySelectorAll(".field")].find((el) => el.querySelector("label")?.textContent === i18n.global.t("editor.background"))!;
      btnIn(field, i18n.global.t("editor.image.generate")).click();
      await flush();
      expect(document.querySelector('[aria-labelledby="gen-title"]')).toBeNull();
      expect(root.querySelector(".editor-status")?.textContent).toBe(i18n.global.t("editor.image.generateNeedsName"));
    } finally {
      gen.imageGen = null;
    }
  });

  it("分享圖是選填的第三格：讀得到上游的值，提示寫明 1200×630 與構圖，改了才送", async () => {
    const share = "https://assets.harbor.ai/u/test/share.png";
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "Share test", roleBackground: "https://assets.harbor.ai/u/test/bg.png", roleShareImage: share });
    await mount("/cards/r1/edit");
    const field = [...root.querySelectorAll(".field")].find((el) => el.querySelector("label")?.textContent === i18n.global.t("editor.shareImage"))!;
    expect(field).toBeDefined();
    expect(field.querySelector("img")?.getAttribute("src")).toBe(share);
    expect(field.textContent).toContain(i18n.global.t("editor.shareImage.hint"));
    expect(i18n.global.t("editor.shareImage.hint")).toContain("1200×630");
    const picked = "https://assets.harbor.ai/u/test/share2.png";
    api.uploadImage.mockResolvedValueOnce(picked);
    await pickFile(field.querySelector("input[type=file]")!, new File(["png"], "share2.png", { type: "image/png" }));
    await submit();
    expect(api.patchRoleDocument).toHaveBeenCalledWith("r1", { roleShareImage: picked }, "tok");
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

    expect(api.createRole).toHaveBeenCalledWith({ roleName: "阿芙拉", language: "zh-Hant", visibility: "unlisted" }, "tok");
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
    expect((asset as { pageMode?: string }).pageMode).toBe("classic");
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

  it("條目超過上限（中文卡 4000）：送出前就攔下並點名那一條，一個請求都不打", async () => {
    await mount("/create");
    await pickFile($("input[type=file]"), new File([JSON.stringify(CARD)], "avra.json"));
    byText("套用到表單").click();
    await flush();
    byText("世界書").click();
    await flush();
    await openEntries();
    await pickEntry(0);
    await type($d<HTMLTextAreaElement>("#wbd-content"), "字".repeat(4001));
    btnIn($d(".wbd"), "編好了").click();
    await flush();
    await submit();
    expect($("[role=alert]").textContent).toContain("黑麥鎮");
    expect($("[role=alert]").textContent).toContain("4000");
    expect(api.createRole).not.toHaveBeenCalled();
    expect(api.patchWorldbookDocument).not.toHaveBeenCalled();
  });

  it("條目上限跟著卡的語區：英文卡收 12000、12001 才攔", async () => {
    await mount("/create");
    await pickFile($("input[type=file]"), new File([JSON.stringify(CARD)], "avra.json"));
    byText("套用到表單").click();
    await flush();
    const lang = $<HTMLSelectElement>("#f-lang");
    lang.value = "en";
    lang.dispatchEvent(new Event("change"));
    await flush();
    byText("世界書").click();
    await flush();
    await openEntries();
    await pickEntry(0);
    await type($d<HTMLTextAreaElement>("#wbd-content"), "a".repeat(12000));
    expect($d(".wbd .count").textContent).toContain("12000 / 12000");
    expect($d(".wbd .count").classList.contains("over")).toBe(false);
    await type($d<HTMLTextAreaElement>("#wbd-content"), "a".repeat(12001));
    expect($d(".wbd .count").classList.contains("over")).toBe(true);
    btnIn($d(".wbd"), "編好了").click();
    await flush();
    await submit();
    expect($("[role=alert]").textContent).toContain("12000");
    expect(api.createRole).not.toHaveBeenCalled();
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
    await pickFile($('[data-section="worldbook"] input[type=file]'), new File([JSON.stringify(info)], "eldoria.json"));
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
    await pickFile($('[data-section="worldbook"] input[type=file]'), new File([JSON.stringify(info)], "eldoria.json"));
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
    await pickFile($('[data-section="worldbook"] input[type=file]'), new File([JSON.stringify(info)], "eldoria.json"));
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
    visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({access:"public"})});
    await mount("/cards/r1/edit");
    expect(document.body.textContent).toContain(i18n.global.t("visibility.state.publicEditor"));
    api.unpublishRole.mockClear();
    api.patchRoleDocument.mockClear();
    const desc = $<HTMLTextAreaElement>("#f-desc");
    desc.value = "改過的簡介";
    desc.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    await submit();
    expect(api.unpublishRole).not.toHaveBeenCalled();
    expect(api.patchRoleDocument).toHaveBeenCalledTimes(1);
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
    visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({review:"pending"})});
    await mount("/cards/r2/edit");
    expect(document.body.textContent).toContain(i18n.global.t("visibility.state.pendingEditor"));
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
    await pickFile($('[data-section="worldbook"] input[type=file]'), new File([JSON.stringify({ entries })], "big.json"));
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

  it("清空帶有建卡編號的本機草稿後，儲存建立另一張卡，不覆寫舊卡", async () => {
    api.patchRoleDocument.mockRejectedValueOnce(new Error("儲存中斷"));
    await mount("/create");
    await type($("#f-name"), "先前未存完的卡");
    const visibility = $<HTMLSelectElement>("#new-card-visibility");
    visibility.value = "private";
    visibility.dispatchEvent(new Event("change"));
    await flush();
    await submit();
    expect(api.createRole).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("hearthroom.draft.create")!).pendingCreate).toEqual({ roleId: "r1" });
    expect(JSON.parse(localStorage.getItem("hearthroom.draft.create")!).visibility).toBe("private");
    app!.unmount();
    root.remove();

    await mount("/create");
    byText("清空重來").click();
    await flush();
    api.beginCardEdit.mockClear();
    api.patchRoleDocument.mockClear();
    api.createRole.mockResolvedValueOnce({ roleId: "r2" });
    await type($("#f-name"), "全新的卡");
    await submit();

    expect(api.createRole).toHaveBeenCalledTimes(2);
    expect(api.beginCardEdit).not.toHaveBeenCalled();
    expect(api.patchRoleDocument).toHaveBeenCalledWith("r2", expect.objectContaining({ roleName: "全新的卡" }), "tok");
    expect(api.patchRoleDocument.mock.calls.every(([id]) => id !== "r1")).toBe(true);
    expect(api.createRole).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: "unlisted" }), "tok");
  });

  it("新建入口恢復舊格式草稿只帶入內容，直接儲存不覆寫草稿裡的舊卡", async () => {
    localStorage.setItem("hearthroom.draft.create", JSON.stringify({
      draft: { ...makeDraft("zh-Hant"), roleName: "舊卡留下的草稿", roleDetailDesc: "原本的設定" },
      tagsText: "", worldbook: null, savedAt: Date.now(), roleId: "previous-card", visibility: "private",
    }));
    await mount("/create");
    expect(root.textContent).toContain("已恢復上次沒儲存的草稿");
    expect($<HTMLInputElement>("#f-name").value).toBe("舊卡留下的草稿");
    expect($<HTMLTextAreaElement>("#f-detail").value).toBe("原本的設定");
    await type($("#f-name"), "作者要新建的卡");
    await type($("#f-detail"), "新卡的設定");
    await submit();

    expect(api.createRole).toHaveBeenCalledTimes(1);
    expect(api.beginCardEdit).not.toHaveBeenCalled();
    expect(api.patchRoleDocument).toHaveBeenCalledWith("r1", expect.objectContaining({ roleName: "作者要新建的卡" }), "tok");
    expect(api.patchRoleDocument.mock.calls.every(([id]) => id !== "previous-card")).toBe(true);
    expect(api.createRole).toHaveBeenCalledWith(expect.objectContaining({ visibility: "private" }), "tok");
  });

  it("成功建卡後的未儲存修改不再回流到新卡本機草稿", async () => {
    await mount("/create");
    await type($("#f-name"), "已建立的卡");
    await submit();
    expect(window.location.pathname).toBe("/cards/100021/edit");
    await type($("#f-name"), "已建立卡的新修改");
    await new Promise((r) => setTimeout(r, 500));
    expect(localStorage.getItem("hearthroom.draft.create")).toBeNull();
    app!.unmount();
    root.remove();
    expect(localStorage.getItem("hearthroom.draft.create")).toBeNull();

    await mount("/create");
    expect($<HTMLInputElement>("#f-name").value).toBe("");
    expect(root.textContent).not.toContain("已恢復上次沒儲存的草稿");
  });

  it("刪卡：要照打角色名稱才准；確認 Provider 刪除成功後回到我的卡片", async () => {
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
    // 打對：使用已確認的收回金額交給 Worker，成功後回到 /mine?fresh=1
    settleConfirm(true, "阿芙拉");
    await flush(); await flush();
    expect(api.unregisterCard).not.toHaveBeenCalled();
    expect(api.deleteRole).toHaveBeenCalledWith("r1", "tok",0);
    expect(router.currentRoute.value.path).toBe("/mine");
    expect(router.currentRoute.value.query.fresh).toBe("1");
  });


  it.each([false,true])('領獎卡刪除前確認實際金額，失敗時保留編輯頁（失敗=%s）',async fail=>{
   api.fetchRoleDetail.mockResolvedValueOnce({roleName:'阿芙拉',roleDesc:'老闆娘'});
   visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({access:'public',actions:['submit_update'],rewardRetention:{publicUntil:'2030-11-25T14:30:00Z',days:7,recoveryCredits:13700}})});
   if(fail)api.deleteRole.mockRejectedValueOnce(new Error('積分不足，無法刪除'));
   await mount('/cards/r1/edit');byText('發布').click();await flush();btnIn(root,'刪除這張卡').click();await flush();
   expect(confirmState.current?.message).toContain('13,700');expect(confirmState.current?.message).toContain('2030');expect(confirmState.current?.message).toContain('7 天');
   expect(confirmState.current?.confirmText).toBe('刪除並退回獎勵');expect(confirmState.current?.cancelText).toBe('保留卡片');
   expect(api.deleteRole).not.toHaveBeenCalled();settleConfirm(true,'阿芙拉');await flush();await flush();
   expect(api.deleteRole).toHaveBeenCalledWith('r1','tok',13700);expect(api.unregisterCard).not.toHaveBeenCalled();
   expect(router.currentRoute.value.path).toBe(fail?'/cards/r1/edit':'/mine');if(fail)expect(root.textContent).toContain('積分不足，無法刪除');
  });


  it('reload completes the saved deletion before querying the missing source or showing a new confirmation',async()=>{
   api.fetchCardDeletion.mockResolvedValueOnce({deletion:{sourceRoleId:'r1',rewardRecoveryCredits:13700,state:'confirmed'}});
   await mount('/cards/r1/edit');await flush();await flush();
   expect(api.deleteRole).toHaveBeenCalledWith('r1','tok',13700);expect(api.fetchRoleDetail).not.toHaveBeenCalled();expect(confirmState.current).toBeNull();expect(router.currentRoute.value.path).toBe('/mine');
  });

  it.each(['積分不足，需要13700，可用300，尚差13400，可稍後刪除','服務暫時無法回應'])('刪卡失敗在操作旁聚焦並立即帶入視野，保留未儲存內容：%s',async message=>{
   api.fetchRoleDetail.mockResolvedValueOnce({roleName:'阿芙拉',roleDesc:'老闆娘'});
   await mount('/cards/r1/edit');
   await type($<HTMLInputElement>('#f-name'),'保留輸入驗證');
   const scroll=vi.spyOn(HTMLElement.prototype,'scrollIntoView');
   for(let attempt=0;attempt<2;attempt++){
    api.deleteRole.mockRejectedValueOnce(new Error(message));
    btnIn(root,'刪除這張卡').click();await flush();settleConfirm(true,'保留輸入驗證');await flush();await flush();
    const alert=root.querySelector<HTMLElement>('.panel--danger [role=alert]');
    expect(alert?.textContent).toContain(message);
    expect(document.activeElement).toBe(alert);
    expect(scroll.mock.instances.at(-1)).toBe(alert);
    expect(scroll).toHaveBeenLastCalledWith({block:'center',behavior:'instant'});
    expect(root.querySelectorAll('.panel--danger [role=alert]')).toHaveLength(1);
    expect([...root.querySelectorAll('[role=alert]')].filter(el=>el.textContent?.includes(message))).toHaveLength(1);
    expect($<HTMLInputElement>('#f-name').value).toBe('保留輸入驗證');
    expect(router.currentRoute.value.path).toBe('/cards/r1/edit');
    document.activeElement instanceof HTMLElement&&document.activeElement.blur();
   }
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
 const publicOption=root.querySelector<HTMLInputElement>('input[value=public]')!;publicOption.click();await flush();root.querySelector<HTMLButtonElement>('[data-visibility-apply]')!.click();await flush();
 expect(root.querySelector('.platform-dialog')).toBeNull();
 // 先填分級問卷（沒填過就從頭來），再確認送審
 expect(ratingState.current?.initial).toBeNull();
 expect(confirmState.current).toBeNull();
 ratingState.current!.resolve(GENERAL);await flush();await flush();
 expect(confirmState.current?.onConfirm).toBeTypeOf('function');
 expect(api.saveRatingDraft).toHaveBeenCalledWith('r1',GENERAL,'tok','harbor');
 await confirmState.current!.onConfirm!({text:'',update:{updateKind:'minor',updateNote:''}});
 settleConfirm(true);await flush();await flush();
 expect(api.registerCard).toHaveBeenCalledWith('r1','tok',GENERAL,[],'harbor','',undefined,expect.objectContaining({policyRevision:'1'}));
 expect(api.submitRoleForReview).not.toHaveBeenCalled();
 expect(platforms.saveCopies).not.toHaveBeenCalled();
 expect(router.currentRoute.value.path).toBe('/mine');
});

it('submits a private HarperHarbor draft to the same immutable community review',async()=>{
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'Legacy draft',roleDetailDesc:'Private instructions',roleWelcome:'Hello'});
 await mount('/cards/r1/edit');
 expect(root.textContent).not.toContain(i18n.global.t('workspace.editHint'));
 expect(root.querySelector<HTMLInputElement>('input[value=private]')?.checked).toBe(true);
 byText('發布').click();await flush();
 const publicOption=root.querySelector<HTMLInputElement>('input[value=public]')!;publicOption.click();await flush();root.querySelector<HTMLButtonElement>('[data-visibility-apply]')!.click();await flush();
 ratingState.current!.resolve(GENERAL);await flush();await flush();
 await confirmState.current!.onConfirm!({text:'',update:{updateKind:'minor',updateNote:''}});
 settleConfirm(true);await flush();await flush();
 expect(api.submitRoleForReview).not.toHaveBeenCalled();
 expect(api.registerCard).toHaveBeenCalledWith('r1','tok',GENERAL,[],'harbor','',undefined,expect.objectContaining({policyRevision:'1'}));
 expect(router.currentRoute.value.path).toBe('/mine');
});

it('cancels a pending review while saving without changing access or submitting again',async()=>{
 localStorage.setItem('hearthroom.provider','harbor');
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'A',roleDetailDesc:'Private instructions',roleWelcome:'Hello',roleVisibility:'public'});
 api.beginCardEdit.mockResolvedValueOnce({resubmit:true,ratingAnswers:ADULT});
 await mount('/cards/r1/edit');
 await type($<HTMLInputElement>('#f-name'),'B revised');await submit();
 expect(api.beginCardEdit).toHaveBeenCalledWith('r1','tok','harbor');
 expect(api.beginCardEdit.mock.invocationCallOrder[0]).toBeLessThan(api.patchRoleDocument.mock.invocationCallOrder[0]);
 expect(api.unpublishRole).not.toHaveBeenCalled();
 expect(api.registerCard).not.toHaveBeenCalled();
 // 沿用上一版的問卷，不再問一次
 expect(ratingState.current).toBeNull();
});

// owner 2026-10-10：問卷上線前上架的一般卡沒有級別，下次送審一定要補
it('saving an unrated pending draft cancels review without starting a questionnaire',async()=>{
 localStorage.setItem('hearthroom.provider','harbor');
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'A',roleDetailDesc:'Private instructions',roleWelcome:'Hello'});
 api.beginCardEdit.mockResolvedValueOnce({resubmit:true});
 await mount('/cards/r1/edit');await type($<HTMLInputElement>('#f-name'),'B revised');await submit();
 expect(ratingState.current).toBeNull();expect(api.patchRoleDocument).toHaveBeenCalled();
 expect(api.registerCard).not.toHaveBeenCalled();
 expect(root.textContent).toContain(i18n.global.t('visibility.review.cancelled'));
});

it('a failed draft save never submits partial content for review',async()=>{
 localStorage.setItem('hearthroom.provider','harbor');
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'A'});
 api.beginCardEdit.mockResolvedValueOnce({resubmit:true,ratingAnswers:GENERAL});
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

describe("世界模式（實驗中）只給原本就是世界卡的卡", () => {
  it("新卡看不到世界這一區，導覽也沒有", async () => {
    await mount("/create");
    expect(root.querySelector('[data-section="world"]')).toBeNull();
    expect(root.querySelector('[data-section="persona"]')).not.toBeNull();
    // 基本資料、角色設定、開局、世界書、顯示、進階、發布
    expect(root.querySelectorAll(".side__item")).toHaveLength(7);
  });

  it("一般舊卡打開來也看不到", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "單角色" });
    await mount("/cards/r1/edit");
    expect(root.querySelector('[data-section="world"]')).toBeNull();
  });

  it("原本就是世界卡的照常顯示成員", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({
      roleName: "櫻丘高中",
      world: { version: 1, maxSpeakers: 2, strictness: "balanced", characters: [{ id: "ren", name: "蓮", profile: "", description: "同班同學" }] },
    });
    await mount("/cards/r1/edit");
    expect(root.querySelector('[data-section="world"]')).not.toBeNull();
    expect(root.querySelectorAll(".world-char")).toHaveLength(1);
    // 世界卡沒有卡片變數，進階那一區不顯示：數目跟單卡一樣是 7，換掉的是「進階」
    expect(root.querySelector('[data-section="advanced"]')).toBeNull();
    expect(root.querySelectorAll(".side__item")).toHaveLength(7);
  });
});

beforeEach(()=>{rollout.enabled=true;visibilityMocks.read.mockReset();visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy()});visibilityMocks.change.mockReset();visibilityMocks.operation.mockReset();});

it('scrolls from publication guidance to the missing character setting section',async()=>{
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'Synthetic name',roleWelcome:'Synthetic greeting'});
 await mount('/cards/r1/edit');await nextTick();
 const section=root.querySelector<HTMLElement>('[data-section="persona"]')!;
 const scroll=vi.spyOn(section,'scrollIntoView');
 const missing=root.querySelector<HTMLButtonElement>('.visibility-missing')!;
 expect(missing).not.toBeNull();missing.click();await nextTick();
 expect(scroll).toHaveBeenCalledWith({block:'start',behavior:'smooth'});
 expect(api.patchRoleDocument).not.toHaveBeenCalled();
});

it('retains the pending cancellation warning and save action with rollout disabled',async()=>{
 rollout.enabled=false;api.fetchDraftState.mockResolvedValue({status:'pending',draftChanged:false});
 await mount('/cards/r1/edit');await nextTick();
 expect(root.textContent).toContain(i18n.global.t('visibility.state.pendingEditor'));
 expect(root.querySelector('.author-visibility')).toBeNull();
 expect(root.querySelector('button[type="submit"]')).not.toBeNull();expect(visibilityMocks.read).not.toHaveBeenCalled();
});

describe('new card visibility',()=>{
 it('shows the link default before saving and honors a private choice',async()=>{
  await mount('/create');
  const choice=$<HTMLSelectElement>('#new-card-visibility');
  expect(choice).not.toBeNull();
  expect(choice.value).toBe('unlisted');
  expect(root.textContent).toContain(i18n.global.t('visibility.description.unlisted'));
  choice.value='private';choice.dispatchEvent(new Event('change'));await flush();
  await type($<HTMLInputElement>('#f-name'),'Private fixture');await submit();
  expect(api.createRole).toHaveBeenCalledWith(expect.objectContaining({visibility:'private'}),'tok');
 });
 it('does not offer a create default while editing an existing card',async()=>{
  await mount('/cards/existing/edit');
  expect(root.querySelector('#new-card-visibility')).toBeNull();
  expect(api.createRole).not.toHaveBeenCalled();
 });
});

it('restores a new draft private choice without applying it to existing cards',async()=>{
 localStorage.setItem('hearthroom.draft.create',JSON.stringify({draft:{roleName:'Restored private',language:'en'},visibility:'private',tagsText:'',worldbook:null,savedAt:Date.now()}));
 await mount('/create');
 expect($<HTMLSelectElement>('#new-card-visibility')?.value).toBe('private');
 await submit();
 expect(api.createRole).toHaveBeenCalledWith(expect.objectContaining({visibility:'private'}),'tok');
});

it('keeps a length refusal on the editor after the author returns from the submission dialog',async()=>{
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'Short draft',roleDetailDesc:'Private instructions',roleWelcome:'Hello'});
 await mount('/cards/r1/edit');byText('發布').click();await flush();
 root.querySelector<HTMLInputElement>('input[value=public]')!.click();await flush();root.querySelector<HTMLButtonElement>('[data-visibility-apply]')!.click();await flush();
 ratingState.current!.resolve(GENERAL);await flush();await flush();
 const {ApiError}=await import('../src/lib/api');
 const message='合計 3,000 字，還差 1 字，至少 3,001 字。';
 api.registerCard.mockRejectedValueOnce(new ApiError(400,message,'review_length_insufficient'));
 await expect(confirmState.current!.onConfirm!({text:'',update:{updateKind:'minor',updateNote:''}})).rejects.toThrow(message);
 settleConfirm(false);await flush();await flush();
 expect([...root.querySelectorAll('[role=alert]')].map(node=>node.textContent).join(' ')).toContain(message);
 expect(router.currentRoute.value.path).toBe('/cards/r1/edit');
});

describe('匯入正則在寫入前驗證', () => {
  const oversized = { beginning: 'synthetic-image-marker', regex_scripts: [{ id: 'synthetic-rule', scriptName: 'Synthetic oversized rule', findRegex: 'synthetic-image-marker', replaceString: 'x'.repeat(512 * 1024 + 1) }] };
  it('匯入預覽指出超限規則，仍可套用修正', async () => {
    await mount('/create');
    localStorage.setItem('hr.import.kind', 'mmd');
    const radio = root.querySelectorAll<HTMLButtonElement>('.import__kind button')[1];
    radio.click(); await flush();
    await pickFile($('.import input[type=file]'), new File([JSON.stringify(oversized)], 'synthetic.json'));
    const notice = root.querySelector('.review [role=alert]');
    expect(notice?.textContent).toContain('Synthetic oversized rule');
    expect(notice?.textContent).toContain('512');
    const apply = byText('套用到表單');
    expect(apply.disabled).toBe(false);
    apply.click(); await flush();
    expect($<HTMLTextAreaElement>('#f-welcome').value).toBe('synthetic-image-marker');
  });
  it.each(['/create', '/cards/r1/edit'])('%s 超限正則不得先存開場或建立空卡', async (path) => {
    if (path !== '/create') api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Synthetic card', roleWelcome: '' });
    await mount(path);
    if (path === '/create') await type($('#f-name'), 'Synthetic card');
    await pickFile($('.rxbar input[type=file]'), new File([JSON.stringify(oversized)], 'synthetic.json'));
    await submit();
    expect(api.createRole).not.toHaveBeenCalled();
    expect(api.beginCardEdit).not.toHaveBeenCalled();
    expect(api.patchRoleDocument).not.toHaveBeenCalled();
    expect(api.patchRoleWelcome).not.toHaveBeenCalled();
    expect(api.createWorldbook).not.toHaveBeenCalled();
    expect(api.saveAuthorAsset).not.toHaveBeenCalled();
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Synthetic oversized rule');
    expect($<HTMLTextAreaElement>('#f-welcome').value).toBe('synthetic-image-marker');
    await pickFile($('.rxbar input[type=file]'), new File([JSON.stringify({ ...oversized, regex_scripts: [{ ...oversized.regex_scripts[0], replaceString: 'x'.repeat(512 * 1024) }] })], 'corrected.json'));
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledTimes(1);
    expect(api.saveAuthorAsset).toHaveBeenCalledWith('r1', expect.objectContaining({ rules: [expect.objectContaining({ replace: 'x'.repeat(512 * 1024) })] }), 'tok');
    expect(api.createRole).toHaveBeenCalledTimes(path === '/create' ? 1 : 0);
  });
});

describe('正則預檢與保存快照', () => {
 it('未修改的伺服器合法規則不阻擋只改卡名', async () => {
  api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Before', roleWelcome: 'Opening' });
  api.fetchAuthorAsset.mockResolvedValueOnce({ rules: [{ id: 'existing', name: 'n'.repeat(41), find: 'x', replace: 'y', enabled: true }], mountTrigger: '', mountLayer: 'over', pageMode: 'sandbox', status: 'passed', version: 4 } as any);
  await mount('/cards/r1/edit'); await type($('#f-name'), 'After'); await submit();
  expect(api.patchRoleDocument).toHaveBeenCalledWith('r1', expect.objectContaining({roleName: 'After'}), 'tok');
  expect(api.saveAuthorAsset).not.toHaveBeenCalled();
 });
 it('保存期間重新匯入不會取代已驗證的規則快照，新修改仍待保存', async () => {
  let complete!: (value: {roleId: string}) => void;
  api.createRole.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await mount('/create'); await type($('#f-name'), 'Snapshot fixture');
  const file = (replace: string) => new File([JSON.stringify({ beginning: 'snapshot-opening', regex_scripts: [{ id: 'snapshot', scriptName: 'Snapshot', findRegex: 'snapshot-opening', replaceString: replace }] })], 'snapshot.json');
  await pickFile($('.rxbar input[type=file]'), file('verified-before-save'));
  $('form').dispatchEvent(new Event('submit', { cancelable: true })); await flush();
  await pickFile($('.rxbar input[type=file]'), file('x'.repeat(512 * 1024 + 1)));
  complete({roleId: 'r1'}); await flush(); await flush();
  expect((api.saveAuthorAsset.mock.calls[0][1] as any).rules[0].replace).toBe('verified-before-save');
  await submit();
  expect(api.saveAuthorAsset).toHaveBeenCalledTimes(1);
  expect(root.querySelector('[role=alert]')?.textContent).toContain('512');
 });
});


describe('large replacement advisory', () => {
 it.each([136325, 262144, 262145, 300 * 1024, 524288])('import and save %i bytes without blocking', async bytes => {
  await mount('/create'); await type($('#f-name'), 'Large rule fixture');
  root.querySelectorAll<HTMLButtonElement>('.import__kind button')[1].click(); await flush();
  const replace = '界'.repeat(Math.floor(bytes / 3)) + 'x'.repeat(bytes % 3);
  const file = new File([JSON.stringify({ beginning: 'marker', regex_scripts: [{ scriptName: 'Large rule fixture', findRegex: 'marker', replaceString: replace }] })], 'large.json');
  await pickFile($('.import input[type=file]'), file);
  expect(root.querySelector('.review .regex-warning') !== null).toBe(bytes > 262144);
  if (bytes > 262144) expect(root.querySelector('.review .regex-warning')?.textContent).toContain('Large rule fixture');
  byText('套用到表單').click(); await flush();
  expect(root.querySelector('.editor .regex-warning') !== null).toBe(bytes > 262144);
  await submit();
  expect(api.saveAuthorAsset).toHaveBeenCalledWith('r1', expect.objectContaining({ rules: [
   expect.objectContaining({ name: 'Large rule fixture', find: 'marker', replace, enabled: true }),
   expect.objectContaining({ id: 'hearthroom-mmd-dock-off', enabled: true, replace: expect.stringContaining('--lt-dock: none !important') }),
  ] }), 'tok');
 });
});

describe("匯入 AI 風月卡 → 建立", () => {
  it("匯入的世界書還在建立時就按建立：規則與綁定照樣寫上去", async () => {
    const fixture = (await import("./fixtures/fengyue-cases.json")).default.cases[0];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    api.createWorldbook.mockImplementationOnce(async () => { await gate; return "wb1"; });
    await mount("/create");
    await pickFile($("input[type=file]"), new File([JSON.stringify(fixture.input)], "export.json", { type: "application/json" }));
    byText("套用到表單").click();
    await flush();
    const saving = submit();
    await flush();
    release();
    await saving;
    await flush();
    expect(api.saveAuthorAsset).toHaveBeenCalledTimes(1);
    const docs = api.patchWorldbookDocument.mock.calls as unknown as [string, { binding?: unknown }][];
    expect(docs.some(([, doc]) => JSON.stringify(doc.binding ?? null).includes("r1"))).toBe(true);
  });

  it("規則、內置 CSS 與世界書都跟著第一次儲存寫上去，世界書綁到這張卡", async () => {
    const fixture = (await import("./fixtures/fengyue-cases.json")).default.cases[0];
    await mount("/create");
    await pickFile($("input[type=file]"), new File([JSON.stringify(fixture.input)], "export.json", { type: "application/json" }));
    byText("套用到表單").click();
    await flush();
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledTimes(1);
    const [, asset] = api.saveAuthorAsset.mock.calls[0] as unknown as [string, { rules: { find: string }[] }];
    expect(asset.rules.length).toBe(2);
    const docs = api.patchWorldbookDocument.mock.calls as unknown as [string, { binding?: unknown; entries: unknown[] }][];
    expect(docs.some(([, doc]) => JSON.stringify(doc.binding ?? null).includes("r1"))).toBe(true);
  });

  it("詳細介紹成為首屏網頁、開場選項帶進來、開場白留空也能存；作者資產先存、再存開場", async () => {
    const fixture = (await import("./fixtures/fengyue-cases.json")).default.cases.find((c: { name: string }) => c.name.startsWith("real export, opening-choice mode"))!;
    await mount("/create");
    await pickFile($("input[type=file]"), new File([JSON.stringify(fixture.input)], "export.json", { type: "application/json" }));
    expect(root.textContent).toContain(i18n.global.t("import.landed.openingPage", { n: [..."<div>TEST-INTRO-HTML</div>"].length }));
    byText("套用到表單").click();
    await flush();
    // 風月卡歸開場網頁：只顯示網頁內容與第一句選項，沒有開場白欄位
    expect($('[data-opening-mode="page"]').getAttribute("aria-checked")).toBe("true");
    expect($<HTMLTextAreaElement>("#f-opening-page").value).toBe("<div>TEST-INTRO-HTML</div>");
    expect(root.querySelector("#f-welcome")).toBeNull();
    // 開場網頁有第一句選項就不缺
    expect(root.querySelectorAll(".side__dot")).toHaveLength(0);
    const order: string[] = [];
    api.saveAuthorAsset.mockImplementationOnce(async () => { order.push("asset"); return { rules: [], mountTrigger: "", mountLayer: "over", pageMode: "sandbox", cardFormat: "fengyue", openingPage: "<div>TEST-INTRO-HTML</div>", status: "passed", version: 1 }; });
    api.patchRoleWelcome.mockImplementationOnce(async () => { order.push("welcome"); return {}; });
    await submit();
    const [, asset] = api.saveAuthorAsset.mock.calls[0] as unknown as [string, { cardFormat: string; openingPage: string; pageMode: string; openingMode: string }];
    expect(asset).toMatchObject({ cardFormat: "fengyue", openingPage: "<div>TEST-INTRO-HTML</div>", pageMode: "sandbox", openingMode: "page" });
    expect(api.patchRoleWelcome).toHaveBeenCalledWith("r1", { roleWelcome: "", alternates: [], prologue: ["TEST-OPEN-A", "TEST-OPEN-B"] }, "tok");
    expect(order).toEqual(["asset", "welcome"]);
  });
});

describe("卡片變數", () => {
  const DETAIL = {
    roleName: "合成變數卡", roleDetailDesc: "合成設定", roleWelcome: "合成開場", language: "zh-Hant",
    state: {
      version: 2,
      data: { 好感度: 10, 背包: ["短刀", "鐵護腕"], 任務: {} },
      rules: { text: "合成規則", paths: { 好感度: "0 到 100" } },
      open: ["任務"],
      required: [],
    },
  };

  it("已存過變數的卡打開時收著；狀態列數頂層與群組裡的值，清單算一個、規則不算", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce(JSON.parse(JSON.stringify(DETAIL)));
    await mount("/cards/r1/edit");
    const toggle = $('[data-state-panel] [aria-controls="state-body"]');
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // 好感度、背包（清單）、任務（空群組，0 項）→ 2
    expect($(".state-panel__chip").textContent).toBe(i18n.global.t("editor.state.summary", { n: 2 }));
  });

  it("讀回上游的定義組回 MVU 寫法，改規則後整包寫入", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce(JSON.parse(JSON.stringify(DETAIL)));
    await mount("/cards/r1/edit");
    const data = $<HTMLTextAreaElement>("#f-state-data");
    expect(JSON.parse(data.value)).toEqual({ 好感度: [10, "0 到 100"], 背包: [["短刀", "鐵護腕"], ""], 任務: { $meta: { extensible: true } } });
    expect($<HTMLTextAreaElement>("#f-state-rules").value).toBe("合成規則");
    await type($("#f-state-rules"), "新規則");
    await submit();
    expect(api.putRoleState).toHaveBeenCalledWith("r1", {
      convention: "mvu",
      data: { 好感度: [10, "0 到 100"], 背包: [["短刀", "鐵護腕"], ""], 任務: { $meta: { extensible: true } } },
      rules: { text: "新規則" },
    }, "tok");
    expect(api.deleteRoleState).not.toHaveBeenCalled();
  });

  it("沒動過就不寫；移除後存檔才送 DELETE", async () => {
    api.fetchRoleDetail.mockResolvedValue(JSON.parse(JSON.stringify(DETAIL)));
    await mount("/cards/r1/edit");
    await type($("#f-name"), "改名");
    await submit();
    expect(api.putRoleState).not.toHaveBeenCalled();
    byText(i18n.global.t("editor.state.disable")).click();
    await flush();
    expect(root.querySelector("#f-state-data")).toBeNull();
    await submit();
    expect(api.deleteRoleState).toHaveBeenCalledWith("r1", "tok");
    api.fetchRoleDetail.mockReset();
    api.fetchRoleDetail.mockResolvedValue({});
  });

  it("只清掉骨架、規則還在：不當成移除，在這一區擋下，不送 DELETE 也不送寫入", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce(JSON.parse(JSON.stringify(DETAIL)));
    await mount("/cards/r1/edit");
    await type($("#f-state-data"), "");
    await submit();
    expect(api.deleteRoleState).not.toHaveBeenCalled();
    expect(api.putRoleState).not.toHaveBeenCalled();
    expect(root.textContent).toContain(i18n.global.t("editor.state.reject.data"));
    expect($(".side__item[aria-current=true]").textContent).toContain(i18n.global.t("editor.section.advanced"));
  });

  it("清單元素上的規則、含點的鍵：讀回再存，規則、可擴充、必填照路徑送回去", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({
      ...JSON.parse(JSON.stringify(DETAIL)),
      state: {
        version: 2,
        data: { "HP.max": 100, 背包: ["短刀"], "任務.a": {} },
        rules: { text: "", paths: { '["HP.max"]': "上限", "背包[0]": "第一格" } },
        open: ['["任務.a"]'],
        required: ['["HP.max"]'],
      },
    });
    await mount("/cards/r1/edit");
    await type($("#f-state-rules"), "新規則");
    await submit();
    expect(api.putRoleState).toHaveBeenCalledWith("r1", {
      convention: "mvu",
      data: { $meta: { required: ["HP.max"] }, "HP.max": [100, "上限"], 背包: ["短刀"], "任務.a": { $meta: { extensible: true } } },
      rules: { text: "新規則", paths: { "背包[0]": "第一格" } },
    }, "tok");
  });

  it("骨架解不開時先在本地擋下，指到這一區，不送任何寫入", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "合成", roleDetailDesc: "合成設定", roleWelcome: "合成開場" });
    await mount("/cards/r1/edit");
    byText(i18n.global.t("editor.state.enable")).click();
    await flush();
    await type($("#f-state-data"), '{"好感度": 1,');
    expect($("#f-state-data-error").textContent).toBeTruthy();
    await submit();
    expect(api.beginCardEdit).not.toHaveBeenCalled();
    expect(api.putRoleState).not.toHaveBeenCalled();
    expect(root.textContent).toContain(i18n.global.t("editor.state.reject.data"));
    expect($(".side__item[aria-current=true]").textContent).toContain(i18n.global.t("editor.section.advanced"));
    // 進階亮紅點；再改變數就消掉
    expect($(".side__item[aria-current=true] .side__dot")).toBeTruthy();
    await type($("#f-state-data"), '{"好感度": 1}');
    expect(root.querySelector(".side__item[aria-current=true] .side__dot")).toBeNull();
  });

  it("上游拒收時錯誤停在這一區", async () => {
    const { ApiError } = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "合成", roleDetailDesc: "合成設定", roleWelcome: "合成開場" });
    api.putRoleState.mockRejectedValueOnce(new ApiError(400, i18n.global.t("editor.state.reject.rule_path"), "validate_reject", undefined, "rule_path"));
    await mount("/cards/r1/edit");
    byText(i18n.global.t("editor.state.enable")).click();
    await flush();
    await type($("#f-state-data"), '{"好感度": 1}');
    await submit();
    expect(api.putRoleState).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain(i18n.global.t("editor.state.reject.rule_path"));
    expect($(".side__item[aria-current=true]").textContent).toContain(i18n.global.t("editor.section.advanced"));
  });

  it("匯入帶 [InitVar] 的酒館卡：卡片變數一區已經填好，第一次儲存就寫上去", async () => {
    await mount("/create");
    const card = { spec: "chara_card_v2", spec_version: "2.0", data: {
      name: "合成變數卡", description: "合成設定", first_mes: "合成開場",
      character_book: { entries: [
        { keys: [], comment: "[InitVar] 初始變數", content: "{ 好感度: [0, '0 到 100'], // 註解\n }", enabled: false },
        { keys: ["鎮"], comment: "鎮", content: "北境小鎮。", enabled: true },
      ] },
    } };
    await pickFile($("input[type=file]"), new File([JSON.stringify(card)], "card.json", { type: "application/json" }));
    expect(root.textContent).toContain(i18n.global.t("import.landed.state", { n: 1 }));
    byText("套用到表單").click();
    await flush();
    expect(JSON.parse($<HTMLTextAreaElement>("#f-state-data").value)).toEqual({ 好感度: [0, "0 到 100"] });
    await submit();
    expect(api.putRoleState).toHaveBeenCalledWith("r1", { convention: "mvu", data: { 好感度: [0, "0 到 100"] } }, "tok");
  });
});

describe("開局：開場白與開場網頁二選一（ui.md §3）", () => {
  const greetingCard = () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "雨夜", roleDetailDesc: "設定", roleWelcome: "雨還在下。", roleWelcomeAlternates: ["另一個開頭"], rolePrologue: ["我推開門。"] });
    api.fetchAuthorAsset.mockResolvedValueOnce({ rules: [], mountTrigger: "", mountLayer: "over", pageMode: "sandbox", openingMode: "greeting", openingPage: "", status: "passed", version: 2 } as any);
  };

  it("切到開場網頁：存檔時先存呈現、再送空的開場白與備選；選項保留，存完提示消失", async () => {
    greetingCard();
    await mount("/cards/r1/edit");
    $('[data-opening-mode="page"]').click();
    await flush();
    expect(root.querySelector("#f-welcome")).toBeNull();
    expect($("[data-opening-switched]").textContent).toContain(i18n.global.t("editor.opening.switched.toPageWithAlternates", { n: 1 }));
    // 開局的必填換成第一句選項（底部列）
    expect($(".bar__check").textContent).toContain(i18n.global.t("editor.required.prologue"));
    const order: string[] = [];
    api.saveAuthorAsset.mockImplementationOnce(async () => { order.push("asset"); return { rules: [], mountTrigger: "", mountLayer: "over", pageMode: "sandbox", openingMode: "page", openingPage: "", status: "none", version: 3 } as any; });
    api.patchRoleWelcome.mockImplementationOnce(async () => { order.push("welcome"); return {}; });
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledWith("r1", expect.objectContaining({ openingMode: "page" }), "tok");
    expect(api.patchRoleWelcome).toHaveBeenCalledWith("r1", { roleWelcome: "", alternates: [], prologue: ["我推開門。"] }, "tok");
    expect(order).toEqual(["asset", "welcome"]);
    expect(root.querySelector("[data-opening-switched]")).toBeNull();
    expect(root.querySelector("[data-opening-leftover]")).toBeNull();
  });

  it("切過去又切回來：開場白都還在，存檔不動開場", async () => {
    greetingCard();
    await mount("/cards/r1/edit");
    $('[data-opening-mode="page"]').click();
    await flush();
    byText(i18n.global.t("editor.opening.switchBack")).click();
    await flush();
    expect($<HTMLTextAreaElement>("#f-welcome").value).toBe("雨還在下。");
    expect(root.querySelector("[data-opening-switched]")).toBeNull();
  });

  it("切到開場白：網頁內容在存檔時移除", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "首屏", roleDetailDesc: "設定", roleWelcome: "", rolePrologue: ["出發"] });
    api.fetchAuthorAsset.mockResolvedValueOnce({ rules: [], mountTrigger: "", mountLayer: "over", pageMode: "sandbox", openingMode: "page", openingPage: "<div>首屏</div>", status: "passed", version: 5 } as any);
    await mount("/cards/r1/edit");
    $('[data-opening-mode="greeting"]').click();
    await flush();
    expect($("[data-opening-switched]").textContent).toContain(i18n.global.t("editor.opening.switched.toGreeting"));
    await type($("#f-welcome"), "門開了。");
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledWith("r1", expect.objectContaining({ openingMode: "greeting", openingPage: "", version: 5 }), "tok");
    expect(api.patchRoleWelcome).toHaveBeenCalledWith("r1", expect.objectContaining({ roleWelcome: "門開了。" }), "tok");
  });

  it("舊卡兩種都有：照舊保留、提醒作者選一種，不擋儲存", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "風月", roleDetailDesc: "設定", roleWelcome: "作者另外寫的開場白", rolePrologue: ["出發"] });
    api.fetchAuthorAsset.mockResolvedValueOnce({ rules: [], mountTrigger: "", mountLayer: "over", pageMode: "sandbox", cardFormat: "fengyue", openingMode: "page", openingPage: "<div>首屏</div>", status: "passed", version: 1 } as any);
    await mount("/cards/r1/edit");
    expect($("[data-opening-leftover]").textContent).toContain(i18n.global.t("editor.opening.leftover.greeting"));
    byText(i18n.global.t("editor.opening.leftover.greeting.remove")).click();
    await flush();
    expect(root.querySelector("[data-opening-leftover]")).toBeNull();
    await submit();
    expect(api.patchRoleWelcome).toHaveBeenCalledWith("r1", { roleWelcome: "", alternates: [], prologue: ["出發"] }, "tok");
  });

  it("開場白的舊卡只有選項沒有開場白：亮紅點，但照樣存得下（上游照舊收）", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "舊卡", roleDetailDesc: "設定", roleWelcome: "", rolePrologue: ["我推開門。"] });
    await mount("/cards/r1/edit");
    expect($('.side__item:nth-child(3) .side__dot')).toBeTruthy();
    expect(root.querySelector("#f-welcome")).not.toBeNull();
    await type($("#f-detail"), "設定改了");
    await submit();
    expect(api.patchRoleDocument).toHaveBeenCalled();
    expect(root.querySelector('.body__scroll > [role="alert"]')).toBeNull();
  });
});

describe("開局：切到開場網頁時不擋要被移除的開場白", () => {
  it("超過上限的舊開場白：切到開場網頁照樣存得下，開場白送空的", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "長開場", roleDetailDesc: "設定", roleWelcome: "字".repeat(8001), rolePrologue: ["出發"] });
    await mount("/cards/r1/edit");
    $('[data-opening-mode="page"]').click();
    await flush();
    await submit();
    expect(root.querySelector('.body__scroll > [role="alert"]')).toBeNull();
    expect(api.patchRoleWelcome).toHaveBeenCalledWith("r1", { roleWelcome: "", alternates: [], prologue: ["出發"] }, "tok");
  });
});

describe("空白新卡", () => {
  it("還沒寫設定就不顯示送審字數", async () => {
    await mount("/create");
    expect(root.querySelector("[data-card-constant-count]")).toBeNull();
    expect(root.querySelector("[data-review-count]")).toBeNull();
    await type($("#f-detail"), "設定");
    expect(root.querySelector("[data-review-count]")).not.toBeNull();
  });
});

describe("分類與玩法的展開列", () => {
  it("只數分類目錄裡亮起的標籤，手打的其他標籤不算；有亮起時預設展開", async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: "標籤", roleDetailDesc: "設定", roleWelcome: "開場", roleTag: ["校園", "自訂的標籤"] });
    await mount("/cards/r1/edit");
    const row = $('[aria-controls="tag-picker"]');
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(row.textContent).toContain(i18n.global.t("editor.tags.picked", { n: 1 }));
  });
});


describe('restore currently published content',()=>{
 it('previews without writing and restores the full unsaved draft on undo',async()=>{
  visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
  api.fetchRoleDetail.mockResolvedValueOnce({roleName:'Draft title',roleWelcome:'Draft opening',roleDetailDesc:'Draft setting'})
   .mockResolvedValueOnce({roleName:'Approved title',roleWelcome:'Approved opening',roleDetailDesc:'Approved setting'});
  await mount('/cards/r1/edit');
  await type($('#f-name'),'Unsaved title');
  const entry=$<HTMLButtonElement>('[data-approved-restore]');expect(entry).not.toBeNull();entry.click();await flush();
  expect(confirmState.current?.focusCancel).toBe(true);
  await confirmState.current!.onConfirm!({} as any);settleConfirm(true);await flush();
  expect(($<HTMLInputElement>('#f-name')).value).toBe('Approved title');
  expect(api.saveApprovedDraft).not.toHaveBeenCalled();expect(api.patchRoleDocument).not.toHaveBeenCalled();
  $<HTMLButtonElement>('[data-approved-undo]').click();await flush();
  expect(($<HTMLInputElement>('#f-name')).value).toBe('Unsaved title');
  expect(root.querySelector('[data-approved-undo]')).toBeNull();
 });
 it('keeps the original input when any dependency read fails',async()=>{
  visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
  api.fetchRoleDetail.mockResolvedValueOnce({roleName:'Draft title',roleWelcome:'Draft opening'}).mockRejectedValueOnce(new Error('network'));
  await mount('/cards/r1/edit');$<HTMLButtonElement>('[data-approved-restore]').click();await flush();
  await expect(confirmState.current!.onConfirm!({} as any)).rejects.toThrow();
  expect(($<HTMLInputElement>('#f-name')).value).toBe('Draft title');expect(api.saveApprovedDraft).not.toHaveBeenCalled();settleConfirm(false);
 });
 it.each([{revisionState:'same'},{revisionState:'unknown'},{revisionState:'changed',restriction:'delisted'},{revisionState:'changed',syncState:'syncing'},{revisionState:'changed',review:'pending'},{revisionState:'changed',update:'pending'}])('hides the action for %o',async state=>{
  visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy(state)});await mount('/cards/r1/edit');
  expect(root.querySelector('[data-approved-restore]')).toBeNull();
 });
});

it('saves an unedited revert atomically without writing frozen dependencies',async()=>{
 visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
 const approved={roleName:'Published title',roleWelcome:'Published opening',roleDetailDesc:'Published setting',language:'zh-Hant'};
 api.fetchRoleDetail.mockResolvedValueOnce({...approved,roleName:'Broken draft'}).mockResolvedValueOnce(approved).mockResolvedValueOnce(approved);
 await mount('/cards/r1/edit');$<HTMLButtonElement>('[data-approved-restore]').click();await flush();
 await confirmState.current!.onConfirm!({} as any);settleConfirm(true);await flush();
 await submit();
 expect(api.saveApprovedDraft).toHaveBeenCalledTimes(1);
 expect(api.patchRoleDocument).not.toHaveBeenCalled();expect(api.patchRoleWelcome).not.toHaveBeenCalled();
 expect(api.patchWorldbookDocument).not.toHaveBeenCalled();expect(api.saveAuthorAsset).not.toHaveBeenCalled();
 expect(root.querySelector('[data-approved-undo]')).toBeNull();
});

it('asks before discarding edits made after a revert and keeps them when cancelled',async()=>{
 visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
 api.fetchRoleDetail.mockResolvedValueOnce({roleName:'Broken draft',roleWelcome:'Opening'}).mockResolvedValueOnce({roleName:'Published title',roleWelcome:'Opening'});
 await mount('/cards/r1/edit');$<HTMLButtonElement>('[data-approved-restore]').click();await flush();
 await confirmState.current!.onConfirm!({} as any);settleConfirm(true);await flush();
 await type($('#f-name'),'Post-revert edit');$<HTMLButtonElement>('[data-approved-undo]').click();await flush();
 expect(confirmState.current?.title).toBe(i18n.global.t('editor.revertUndoTitle'));settleConfirm(false);await flush();
 expect($<HTMLInputElement>('#f-name').value).toBe('Post-revert edit');
 $<HTMLButtonElement>('[data-approved-undo]').click();await flush();settleConfirm(true);await flush();
 expect($<HTMLInputElement>('#f-name').value).toBe('Broken draft');expect(api.saveApprovedDraft).not.toHaveBeenCalled();
});

it('saves later edits against the restored baseline rather than the abandoned draft',async()=>{
 visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
 const approved={roleName:'Published title',roleWelcome:'Published opening',roleDetailDesc:'Published setting',language:'zh-Hant'};
 api.fetchRoleDetail.mockResolvedValueOnce({...approved,roleName:'Broken draft',roleDetailDesc:'Abandoned setting'}).mockResolvedValueOnce(approved).mockResolvedValueOnce(approved);
 await mount('/cards/r1/edit');$<HTMLButtonElement>('[data-approved-restore]').click();await flush();
 await confirmState.current!.onConfirm!({} as any);settleConfirm(true);await flush();
 await type($('#f-name'),'New title after revert');await submit();
 expect(api.saveApprovedDraft).toHaveBeenCalledTimes(1);
 expect(api.patchRoleDocument).toHaveBeenCalledWith('r1',{roleName:'New title after revert'},'tok');
 expect(api.patchRoleWelcome).not.toHaveBeenCalled();
});

it('keeps the same save identity and withholds undo while confirming a lost response',async()=>{
 visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
 const approved={roleName:'Published title',roleWelcome:'Published opening',roleDetailDesc:'Published setting',language:'zh-Hant'};
 api.fetchRoleDetail.mockResolvedValueOnce({...approved,roleName:'Broken draft'}).mockResolvedValueOnce(approved).mockResolvedValueOnce(approved);
 api.saveApprovedDraft.mockRejectedValueOnce(new TypeError('network'));
 await mount('/cards/r1/edit');$<HTMLButtonElement>('[data-approved-restore]').click();await flush();
 await confirmState.current!.onConfirm!({} as any);settleConfirm(true);await flush();
 await submit();
 expect(root.querySelector('[data-approved-undo]')).toBeNull();expect(api.patchRoleDocument).not.toHaveBeenCalled();
 const firstIdentity=api.saveApprovedDraft.mock.calls[0];await submit();
 expect(api.saveApprovedDraft).toHaveBeenCalledTimes(2);expect(api.saveApprovedDraft.mock.calls[1]).toEqual(firstIdentity);
 expect(root.querySelector('[data-approved-undo]')).toBeNull();
});

it('keeps save recovery guidance when restore committed but reloading its baseline failed',async()=>{
 visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
 const approved={roleName:'Published title',roleWelcome:'Published opening',roleDetailDesc:'Published setting',language:'zh-Hant'};
 api.fetchRoleDetail.mockResolvedValueOnce({...approved,roleName:'Broken draft'}).mockResolvedValueOnce(approved).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(approved);
 await mount('/cards/r1/edit');$<HTMLButtonElement>('[data-approved-restore]').click();await flush();
 await confirmState.current!.onConfirm!({} as any);settleConfirm(true);await flush();
 await submit();
 expect(api.saveApprovedDraft).toHaveBeenCalledTimes(1);expect(root.querySelector('[data-approved-undo]')).toBeNull();
 expect(root.textContent).toContain(i18n.global.t('editor.revertSaveUnknown'));
 expect(root.querySelector('.body__scroll > .notice--error')).toBeNull();
 expect(root.textContent?.split(i18n.global.t('editor.revertSaveUnknown')).length).toBe(2);
 expect(root.textContent).not.toContain('Failed to fetch');
 await submit();expect(api.saveApprovedDraft).toHaveBeenCalledTimes(1);
 expect(root.querySelector('[data-approved-undo]')).toBeNull();
 expect(root.textContent).not.toContain(i18n.global.t('editor.revertSaveUnknown'));
});

it('recovers an unsaved approved restore after reload without undo and can discard to the server draft',async()=>{
 visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
 const server={roleName:'Server draft',roleWelcome:'Draft opening',roleDetailDesc:'Draft setting'};
 const approved={roleName:'Approved title',roleWelcome:'Approved opening',roleDetailDesc:'Approved setting'};
 api.fetchRoleDetail.mockResolvedValue(server).mockResolvedValueOnce(server).mockResolvedValueOnce(approved);
 await mount('/cards/r1/edit');$<HTMLButtonElement>('[data-approved-restore]').click();await flush();
 await confirmState.current!.onConfirm!({} as any);settleConfirm(true);await flush();
 await type($('#f-name'),'Edit after restore');await new Promise(r=>setTimeout(r,450));
 expect(Object.keys(localStorage).some(k=>k.startsWith('hearthroom.draft.approved.'))).toBe(true);
 app.unmount();root.remove();api.fetchRoleDetail.mockResolvedValue({...server,roleName:'New server draft'});await mount('/cards/r1/edit');
 expect($<HTMLInputElement>('#f-name').value).toBe('Edit after restore');
 expect($<HTMLTextAreaElement>('#f-welcome').value).toBe('Approved opening');
 expect(root.textContent).toContain(i18n.global.t('editor.draftRestored'));
 expect(root.querySelector('[data-approved-undo]')).toBeNull();
 expect(root.querySelector('[data-approved-restore]')).toBeNull();
 btnIn(root,i18n.global.t('editor.draftDiscard')).click();await flush();
 expect($<HTMLInputElement>('#f-name').value).toBe('New server draft');
 expect($<HTMLTextAreaElement>('#f-welcome').value).toBe('Draft opening');
 expect(root.textContent).not.toContain(i18n.global.t('editor.draftRestored'));
 expect(Object.keys(localStorage).some(k=>k.startsWith('hearthroom.draft.approved.'))).toBe(false);
});

it('saves a recovered approved restore atomically before applying its later edits',async()=>{
 visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
 const server={roleName:'Server draft',roleWelcome:'Draft opening',roleDetailDesc:'Draft setting'};
 const approved={roleName:'Approved title',roleWelcome:'Approved opening',roleDetailDesc:'Approved setting'};
 api.fetchRoleDetail.mockResolvedValue(server).mockResolvedValueOnce(server).mockResolvedValueOnce(approved);
 await mount('/cards/r1/edit');$<HTMLButtonElement>('[data-approved-restore]').click();await flush();
 await confirmState.current!.onConfirm!({} as any);settleConfirm(true);await flush();
 const version=api.fetchApprovedDraft.mock.results[0].value;await type($('#f-name'),'Edit after restore');
 app.unmount();root.remove();await mount('/cards/r1/edit');
 api.fetchRoleDetail.mockResolvedValueOnce(approved);await submit();
 expect(api.saveApprovedDraft).toHaveBeenCalledWith('r1',await version,'tok');
 expect(api.patchRoleDocument).toHaveBeenCalledWith('r1',{roleName:'Edit after restore'},'tok');
 expect(Object.keys(localStorage).some(k=>k.startsWith('hearthroom.draft.approved.'))).toBe(false);
 expect(root.textContent).not.toContain(i18n.global.t('editor.draftRestored'));
});

it('isolates approved recovery by source and author and clears it before an uncertain save',async()=>{
 visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
 const server={roleName:'Server draft',roleWelcome:'Draft opening',roleDetailDesc:'Draft setting'};
 const approved={roleName:'Approved title',roleWelcome:'Approved opening',roleDetailDesc:'Approved setting'};
 api.fetchRoleDetail.mockResolvedValue(server).mockResolvedValueOnce(server).mockResolvedValueOnce(approved);
 await mount('/cards/r1/edit');$<HTMLButtonElement>('[data-approved-restore]').click();await flush();
 await confirmState.current!.onConfirm!({} as any);settleConfirm(true);await flush();
 app.unmount();root.remove();await mount('/cards/r2/edit');
 expect($<HTMLInputElement>('#f-name').value).toBe('Server draft');
 expect(root.textContent).not.toContain(i18n.global.t('editor.draftRestored'));
 app.unmount();root.remove();platforms.profile={identities:[{provider:'harbor',externalId:'another-author'}]};await mount('/cards/r1/edit');
 expect($<HTMLInputElement>('#f-name').value).toBe('Server draft');
 expect(root.textContent).not.toContain(i18n.global.t('editor.draftRestored'));
 app.unmount();root.remove();platforms.profile=undefined;await mount('/cards/r1/edit');
 expect($<HTMLInputElement>('#f-name').value).toBe('Approved title');
 api.saveApprovedDraft.mockRejectedValueOnce(new TypeError('Failed to fetch'));await submit();
 expect(Object.keys(localStorage).some(k=>k.startsWith('hearthroom.draft.approved.'))).toBe(false);
 expect(root.textContent?.split(i18n.global.t('editor.revertSaveUnknown')).length).toBe(2);
 expect(root.querySelector('[data-approved-undo]')).toBeNull();
});

it.each(['book','asset'] as const)('preserves cached recovery without applying it when the server %s baseline fails',async(part)=>{
 visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({revisionState:'changed'})});
 const server={roleName:'Server draft',roleWelcome:'Draft opening',roleDetailDesc:'Draft setting'};
 const approved={roleName:'Approved title',roleWelcome:'Approved opening',roleDetailDesc:'Approved setting'};
 api.fetchRoleDetail.mockResolvedValue(server).mockResolvedValueOnce(server).mockResolvedValueOnce(approved);
 await mount('/cards/r1/edit');$<HTMLButtonElement>('[data-approved-restore]').click();await flush();
 await confirmState.current!.onConfirm!({} as any);settleConfirm(true);await flush();
 app.unmount();root.remove();
 (part==='book'?api.fetchWorldbookEntries:api.fetchAuthorAsset).mockRejectedValueOnce(new TypeError('Failed to fetch'));
 await mount('/cards/r1/edit');
 expect($<HTMLInputElement>('#f-name').value).toBe('Server draft');
 expect(root.textContent).not.toContain(i18n.global.t('editor.draftRestored'));
 expect($<HTMLButtonElement>('.bar button[type="submit"]').disabled).toBe(true);
 await submit();expect(api.saveApprovedDraft).not.toHaveBeenCalled();
 expect(Object.keys(localStorage).some(k=>k.startsWith('hearthroom.draft.approved.'))).toBe(true);
 app.unmount();root.remove();await mount('/cards/r1/edit');
 expect($<HTMLInputElement>('#f-name').value).toBe('Approved title');
 expect(root.textContent).toContain(i18n.global.t('editor.draftRestored'));
});

describe('prompt-only 規則匯入不洗舊規則', () => {
  const script = { scriptName: 'Hidden prompt rule', findRegex: 'x', replaceString: 'hidden', promptOnly: true };
  it('整份略過時保留現有規則與開場，顯示明確提示', async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Synthetic card', roleWelcome: 'Existing opening' });
    api.fetchAuthorAsset.mockResolvedValueOnce({ rules: [{ id: 'kept', name: 'Kept display', find: 'marker', replace: 'visible', enabled: true }], mountTrigger: '', mountLayer: 'over', pageMode: 'sandbox', status: 'passed', version: 7 });
    await mount('/cards/r1/edit');
    await pickFile($('.rxbar input[type=file]'), new File([JSON.stringify([script])], 'prompt.json'));
    expect(root.textContent).toContain('1 條只用於提示詞的規則未匯入');
    $<HTMLButtonElement>('.rxbar__acts button').click(); await flush();
    expect([...document.querySelectorAll<HTMLInputElement>('input')].map(input => input.value)).toContain('Kept display');
    expect($<HTMLTextAreaElement>('#f-welcome').value).toBe('Existing opening');
    expect(api.saveAuthorAsset).not.toHaveBeenCalled();
  });
  it('混合規則檔只保存顯示規則並保留略過提示', async () => {
    api.fetchRoleDetail.mockResolvedValueOnce({ roleName: 'Synthetic card', roleWelcome: 'Existing opening' });
    await mount('/cards/r1/edit');
    await pickFile($('.rxbar input[type=file]'), new File([JSON.stringify([script, { scriptName: 'Visible imported', findRegex: 'marker', replaceString: 'shown', markdownOnly: true }])], 'mixed.json'));
    expect(root.textContent).toContain('1 條只用於提示詞的規則未匯入');
    await submit();
    expect(api.saveAuthorAsset).toHaveBeenCalledWith('r1', expect.objectContaining({ rules: [expect.objectContaining({ name: 'Visible imported', replace: 'shown' })] }), 'tok');
  });
});
