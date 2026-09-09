<script setup lang="ts">
/**
 * /game/:roleId — 把一張卡當 3D 遊戲玩。
 *
 * 三層分工：
 *   世界（game/world.ts，three.js）：可走動的校園、NPC、日夜光照、傳送、對話鏡頭、小地圖。確定性的東西都在這裡。
 *   狀態（game/zz-parse.ts）：AI 每輪吐的 zzt / zzhud / zzroles 讀成資料——好感、心情、目標、行動、時間、地點。
 *   敘事（game/chat-client.ts，開放 API v1）：玩家走到 NPC 面前說話，AI 回敘事與新狀態。
 * 頁面只做翻譯：狀態 → 世界方法；世界事件（靠近了誰）→ 對話入口。
 *
 * 開場白是公開資料，遊客就能進校園逛；第一次開口才需要登入。登入的人一進來就接上這張卡的對話，
 * 把最近的 AI 回覆依序合併回來——重新整理不會丟存檔。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { fetchGameSpec, fetchRoleDetail } from "@/lib/api";
import { UPSTREAM_API } from "@/lib/config";
import { loginPath } from "@/lib/login-return";
import { pageTitle } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { backwardTo, deleteConversation, fetchArchives, fetchRecentMessages, forkConversation, renameConversation, sendTurn, startConversation, startNewConversation, suggestReply, switchConversation, type Archive } from "@/game/chat-client";
import { confirmDialog } from "@/lib/confirm";
import { HERO_FIELDS, SCENE_FIELDS, WORLD_SPECS, defaultWorldFor, tintOf, worldFromSpec } from "@/game/specs";
import { F, isUnset, mergeTurn, parseTurn, speakerOf, type GameTurn } from "@/game/zz-parse";
import type { World } from "@/game/world";
import { GameAudio } from "@/game/audio";
// 舞台（Moonstage）的面板元件原樣複用：模型選單、人設、長期指令、存檔列表、彈層。它們是純 props／emit 的
// 展示元件，資料與呼叫由這裡接；樣式跟 /play 同一套（.ms-stage 之下）。
import CanvasPopup from "stage-canvas/components/canvas-popup.vue";
import CanvasModelPanel from "stage-canvas/components/canvas-model-panel.vue";
import CanvasPersona from "stage-canvas/components/canvas-persona.vue";
import CanvasDirectives from "stage-canvas/components/canvas-directives.vue";
import CanvasConversationList from "stage-canvas/components/canvas-conversation-list.vue";
import CanvasNotepad from "stage-canvas/components/canvas-notepad.vue";
import CanvasMemory from "stage-canvas/components/canvas-memory.vue";
import { applyMemoryDeleteResponse, normalizeMemoryAtoms, type MemoryAtom } from "stage-canvas/memory";
import * as np from "@/game/notepad-client";
import { ensureStage, remergeStageMessages } from "@/lib/stage-host";
import { addDirective, deleteDirective, fetchDirectives, fetchRoleSettings, saveRoleSettings, updateDirective, type Directive, type RoleSettings } from "@/game/settings-client";
import { getCurrentInstance } from "vue";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { locale, lp } = useLocalePath();
const { t } = useI18n();

const roleId = computed(() => String(route.params.roleId || ""));
const canvas = ref<HTMLCanvasElement | null>(null);
const labels = ref<HTMLDivElement | null>(null);
const minimap = ref<HTMLCanvasElement | null>(null);
let world: World | null = null;
const worldReady = ref(false);
const audio = new GameAudio();
if (import.meta.env.DEV) (window as unknown as { __audio?: GameAudio }).__audio = audio;
const muted = ref(false);
/** 目前頭上掛著任務標記的角色：新出現才響一聲 */
const questNames = new Set<string>();
/** 瀏覽器要先有互動才能出聲：第一次點擊／按鍵解鎖 */
function unlockAudio() { audio.unlock(); void audio.setAmbience(tintOf(turn.value.scene[F.time] || "")); }
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });

const role = ref<{ name: string } | null>(null);
const loadError = ref("");
const turn = ref<GameTurn>(parseTurn(""));
const live = ref("");
const streaming = ref(false);
const playerLine = ref("");
const error = ref("");
const draft = ref("");
const conversationId = ref("");
let abort: (() => void) | null = null;
/** 最近一句玩家訊息的 chatId：重寫要指向它 */
const lastUserChatId = ref("");
const lastUserText = ref("");
/** 最近一則 AI 訊息的 chatId：「繼續」要指向它 */
const lastAiChatId = ref("");
/** 存檔面板 */
const archives = ref<Archive[]>([]);
const archiveLimit = ref(20);
const archiveBusy = ref(false);
const assisting = ref(false);
/**
 * 舞台面板：模型／人設／長期指令／存檔。要 token 才開得起來（都是玩家自己的設定）。
 * 第一次開會把舞台套件裝進來（http、uni 替身、五語文案），跟 /play 同一條路。
 */
type Sheet = "" | "model" | "persona" | "directives" | "archives" | "notepad" | "memory";
const sheet = ref<Sheet>("");
const stageReady = ref(false);
const instance = getCurrentInstance();
const roleSettings = ref<RoleSettings | null>(null);
const globalPersona = ref<{ userName?: string; userSex?: string; userDefine?: string }>({});
const personaSaving = ref(false);
const personaError = ref("");
const directives = ref<{ list: Directive[]; maxCount: number; maxLength: number; loading: boolean; loadFailed: boolean; draft: string; editingSourceId: string; editingText: string; error: string }>({ list: [], maxCount: 10, maxLength: 200, loading: false, loadFailed: false, draft: "", editingSourceId: "", editingText: "", error: "" });
const directivePendingDeleteId = ref("");
let sheetToken = "";

async function ensureStageRuntime(): Promise<boolean> {
  if (stageReady.value) return true;
  const app = instance?.appContext.app;
  if (!app) return false;
  try {
    await ensureStage({ app, router, session, currentPath: () => route.fullPath, lp });
    stageReady.value = true;
    return true;
  } catch (e) {
    console.error("[game] stage runtime failed", e);
    error.value = t("game.error");
    return false;
  }
}
watch(locale, () => { if (stageReady.value) void remergeStageMessages(); });

async function openSheet(which: Exclude<Sheet, "">) {
  const token = await session.accessToken();
  if (!token) { toLogin(); return; }
  sheetToken = token;
  if (!(await ensureStageRuntime())) return;
  if (which === "model" || which === "persona") {
    try { const b = await fetchRoleSettings(UPSTREAM_API, token, locale.value, roleId.value); roleSettings.value = b.settings; globalPersona.value = b.globalPersona; }
    catch (e) { console.error("[game] role settings failed", e); }
  }
  if (which === "directives") { if (!conversationId.value) await restore(token).catch(() => {}); void loadDirectives(); }
  if (which === "archives") void loadArchives(token);
  if (which === "notepad") { if (!conversationId.value) await restore(token).catch(() => {}); void loadNotepad(); }
  if (which === "memory") { if (!conversationId.value) await restore(token).catch(() => {}); void loadMemory(); }
  sheet.value = which;
  world?.lock(true, talking.value);
}
async function closeSheet() {
  // 手帳有沒存的字：關掉前問一次（跟舞台同一句）
  if (sheet.value === "notepad" && notepad.value.draft !== notepad.value.savedContent) {
    const ok = await confirmDialog({ title: t("notepad.discardTitle"), message: "", confirmText: t("notepad.discardOk"), cancelText: t("notepad.keepEditing"), danger: true });
    if (!ok) return;
  }
  sheet.value = "";
  directivePendingDeleteId.value = "";
  if (!talking.value) world?.lock(false);
}
const openSettings = () => openSheet("model");

// ── 手帳：只有玩家看得到的一份記錄，AI 每一輪都會讀。行為照舞台 canvas 那一份（載入失敗不給編輯入口、模板／分享碼／抄別段對話）
const notepad = ref({
  draft: "", savedContent: "", maxLength: 10000, discountThreshold: 2000, loading: false, loadFailed: false, saving: false,
  templatesOpen: false, templates: [] as np.NotepadTemplate[], code: "", previewing: false, previewOpen: false, previewTitle: "", previewContent: "", pendingCode: "",
  importing: false, shareOpen: false, shareCode: "", copyOpen: false, error: "",
});
const notepadSources = ref<np.NotepadSource[]>([]);
const notepadCopyRows = computed(() => notepadSources.value.map((r) => ({ key: r.key, name: r.name })));
const patchNotepad = (p: Partial<typeof notepad.value>) => { notepad.value = { ...notepad.value, ...p }; };
const shareCodeError = (e: unknown) => (e instanceof np.ApiError && e.messageKey ? t(e.messageKey) : t("shareCode.errNotFound"));
async function loadNotepad() {
  const id = conversationId.value;
  if (!id) { patchNotepad({ loading: false, loadFailed: false, draft: "" }); return; }
  patchNotepad({ loading: true, loadFailed: false, error: "" });
  try { const r = await np.fetchNotepad(UPSTREAM_API, sheetToken, locale.value, id); patchNotepad({ draft: r.content, savedContent: r.content, maxLength: r.maxLength, discountThreshold: r.discountThreshold, loading: false }); }
  catch (e) { console.warn("[game] notepad load failed", e); patchNotepad({ loading: false, loadFailed: true }); }
}
async function onSaveNotepad() {
  const id = conversationId.value; if (!id || notepad.value.saving) return;
  patchNotepad({ saving: true, error: "" });
  try { await np.saveNotepad(UPSTREAM_API, sheetToken, locale.value, id, notepad.value.draft); patchNotepad({ saving: false, savedContent: notepad.value.draft }); say(t("notepad.saved")); }
  catch (e) { patchNotepad({ saving: false, error: e instanceof np.ApiError ? e.reason : t("notepad.saveFailed") }); }
}
async function loadNotepadTemplates() {
  try { patchNotepad({ templates: await np.fetchTemplates(UPSTREAM_API, sheetToken, locale.value) }); }
  catch { patchNotepad({ error: t("template.loadFailed") }); }
}
function onToggleNotepadTemplates() { const open = !notepad.value.templatesOpen; patchNotepad({ templatesOpen: open, copyOpen: false }); if (open) void loadNotepadTemplates(); }
async function onApplyNotepadTemplate(templateId: string) {
  try { patchNotepad({ draft: await np.fetchTemplate(UPSTREAM_API, sheetToken, locale.value, templateId), templatesOpen: false, error: "" }); }
  catch { patchNotepad({ error: t("template.loadFailed") }); }
}
async function onSaveNotepadTemplate() {
  const content = notepad.value.draft; if (!content.trim()) { patchNotepad({ error: t("template.titleInvalid") }); return; }
  try { await np.saveTemplate(UPSTREAM_API, sheetToken, locale.value, role.value?.name || t("template.untitled"), content); patchNotepad({ error: "" }); say(t("template.saved")); void loadNotepadTemplates(); }
  catch (e) { patchNotepad({ error: e instanceof np.ApiError ? e.reason : t("template.saveFailed") }); }
}
async function onDeleteNotepadTemplate(templateId: string) {
  try { await np.deleteTemplate(UPSTREAM_API, sheetToken, locale.value, templateId); void loadNotepadTemplates(); }
  catch { patchNotepad({ error: t("template.loadFailed") }); }
}
async function onShareNotepadTemplate(templateId: string) {
  try { const code = await np.shareTemplate(UPSTREAM_API, sheetToken, locale.value, templateId); if (!code) throw new Error("no code"); patchNotepad({ shareOpen: true, previewOpen: false, shareCode: code, error: "" }); }
  catch { patchNotepad({ error: t("template.shareFailed") }); }
}
async function onRevokeShare() {
  const code = notepad.value.shareCode; if (!code) return;
  try { await np.revokeShare(UPSTREAM_API, sheetToken, locale.value, code); patchNotepad({ shareOpen: false, shareCode: "" }); say(t("template.revoked")); }
  catch { patchNotepad({ error: t("template.shareFailed") }); }
}
async function onCopyShareCode() {
  const code = notepad.value.shareCode; if (!code) return;
  try { await navigator.clipboard.writeText(code); say(t("template.copied")); } catch { /* 沒有剪貼簿權限：碼本身就顯示在面板上，玩家可以自己選取 */ }
}
async function onPreviewShareCode(canonical: string) {
  if (!canonical || notepad.value.previewing) return;
  patchNotepad({ previewing: true, error: "" });
  try { const r = await np.previewShareCode(UPSTREAM_API, sheetToken, locale.value, canonical); patchNotepad({ previewing: false, previewOpen: true, shareOpen: false, previewTitle: r.title, previewContent: r.content, pendingCode: canonical }); }
  catch (e) { patchNotepad({ previewing: false, error: shareCodeError(e) }); }
}
async function onConfirmShareImport() {
  const code = notepad.value.pendingCode; if (!code || notepad.value.importing) return;
  patchNotepad({ importing: true, error: "" });
  try { await np.importShareCode(UPSTREAM_API, sheetToken, locale.value, code); patchNotepad({ importing: false, previewOpen: false, pendingCode: "", code: "" }); say(t("template.imported")); void loadNotepadTemplates(); }
  catch (e) { patchNotepad({ importing: false, error: shareCodeError(e) }); }
}
function onToggleNotepadCopy() {
  const open = !notepad.value.copyOpen; patchNotepad({ copyOpen: open, templatesOpen: false });
  if (open && !notepadSources.value.length) np.fetchNotepadSources(UPSTREAM_API, sheetToken, locale.value, roleId.value).then((rows) => { notepadSources.value = rows; }).catch((e) => console.warn("[game] notepad sources failed", e));
}
async function onCopyNotepadFrom(key: string) {
  const src = notepadSources.value.find((r) => r.key === key); if (!src) { patchNotepad({ error: t("notepad.loadFailed") }); return; }
  try { const r = await np.fetchNotepad(UPSTREAM_API, sheetToken, locale.value, src.conversationId); patchNotepad({ draft: r.content, copyOpen: false, error: "" }); }
  catch { patchNotepad({ error: t("notepad.loadFailed") }); }
}
const notepadLabels = computed(() => ({
  title: t("notepad.title"), subtitle: t("notepad.subtitle"), close: t("main.cancel"), save: t("notepad.save"), loading: t("canvas.panel.loading"), loadFailed: t("notepad.loadFailed"), retry: t("notepad.retry"),
  placeholder: t("notepad.placeholder"), waitingConversation: t("directive.waitingConversation"),
  costNotice: t("notepad.costNotice", { threshold: notepad.value.discountThreshold }), overBy: t("notepad.overBy", { count: Math.max(0, notepad.value.draft.length - notepad.value.maxLength) }),
  templateEntry: t("template.entry"), templateApply: t("template.apply"), templateEmpty: t("template.empty"), templateUntitled: t("template.untitled"), templateSaveCurrent: t("template.saveCurrent"),
  templateShare: t("template.share"), templateDelete: t("template.delete"), templateDeleteConfirm: t("template.deleteConfirm"), codePlaceholder: t("template.codePlaceholder"), codePreview: t("template.preview"),
  codeMalformed: t("shareCode.errMalformed"), codeChecksum: t("shareCode.errChecksum"), cancel: t("template.cancel"), importToLibrary: t("template.importToLibrary"), shareHint: t("template.shareHint"),
  revoke: t("template.revoke"), copyCode: t("template.copyCode"), done: t("canvas.archive.done"), copyFrom: t("notepad.copyFrom"), copyEmpty: t("notepad.copyEmpty"), copyPick: t("template.apply"),
  copyOverwrite: t("notepad.copyOverwriteContent"), copyOverwriteOk: t("notepad.copyOverwriteOk"), untitled: t("notepad.untitled"), discardTitle: t("notepad.discardTitle"), discardOk: t("notepad.discardOk"), keepEditing: t("notepad.keepEditing"),
}));

// ── 記憶：背景整理出來的永久記憶（這一局的），只能看與刪
const memory = ref({ atoms: [] as MemoryAtom[], loading: false, loadFailed: false, expandedIds: {} as Record<string, boolean>, deletingId: "", conversationId: "" });
async function loadMemory() {
  const id = conversationId.value;
  if (memory.value.conversationId !== id) memory.value = { ...memory.value, atoms: [], expandedIds: {}, deletingId: "", loadFailed: false, conversationId: id };
  if (!id) { memory.value = { ...memory.value, loading: false }; return; }
  memory.value = { ...memory.value, loading: true, loadFailed: false };
  try { const data = await np.fetchMemoryAtoms(UPSTREAM_API, sheetToken, locale.value, id); if (conversationId.value !== id) return; memory.value = { ...memory.value, atoms: normalizeMemoryAtoms(data), loading: false }; }
  catch (e) { console.warn("[game] memory load failed", e); memory.value = { ...memory.value, loading: false, loadFailed: true }; }
}
function onToggleMemoryExpand(atomId: string) { memory.value = { ...memory.value, expandedIds: { ...memory.value.expandedIds, [atomId]: !memory.value.expandedIds[atomId] } }; }
async function onDeleteMemoryAtom(atomId: string) {
  const id = conversationId.value; if (!id || !atomId || memory.value.deletingId) return;
  const ok = await confirmDialog({ title: t("main.delete"), message: t("chat.memoryDeleteConfirm"), confirmText: t("main.delete"), cancelText: t("main.cancel"), danger: true });
  if (!ok) return;
  memory.value = { ...memory.value, deletingId: atomId };
  try {
    const data = await np.deleteMemoryAtom(UPSTREAM_API, sheetToken, locale.value, id, atomId);
    const atoms = applyMemoryDeleteResponse(memory.value.atoms, atomId, { statusCode: 200, data });
    const expandedIds = { ...memory.value.expandedIds }; delete expandedIds[atomId];
    memory.value = { ...memory.value, atoms, expandedIds }; say(t("chat.memoryDeleted"));
  } catch (e) { console.warn("[game] memory delete failed", e); say(t("chat.memoryDeleteFailed")); }
  finally { memory.value = { ...memory.value, deletingId: "" }; }
}
const memoryLabels = computed(() => ({
  title: t("chat.permanentMemory"), subtitle: t("chat.memoryTip"), close: t("main.cancel"), loading: t("canvas.panel.loading"), loadFailed: t("notepad.loadFailed"), retry: t("notepad.retry"),
  empty: t("chat.memoryEmpty"), delete: t("main.delete"), expand: t("chat.memoryExpand"), collapse: t("chat.memoryCollapse"), sourceAgent: t("chat.memorySourceAgent"), sourceAuto: t("chat.memorySourceAuto"),
  time: { now: t("chat.memoryTimeNow"), min: t("chat.memoryTimeMin"), hour: t("chat.memoryTimeHour"), day: t("chat.memoryTimeDay"), month: t("chat.memoryTimeMonth") },
}));

/** 模型選單按下確認：模型、線路、上下文檔位、思考深度一次交回來 */
async function onApplyModel(payload: Record<string, unknown>) {
  const before = roleSettings.value; if (!before) { closeSheet(); return; }
  const after: RoleSettings = { ...before };
  if (typeof payload.selectModel === "string" && payload.selectModel) after.selectModel = payload.selectModel;
  if (Number.isFinite(Number(payload.context))) after.context = Number(payload.context);
  if (typeof payload.thinkingDepth === "string") after.thinkingDepth = payload.thinkingDepth;
  const r = await saveRoleSettings(UPSTREAM_API, sheetToken, locale.value, roleId.value, before, after);
  if (r.ok) { roleSettings.value = after; say(t("game.settings.saved")); } else error.value = r.reason || t("game.settings.saveFailed");
  closeSheet();
}
async function onSavePersona(value: { personaMode: string; userName: string; userSex: string; userDefine: string; sandboxLevel: string; jailbreak: string }) {
  const before = roleSettings.value; if (!before) return;
  personaSaving.value = true; personaError.value = "";
  const after: RoleSettings = { ...before, personaMode: value.personaMode as RoleSettings["personaMode"], userName: value.userName, userSex: value.userSex as RoleSettings["userSex"], userDefine: value.userDefine, sandboxLevel: value.sandboxLevel, jailbreak: value.jailbreak };
  const r = await saveRoleSettings(UPSTREAM_API, sheetToken, locale.value, roleId.value, before, after);
  personaSaving.value = false;
  if (r.ok) { roleSettings.value = after; syncWorld(); say(t("game.settings.saved")); closeSheet(); } else personaError.value = r.reason || t("game.settings.saveFailed");
}
async function loadDirectives() {
  if (!conversationId.value) return;
  directives.value = { ...directives.value, loading: true, loadFailed: false };
  try { const d = await fetchDirectives(UPSTREAM_API, sheetToken, locale.value, conversationId.value); directives.value = { ...directives.value, ...d, loading: false }; }
  catch (e) { console.error("[game] directives failed", e); directives.value = { ...directives.value, loading: false, loadFailed: true }; }
}
async function onAddDirective() {
  const text = directives.value.draft.trim(); if (!text || !conversationId.value) return;
  try { const d = await addDirective(UPSTREAM_API, sheetToken, locale.value, conversationId.value, text); directives.value = { ...directives.value, ...d, draft: "", error: "" }; }
  catch (e) { console.error("[game] directive add failed", e); directives.value.error = t("game.settings.saveFailed"); }
}
async function onSaveDirectiveEdit(sourceId: string) {
  const text = directives.value.editingText.trim(); if (!text) return;
  try { const d = await updateDirective(UPSTREAM_API, sheetToken, locale.value, conversationId.value, sourceId, text); directives.value = { ...directives.value, ...d, editingSourceId: "", editingText: "", error: "" }; }
  catch (e) { console.error("[game] directive update failed", e); directives.value.error = t("game.settings.saveFailed"); }
}
async function onDeleteDirective(sourceId: string) {
  directivePendingDeleteId.value = "";
  try { const d = await deleteDirective(UPSTREAM_API, sheetToken, locale.value, conversationId.value, sourceId); directives.value = { ...directives.value, ...d, error: "" }; }
  catch (e) { console.error("[game] directive delete failed", e); directives.value.error = t("game.settings.saveFailed"); }
}
const canAddDirective = computed(() => !!conversationId.value && directives.value.list.length < directives.value.maxCount && !!directives.value.draft.trim());

// 文案沿用舞台的 key（ensureStage 把舞台的五語文案併進本站 i18n）
const modelPanelLabels = computed(() => ({ close: t("main.cancel"), done: t("main.sure"), perTurn: t("canvas.panel.perTurn"), contextTitle: t("modelSelect.contextBudgetShort"), contextHint: t("canvas.panel.contextHint"), thinkingTitle: t("modelSelect.thinkingDepth"), thinkingHint: t("canvas.panel.thinkingHint") }));
const personaSexOptions = computed(() => [{ value: "man", label: t("create.roleSex_man") }, { value: "women", label: t("create.roleSex_women") }, { value: "other", label: t("create.roleSex_other") }]);
const personaSandboxOptions = computed(() => ["light", "standard", "immersive", "deep"].map((v) => ({ value: v, label: t(`chat.sandbox_${v}`), hint: t(`chat.sandboxHint_${v}`) })));
const personaLabels = computed(() => ({
  title: t("canvas.panel.persona"), cancel: t("main.cancel"), save: t("main.sure"), modeLabel: t("canvas.panel.personaMode"),
  modeNameOnly: t("canvas.panel.personaModeNameOnly"), modeGlobal: t("canvas.panel.personaModeGlobal"), modeCustom: t("canvas.panel.personaModeCustom"),
  modeNameOnlyHint: t("canvas.panel.personaModeNameOnlyHint"), modeGlobalHint: t("canvas.panel.personaModeGlobalHint"), modeCustomHint: t("canvas.panel.personaModeCustomHint"),
  nickNameHint: session.me?.nickName ? t("canvas.panel.personaNickNameHint", { name: session.me.nickName }) : "",
  nameLabel: t("canvas.panel.personaName"), namePlaceholder: t("canvas.panel.personaNamePlaceholder"), sexLabel: t("canvas.panel.personaSex"),
  defineLabel: t("canvas.panel.personaDefine"), definePlaceholder: t("canvas.panel.personaDefinePlaceholder"), sandboxLabel: t("chat.sandboxLevel"), sandboxDesc: t("chat.sandboxLevelDesc"),
  advanced: t("canvas.panel.personaAdvanced"), jailbreakLabel: t("chat.jailbreak"), jailbreakHint: t("chat.jailbreakTips"), jailbreakReset: t("chat.jailbreakResetDefault"),
}));
const directiveLabels = computed(() => ({
  title: t("directive.title"), close: t("main.cancel"), add: t("directive.add"), edit: t("directive.edit"), delete: t("directive.delete"), deleteConfirmShort: t("directive.delete"),
  save: t("directive.save"), cancel: t("directive.cancel"), empty: t("directive.empty"), loading: t("canvas.panel.loading"), loadFailed: t("directive.loadFailed"), retry: t("notepad.retry"),
  placeholder: t("directive.placeholder"), waitingConversation: t("directive.waitingConversation"), originManual: t("directive.originManual"), originAi: t("directive.originAi"),
}));
const archiveActionLabels = computed(() => ({ rename: t("canvas.archive.rename"), delete: t("main.delete"), done: t("canvas.archive.done"), cancel: t("main.cancel") }));
const archiveRows = computed(() => archives.value.map((a) => ({ key: a.conversationId, name: a.title || t("game.archive.untitled"), title: a.title, countText: t("canvas.archive.messages", { n: a.messageCount }), current: a.isCurrent })));

/** 長期指令要有對話才能掛：還沒開口就先把對話建起來 */
async function ensureConversation() {
  const token = await session.accessToken();
  if (!token || conversationId.value) return;
  try { await restore(token); } catch (e) { console.error("[game] ensure conversation failed", e); }
}

/** 靠近的 NPC（世界回報）與正在對話的 NPC */
const near = ref<string | null>(null);
const talking = ref<string | null>(null);
const toast = ref("");
let toastTimer = 0;
const fading = ref(false);
const showLog = ref(false);
/** 劇情日誌：每一輪的標題與目標，加上玩家說過的話 */
const log = ref<{ kind: "turn" | "you"; title: string; text: string; chatId?: string }[]>([]);
const narr = ref<HTMLDivElement | null>(null);

const signedIn = computed(() => !!session.me);
const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const prose = computed(() => (streaming.value ? parseTurn(live.value).prose : turn.value.prose));
const paragraphs = computed(() => prose.value.split(/\n+/).map((s) => s.trim()).filter(Boolean));
const speaker = computed(() => speakerOf(prose.value, turn.value.roles.map((r) => r.name)) || talking.value || "");
const heroRows = computed(() => HERO_FIELDS.map((f) => ({ ...f, value: turn.value.hero[f.key] || "" })).filter((f) => f.value));
const sceneRows = computed(() => SCENE_FIELDS.map((f) => ({ ...f, value: turn.value.scene[f.key] || "" })).filter((f) => f.value));
const round = computed(() => Number(turn.value.scene[F.round]) || 0);
const objective = computed(() => turn.value.scene[F.objective] || "");
const heroName = computed(() => {
  const n = turn.value.hero[HERO_FIELDS[0].key];
  return isUnset(n) ? t("game.you") : n;
});

watch(role, (r) => { document.title = pageTitle(r ? r.name : t("game.title")); }, { immediate: true });
watch(speaker, (s) => { if (streaming.value) world?.setSpeaking(s || talking.value); });
watch(paragraphs, () => { void nextTick(() => { if (narr.value) narr.value.scrollTop = narr.value.scrollHeight; }); });

/** 狀態 → 世界 */
function syncWorld() {
  if (!world) return;
  const tint = tintOf(turn.value.scene[F.time] || "");
  world.setTint(tint);
  void audio.setAmbience(tint);
  world.setPlayerName(heroName.value);
  const goal = objective.value;
  let newQuest = false;
  for (const r of turn.value.roles) {
    const quest = !!goal && goal.includes(r.name);
    if (quest && !questNames.has(r.name)) newQuest = true;
    if (quest) questNames.add(r.name); else questNames.delete(r.name);
    world.setNpcState(r.name, { affection: r.affection, mood: r.fields[F.mood] || "", quest });
  }
  if (newQuest) void audio.play("quest", { volume: 0.7 });
}

function say(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.value = ""; }, 2600);
}

/** 一輪回覆進來：合併狀態、記日誌、把差異變成世界裡看得到的反饋 */
function applyTurn(full: string, announce: boolean) {
  const before = turn.value;
  const next = mergeTurn(before, parseTurn(full));
  turn.value = next;
  if (next.title.length || next.scene[F.objective]) {
    log.value.push({ kind: "turn", title: next.title.join(" · "), text: next.scene[F.objective] || "" });
  }
  syncWorld();
  if (!announce) return;
  for (const r of next.roles) {
    const prev = before.roles.find((p) => p.name === r.name);
    if (prev && prev.affection !== null && r.affection !== null && r.affection !== prev.affection) {
      const d = r.affection - prev.affection;
      void audio.play(d > 0 ? "affection-up" : "affection-down");
      world?.floatText(r.name, d > 0 ? t("game.affUp", { n: d }) : t("game.affDown", { n: d }), d > 0 ? "w-float--up" : "w-float--down");
    }
  }
  const from = before.scene[F.place] || "", to = next.scene[F.place] || "";
  if (to && to !== from) {
    const label = world?.travelTo(to) || "";
    if (label) {
      void audio.play("travel");
      fading.value = true;
      setTimeout(() => { fading.value = false; }, 700);
      say(t("game.travel", { place: label }));
    }
  }
}

/** 登入的人：接上這張卡的對話，把最近的回覆依序合併回來（存檔） */
async function restore(token: string) {
  const s = await startConversation(UPSTREAM_API, token, roleId.value, locale.value);
  conversationId.value = s.conversationId;
  if (!s.hasHistory) return;
  const rows = await fetchRecentMessages(UPSTREAM_API, token, conversationId.value, locale.value).catch(() => []);
  if (!rows.length) return;
  log.value = [];
  for (const r of rows) {
    if (r.role === "AI") { applyTurn(r.text, false); lastAiChatId.value = r.chatId; }
    else { lastUserChatId.value = r.chatId; lastUserText.value = r.text; log.value.push({ kind: "you", title: heroName.value, text: r.text, chatId: r.chatId }); }
  }
  say(t("game.resumed"));
}

onMounted(async () => {
  void session.restore();
  try {
    const token = (await session.accessToken()) || undefined;
    const d = await fetchRoleDetail(roleId.value, token, locale.value);
    role.value = { name: String(d.roleName || "") };
    const welcome = String(d.roleWelcome || "");
    turn.value = parseTurn(welcome);
    if (!canvas.value || !labels.value) return;
    // 作者存的配置優先；沒有就用站內精修的（示範卡）；再沒有就從角色名單生通用校園
    const names = turn.value.roles.map((r) => r.name);
    const saved = await fetchGameSpec(roleId.value).catch(() => null);
    const spec = saved?.spec && saved.spec.enabled !== false ? worldFromSpec(saved.spec, names) : (WORLD_SPECS[roleId.value] || defaultWorldFor(names));
    audio.setSources(spec.audio);
    const { World } = await import("@/game/world");
    world = new World(canvas.value, labels.value, spec, { onNear: (name) => { near.value = name; }, onFootstep: () => audio.footstep() });
    world.attachMinimap(minimap.value);
    worldReady.value = true;
    syncWorld();
    installTestHooks();
    if (token) await restore(token).catch((e) => console.error("[game] restore failed", e));
  } catch (e) {
    console.error("[game] load failed", e);
    loadError.value = t("game.loadFailed");
  }
});

onBeforeUnmount(() => { abort?.(); world?.dispose(); world = null; audio.dispose(); window.removeEventListener("pointerdown", unlockAudio); window.removeEventListener("keydown", unlockAudio); });

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key.toLowerCase() === "e" && near.value && !talking.value) { e.preventDefault(); openTalk(near.value); }
  if (e.key.toLowerCase() === "l") showLog.value = !showLog.value;
  if (e.key.toLowerCase() === "m") { muted.value = !muted.value; audio.setMuted(muted.value); }
  if (e.key === "Escape" && sheet.value) { closeSheet(); return; }
  if (e.key === "Escape" && talking.value && !streaming.value) closeTalk();
}
window.addEventListener("keydown", onKey);
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

function openTalk(name: string) {
  void audio.play("ui-open", { volume: 0.6 });
  talking.value = name;
  error.value = "";
  world?.lock(true, name);
  void nextTick(() => document.querySelector<HTMLInputElement>(".panel__input input")?.focus());
}
function closeTalk() {
  void audio.play("ui-close", { volume: 0.6 });
  talking.value = null;
  world?.lock(false);
}
function toLogin() { void router.push(lp(loginPath(route.fullPath))); }

async function act(text: string, rewriteChatId = "", continueChatId = "") {
  const message = text.trim();
  if ((!message && !continueChatId) || streaming.value || !talking.value) return;
  error.value = "";
  const token = await session.accessToken();
  if (!token) { toLogin(); return; }
  try {
    if (!conversationId.value) await restore(token);
  } catch (e) {
    console.error("[game] start failed", e);
    error.value = t("game.error");
    return;
  }
  if (!continueChatId) playerLine.value = message;
  if (!rewriteChatId && !continueChatId) log.value.push({ kind: "you", title: heroName.value, text: message });
  draft.value = "";
  live.value = "";
  streaming.value = true;
  world?.setSpeaking(talking.value);
  // 讓 AI 知道玩家是走到誰面前說的：這一句是舞台事實
  const wire = continueChatId ? "" : rewriteChatId ? message : t("game.wireApproach", { name: talking.value }) + message;
  // 繼續：把上一段敘事留著，新的字接在後面
  const prefix = continueChatId ? turn.value.prose + "\n" : "";
  abort = sendTurn({ base: UPSTREAM_API, token, conversationId: conversationId.value, message: wire, lang: locale.value, rewriteChatId, continueChatId }, {
    onDelta: (full) => { live.value = prefix + full; },
    onDone: (full) => {
      streaming.value = false;
      abort = null;
      world?.setSpeaking(null);
      if (full.trim()) applyTurn(full, true);
      // 這一輪落盤後記下玩家那句的 chatId，重寫才有目標
      void fetchRecentMessages(UPSTREAM_API, token, conversationId.value, locale.value, 4)
        .then((rows) => {
          const u = [...rows].reverse().find((r) => r.role === "USER"); if (u) { lastUserChatId.value = u.chatId; lastUserText.value = u.text; const entry = [...log.value].reverse().find((e) => e.kind === "you" && !e.chatId); if (entry) entry.chatId = u.chatId; }
          const a = [...rows].reverse().find((r) => r.role === "AI"); if (a) lastAiChatId.value = a.chatId;
        })
        .catch(() => {});
    },
    onError: (why) => {
      streaming.value = false;
      abort = null;
      world?.setSpeaking(null);
      console.error("[game] turn failed:", why);
      error.value = why === "insufficient_credits" ? t("game.credits") : t("game.error");
    },
  });
}

function stop() { abort?.(); }

/** 繼續：讓 AI 接著上一段往下寫 */
function continueTurn() {
  if (!lastAiChatId.value || streaming.value || !talking.value) return;
  void act("", "", lastAiChatId.value);
}

async function loadArchives(token: string) {
  archiveBusy.value = true;
  try { const r = await fetchArchives(UPSTREAM_API, token, roleId.value, locale.value); archives.value = r.archives; archiveLimit.value = r.limit; }
  catch (e) { console.error("[game] archives failed", e); error.value = t("game.error"); }
  finally { archiveBusy.value = false; }
}
/** 換到另一段存檔：世界狀態從那一段的歷史重建 */
async function adopt(newId: string, welcome: string, token: string) {
  conversationId.value = newId;
  lastUserChatId.value = ""; lastUserText.value = ""; lastAiChatId.value = ""; playerLine.value = ""; live.value = ""; log.value = [];
  turn.value = parseTurn(welcome || turn.value.prose ? welcome : "");
  const rows = await fetchRecentMessages(UPSTREAM_API, token, newId, locale.value).catch(() => []);
  if (!rows.length && !welcome) { const s = await startConversation(UPSTREAM_API, token, roleId.value, locale.value).catch(() => null); if (s) turn.value = parseTurn(s.welcome); }
  for (const r of rows) {
    if (r.role === "AI") { applyTurn(r.text, false); lastAiChatId.value = r.chatId; }
    else { lastUserChatId.value = r.chatId; lastUserText.value = r.text; log.value.push({ kind: "you", title: heroName.value, text: r.text, chatId: r.chatId }); }
  }
  syncWorld();
}
async function onPickArchive(key: string) {
  const a = archives.value.find((x) => x.conversationId === key); if (!a) return;
  await archiveSwitch(a);
}
async function onRenameArchive(key: string, title: string) {
  const a = archives.value.find((x) => x.conversationId === key); const next = title.trim();
  if (!a || !next || next === a.title) return;
  const r = await renameConversation(UPSTREAM_API, sheetToken, locale.value, key, next);
  if (r.ok) a.title = next; else error.value = t("game.error");
}
async function onDeleteArchive(key: string) {
  if (archiveBusy.value) return;
  archiveBusy.value = true;
  try {
    const wasCurrent = key === conversationId.value;
    const r = await deleteConversation(UPSTREAM_API, sheetToken, locale.value, key);
    if (!r.ok) { error.value = t("game.error"); return; }
    await loadArchives(sheetToken);
    if (wasCurrent) { const next = archives.value.find((x) => x.isCurrent) || archives.value[0]; if (next) await adopt(next.conversationId, "", sheetToken); }
  } finally { archiveBusy.value = false; }
}
async function archiveSwitch(a: Archive) {
  if (a.isCurrent || archiveBusy.value) return;
  const token = await session.accessToken(); if (!token) return;
  archiveBusy.value = true;
  try {
    const r = await switchConversation(UPSTREAM_API, token, locale.value, a.conversationId);
    if (!r.ok) { error.value = t("game.error"); return; }
    await adopt(r.conversationId || a.conversationId, r.welcome, token);
    await loadArchives(token);
    say(t("game.archive.switched", { name: a.title || t("game.archive.untitled") }));
    closeSheet();
  } finally { archiveBusy.value = false; }
}
async function archiveFork() {
  const token = await session.accessToken(); if (!token || archiveBusy.value) return;
  archiveBusy.value = true;
  try {
    if (!conversationId.value) await restore(token);
    const r = await forkConversation(UPSTREAM_API, token, locale.value, conversationId.value);
    if (!r.ok) { error.value = r.code === "conversation_limit_reached" ? t("game.archive.full", { n: archiveLimit.value }) : t("game.error"); return; }
    await adopt(r.conversationId, r.welcome, token);
    await loadArchives(token);
    say(t("game.archive.forked"));
  } finally { archiveBusy.value = false; }
}

/** 劇情回溯：回到某一句玩家訊息之前，之後的都不算 */
async function rewindTo(chatId: string) {
  if (!chatId || streaming.value) return;
  const token = await session.accessToken(); if (!token) { toLogin(); return; }
  const ok = await confirmDialog({ title: t("game.rewind"), message: t("game.rewindConfirm"), confirmText: t("game.rewind"), cancelText: t("dialog.cancel"), danger: true });
  if (!ok) return;
  const r = await backwardTo(UPSTREAM_API, token, locale.value, conversationId.value, chatId);
  if (!r.ok) { error.value = t("game.error"); return; }
  // 伺服器可能非同步收尾：等一下再從歷史重建世界
  await new Promise((res) => setTimeout(res, 1200));
  await adopt(conversationId.value, "", token);
  say(t("game.rewound"));
}

/** 重寫：把最近一句玩家訊息重跑一次，AI 換一種回法 */
function regenerate() {
  if (!lastUserChatId.value || streaming.value || !talking.value) return;
  void act(lastUserText.value, lastUserChatId.value);
}

/** 幫答：伺服器擬一句填進輸入框，送不送玩家決定 */
async function assist() {
  if (assisting.value || streaming.value) return;
  const token = await session.accessToken();
  if (!token) { toLogin(); return; }
  assisting.value = true;
  try {
    if (!conversationId.value) await restore(token);
    const r = await suggestReply(UPSTREAM_API, token, conversationId.value, locale.value);
    if (r.reply) fill(r.reply);
    else error.value = r.code === "insufficient_credits" ? t("game.credits") : t("game.error");
  } catch (e) {
    console.error("[game] assist failed", e);
    error.value = t("game.error");
  } finally {
    assisting.value = false;
  }
}

/** 新的一局：存下這一段、從開場白重來，世界狀態歸零 */
async function restart() {
  if (streaming.value) return;
  const token = await session.accessToken();
  if (!token) { toLogin(); return; }
  const ok = await confirmDialog({ title: t("game.newChat"), message: t("game.newChatConfirm"), confirmText: t("game.newChat"), cancelText: t("dialog.cancel") });
  if (!ok) return;
  try {
    if (!conversationId.value) await restore(token);
    const s = await startNewConversation(UPSTREAM_API, token, conversationId.value, locale.value);
    conversationId.value = s.conversationId;
    lastUserChatId.value = ""; lastUserText.value = ""; playerLine.value = ""; live.value = ""; log.value = [];
    turn.value = parseTurn(s.welcome);
    syncWorld();
    closeTalk();
    say(t("game.newChatDone"));
  } catch (e) {
    console.error("[game] restart failed", e);
    error.value = t("game.error");
  }
}

/** 行動鍵只把模板填進輸入框，玩家改完自己送——行動是玩家的，不是按鈕的 */
function fill(text: string) {
  draft.value = text;
  void nextTick(() => { const el = document.querySelector<HTMLInputElement>(".panel__input input"); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); });
}

/**
 * 開發用的檢查掛鉤（threejs 畫布檢查器的契約）：setState 把場景擺到指定狀態並回 {state}，
 * setPausedForScreenshot 停模擬不停渲染。正式 build 不掛。
 */
function installTestHooks() {
  if (!import.meta.env.DEV || !world) return;
  const w = world;
  const states: Record<string, () => void> = {
    "active-play": () => { closeTalk(); },
    night: () => { closeTalk(); w.setTint("night"); },
    dusk: () => { closeTalk(); w.setTint("dusk"); },
    talking: () => { const n = w.npcNames()[0]; if (!n) throw new Error("no npc"); const st = w as unknown as { step(dt: number): void }; w.goTo(n); for (let i = 0; i < 300; i++) st.step(1 / 60); openTalk(n); for (let i = 0; i < 120; i++) st.step(1 / 60); },
  };
  (window as unknown as { __THREE_GAME_TEST_HOOKS__: unknown }).__THREE_GAME_TEST_HOOKS__ = {
    setState: (name: string) => { const fn = states[name]; if (!fn) throw new Error(`unknown state ${name}`); fn(); return { state: name }; },
    setPausedForScreenshot: (v: boolean) => { w.paused = v; },
    seed: () => {},
  };
}
</script>

<template>
  <div class="game" :class="{ 'game--talking': talking, 'game--log': showLog }">
    <div class="game__view">
      <canvas ref="canvas" class="game__canvas"></canvas>
      <div ref="labels" class="game__labels" aria-hidden="true"></div>
    </div>
    <div class="game__fade" :class="{ 'game__fade--on': fading }" aria-hidden="true"></div>

    <div v-if="!worldReady && !loadError" class="game__boot" aria-live="polite">
      <div class="game__boot-ring"></div>
      <p>{{ $t("game.loadingWorld") }}</p>
    </div>

    <header class="game__top">
      <RouterLink class="btn btn--ghost btn--sm game__back" :to="lp(`/cards/${roleId}`)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        <span class="game__role">{{ role?.name || $t("game.title") }}</span>
      </RouterLink>
      <div class="game__title" v-if="turn.title.length">
        <span v-for="(chip, i) in turn.title" :key="i" class="game__chip">{{ chip }}</span>
      </div>
      <div class="game__scene">
        <span v-for="r in sceneRows" :key="r.key" class="game__scene-item"><small>{{ $t(r.label) }}</small>{{ r.value }}</span>
        <span v-if="round" class="game__scene-item game__scene-item--round">{{ $t("game.round", { n: round }) }}</span>
        <span v-if="session.wallet" class="game__scene-item game__scene-item--round" :title="$t('game.points')">{{ $t("game.pointsShort", { n: (session.wallet.score || 0) + (session.wallet.tempScore || 0) }) }}</span>
        <button type="button" class="btn btn--ghost btn--sm game__logbtn" :class="{ 'game__logbtn--on': showLog }" @click="showLog = !showLog">{{ $t("game.log") }}</button>
        <button type="button" class="btn btn--ghost btn--sm btn--icon game__logbtn" :title="$t('game.settings.title')" :aria-label="$t('game.settings.title')" @click="openSettings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
        </button>
        <button type="button" class="btn btn--ghost btn--sm btn--icon game__logbtn" :title="$t(muted ? 'game.unmute' : 'game.mute')" :aria-label="$t(muted ? 'game.unmute' : 'game.mute')" @click="muted = !muted; audio.setMuted(muted)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path v-if="!muted" d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/><path v-else d="m22 9-6 6M16 9l6 6"/></svg>
        </button>
      </div>
    </header>

    <aside class="hud">
      <div v-if="objective" class="hud__block hud__block--goal">
        <div class="hud__eyebrow">{{ $t("game.objective") }}</div>
        <p>{{ objective }}</p>
      </div>
      <div v-if="heroRows.length" class="hud__block">
        <div class="hud__eyebrow">{{ $t("game.hero") }}</div>
        <dl class="hud__rows">
          <template v-for="r in heroRows" :key="r.key"><dt>{{ $t(r.label) }}</dt><dd>{{ r.value }}</dd></template>
        </dl>
      </div>
      <div v-if="turn.roles.length" class="hud__block">
        <div class="hud__eyebrow">{{ $t("game.npcs") }}</div>
        <ul class="hud__npcs">
          <li v-for="r in turn.roles" :key="r.name">
            <button type="button" class="hud__npc" :title="$t('game.goTo', { name: r.name })" @click="world?.goTo(r.name)">
              <b>{{ r.name }}</b>
              <span v-if="r.affection !== null" class="hud__aff"><i :style="{ width: Math.max(0, Math.min(100, r.affection)) + '%' }"></i></span>
            </button>
          </li>
        </ul>
      </div>
    </aside>

    <canvas ref="minimap" class="minimap" width="150" height="150" aria-hidden="true"></canvas>

    <aside v-if="showLog" class="logpanel">
      <div class="logpanel__head"><b>{{ $t("game.log") }}</b><button type="button" class="btn btn--ghost btn--sm" @click="showLog = false">✕</button></div>
      <p v-if="!log.length" class="logpanel__empty">{{ $t("game.noLog") }}</p>
      <ol v-else class="logpanel__list">
        <li v-for="(e, i) in log" :key="i" :class="`logpanel__item logpanel__item--${e.kind}`">
          <b>{{ e.title }}</b>
          <span v-if="e.text">{{ e.text }}</span>
          <button v-if="e.kind === 'you' && e.chatId && signedIn" type="button" class="logpanel__rewind" :disabled="streaming" @click="rewindTo(e.chatId)">{{ $t("game.rewind") }}</button>
        </li>
      </ol>
    </aside>

    <!-- 舞台的面板元件：跟 /play 同一套外觀與行為（.ms-stage 之下吃舞台的樣式） -->
    <div v-if="stageReady" class="ms-stage game__sheets">
      <CanvasPopup :open="sheet === 'model'" :title="$t('canvas.panel.model')" :close-label="$t('main.cancel')" @close="closeSheet">
        <CanvasModelPanel v-if="sheet === 'model' && roleSettings" mode="model" :open="sheet === 'model'" :title="$t('canvas.panel.model')" :role-id="roleId"
                          :selected-value="roleSettings.selectModel" :model-name="roleSettings.selectModel" :score-text="''" :context-value="roleSettings.context" :thinking-depth="roleSettings.thinkingDepth"
                          :show-thinking-process="true" :labels="modelPanelLabels" @apply="onApplyModel" @close="closeSheet" />
      </CanvasPopup>
      <CanvasPopup :open="sheet === 'persona'" :title="$t('canvas.panel.persona')" :close-label="$t('main.cancel')" @close="closeSheet">
        <CanvasPersona v-if="sheet === 'persona' && roleSettings" :persona-mode="roleSettings.personaMode || 'global'" :global-persona="globalPersona" :nick-name="session.me?.nickName || ''"
                       :user-name="roleSettings.userName" :user-sex="roleSettings.userSex" :user-define="roleSettings.userDefine" :sandbox-level="roleSettings.sandboxLevel" :jailbreak="roleSettings.jailbreak"
                       :default-jailbreak="''" :sex-options="personaSexOptions" :sandbox-options="personaSandboxOptions" :saving="personaSaving" :error="personaError" :labels="personaLabels"
                       @save="onSavePersona" @close="closeSheet" />
      </CanvasPopup>
      <CanvasPopup :open="sheet === 'directives'" :title="$t('directive.title')" :close-label="$t('main.cancel')" @close="closeSheet">
        <CanvasDirectives v-if="sheet === 'directives'" :list="directives.list" :count-text="`(${directives.list.length}/${directives.maxCount})`" :max-length="directives.maxLength"
                          :loading="directives.loading" :load-failed="directives.loadFailed" :has-conversation="!!conversationId" :can-add="canAddDirective"
                          :draft="directives.draft" :editing-source-id="directives.editingSourceId" :editing-text="directives.editingText" :pending-delete-id="directivePendingDeleteId" :error="directives.error" :labels="directiveLabels"
                          @add="onAddDirective" @edit="(id: string) => { const d = directives.list.find((x) => x.sourceId === id); directives.editingSourceId = id; directives.editingText = d ? d.text : ''; }"
                          @save-edit="onSaveDirectiveEdit" @cancel-edit="directives.editingSourceId = ''; directives.editingText = ''" @ask-delete="directivePendingDeleteId = $event"
                          @confirm-delete="onDeleteDirective" @cancel-delete="directivePendingDeleteId = ''" @retry="loadDirectives" @close="closeSheet"
                          @update:draft="directives.draft = $event" @update:editing-text="directives.editingText = $event" />
      </CanvasPopup>
      <CanvasPopup :open="sheet === 'archives'" :title="$t('canvas.archive.load')" :close-label="$t('main.cancel')" @close="closeSheet">
        <CanvasConversationList v-if="sheet === 'archives'" :title="$t('canvas.archive.load')" :count-text="`${archives.length}/${archiveLimit}`" :items="archiveRows"
                                :empty-text="$t('canvas.panel.historyEmpty')" :current-label="$t('canvas.panel.historyCurrent')" :close-text="$t('main.cancel')"
                                :full="archives.length >= archiveLimit" :full-text="$t('canvas.archive.full', { count: archives.length, limit: archiveLimit })" :labels="archiveActionLabels"
                                @pick="onPickArchive" @rename="onRenameArchive" @delete="onDeleteArchive" @close="closeSheet" />
        <!-- 跟舞台彈層同一款底部按鈕（.bottom .btn），分叉／新的一局排在列表自己的「取消」旁 -->
        <div class="bottom game__sheetfoot" :aria-disabled="archiveBusy || archives.length >= archiveLimit">
          <div class="btn" role="button" tabindex="0" @click="archiveBusy || archives.length >= archiveLimit || archiveFork()">{{ $t("game.archive.fork") }}</div>
          <div class="btn" role="button" tabindex="0" @click="archiveBusy || archives.length >= archiveLimit || (closeSheet(), restart())">{{ $t("game.newChat") }}</div>
        </div>
      </CanvasPopup>
      <CanvasPopup :open="sheet === 'notepad'" :title="$t('notepad.title')" :close-label="$t('main.cancel')" @close="closeSheet">
        <CanvasNotepad v-if="sheet === 'notepad'" :draft="notepad.draft" :saved-content="notepad.savedContent" :max-length="notepad.maxLength" :discount-threshold="notepad.discountThreshold"
                       :loading="notepad.loading" :load-failed="notepad.loadFailed" :saving="notepad.saving" :has-conversation="!!conversationId"
                       :templates-open="notepad.templatesOpen" :templates="notepad.templates" :code="notepad.code" :previewing="notepad.previewing" :preview-open="notepad.previewOpen"
                       :preview-title="notepad.previewTitle" :preview-content="notepad.previewContent" :importing="notepad.importing" :share-open="notepad.shareOpen" :share-code="notepad.shareCode"
                       :copy-open="notepad.copyOpen" :conversations="notepadCopyRows" :error="notepad.error" :labels="notepadLabels"
                       @save="onSaveNotepad" @retry="loadNotepad" @toggle-templates="onToggleNotepadTemplates" @apply-template="onApplyNotepadTemplate" @save-template="onSaveNotepadTemplate"
                       @update:code="patchNotepad({ code: $event })" @preview-code="onPreviewShareCode" @cancel-preview="patchNotepad({ previewOpen: false, pendingCode: '' })" @confirm-import="onConfirmShareImport"
                       @share-template="onShareNotepadTemplate" @delete-template="onDeleteNotepadTemplate" @copy-share-code="onCopyShareCode" @revoke-share="onRevokeShare" @close-share="patchNotepad({ shareOpen: false })"
                       @toggle-copy="onToggleNotepadCopy" @copy-from="onCopyNotepadFrom" @close="closeSheet" @update:draft="patchNotepad({ draft: $event })" />
      </CanvasPopup>
      <CanvasPopup :open="sheet === 'memory'" :title="memoryLabels.title" :close-label="$t('main.cancel')" @close="closeSheet">
        <CanvasMemory v-if="sheet === 'memory'" :atoms="memory.atoms" :loading="memory.loading" :load-failed="memory.loadFailed" :expanded-ids="memory.expandedIds" :deleting-id="memory.deletingId" :labels="memoryLabels"
                      @toggle-expand="onToggleMemoryExpand" @delete="onDeleteMemoryAtom" @retry="loadMemory" @close="closeSheet" />
      </CanvasPopup>
    </div>

    <p v-if="loadError" class="game__fatal" role="alert">{{ loadError }}</p>
    <div v-if="toast" class="game__toast">{{ toast }}</div>

    <!-- 靠近 NPC：提示按 E（手機給一顆鍵） -->
    <div v-if="near && !talking" class="game__hint">
      <button type="button" class="btn btn--primary btn--lg" @click="openTalk(near)">{{ $t("game.talkTo", { name: near }) }}</button>
      <small>{{ $t("game.talkKey") }}</small>
    </div>
    <div v-else-if="!talking && worldReady" class="game__hint game__hint--move"><small>{{ touch ? $t("game.tapHint") : $t("game.moveHint") + " · " + $t("game.dragHint") }}</small></div>

    <!-- 對話框：走到 NPC 面前才出現 -->
    <footer v-if="talking" class="panel">
      <div class="panel__head">
        <b class="panel__who">{{ speaker }}</b>
        <div class="panel__tools">
          <button v-if="signedIn" type="button" class="btn btn--ghost btn--sm" :disabled="streaming || !lastUserChatId" :title="$t('game.regenHint')" @click="regenerate">{{ $t("game.regen") }}</button>
          <button v-if="signedIn" type="button" class="btn btn--ghost btn--sm" :disabled="streaming || assisting" :title="$t('game.assistHint')" @click="assist">{{ assisting ? $t("game.thinking") : $t("game.assist") }}</button>
          <button v-if="signedIn" type="button" class="btn btn--ghost btn--sm" :disabled="streaming || !lastAiChatId" :title="$t('game.continueHint')" @click="continueTurn">{{ $t("game.continue") }}</button>
          <button v-if="signedIn" type="button" class="btn btn--ghost btn--sm" :disabled="streaming" @click="openSheet('archives')">{{ $t("game.archive.title") }}</button>
          <button v-if="signedIn" type="button" class="btn btn--ghost btn--sm" :disabled="streaming" @click="restart">{{ $t("game.newChat") }}</button>
          <button type="button" class="btn btn--ghost btn--sm" :disabled="streaming" @click="openSheet('model')">{{ $t("game.settings.model") }}</button>
          <button type="button" class="btn btn--ghost btn--sm" :disabled="streaming" @click="openSheet('persona')">{{ $t("game.settings.persona") }}</button>
          <button type="button" class="btn btn--ghost btn--sm" :disabled="streaming" @click="openSheet('directives')">{{ $t("game.settings.directives") }}</button>
          <button v-if="signedIn" type="button" class="btn btn--ghost btn--sm" :disabled="streaming" @click="openSheet('notepad')">{{ $t("notepad.title") }}</button>
          <button v-if="signedIn" type="button" class="btn btn--ghost btn--sm" :disabled="streaming" @click="openSheet('memory')">{{ $t("chat.permanentMemory") }}</button>
          <button type="button" class="btn btn--ghost btn--sm panel__close" :disabled="streaming" @click="closeTalk">{{ $t("game.close") }}</button>
        </div>
      </div>
      <div ref="narr" class="panel__narr">
        <p v-if="playerLine" class="panel__you"><span>{{ heroName }}</span>{{ playerLine }}</p>
        <p v-for="(p, i) in paragraphs" :key="i" class="panel__p">{{ p }}</p>
        <p v-if="streaming && !paragraphs.length" class="panel__p panel__p--wait">{{ $t("game.thinking") }}</p>
        <span v-if="streaming" class="panel__caret" aria-hidden="true"></span>
        <p v-if="error" class="panel__error" role="alert">{{ error }}</p>
      </div>
      <div v-if="!signedIn" class="panel__login">
        <span>{{ $t("game.loginToTalk") }}</span>
        <button type="button" class="btn btn--primary" @click="toLogin">{{ $t("game.login") }}</button>
      </div>
      <template v-else>
        <div class="panel__actions" v-if="turn.actions.length">
          <button v-for="a in turn.actions" :key="a.full" type="button" class="btn act" :title="a.full" :disabled="streaming" @click="fill(a.full)">
            {{ a.short }}
          </button>
        </div>
        <form class="panel__input" @submit.prevent="act(draft)">
          <input v-model="draft" class="input" :placeholder="$t('game.placeholder')" :disabled="streaming" autocomplete="off" />
          <button v-if="streaming" type="button" class="btn" @click="stop">{{ $t("game.stop") }}</button>
          <button v-else type="submit" class="btn btn--primary" :disabled="!draft.trim()">{{ $t("game.send") }}</button>
        </form>
      </template>
    </footer>
  </div>
</template>

<style scoped>
.game {
  --ink: #f4f6fb; --ink-2: rgba(244, 246, 251, 0.74); --ink-3: rgba(244, 246, 251, 0.52);
  --glass: rgba(12, 16, 32, 0.62); --glass-line: rgba(140, 200, 255, 0.22); --cyan: #8fd6ff;
  position: relative; height: 100vh; height: 100dvh; overflow: hidden; color: var(--ink); background: #0d1020;
}
.game__view { position: absolute; inset: 0; isolation: isolate; z-index: 1; }
.game__canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.game__labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.game__fade { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; transition: opacity 350ms var(--ease); z-index: 6; }
.game__fade--on { opacity: 1; }

.game__boot { position: absolute; inset: 0; z-index: 7; display: grid; place-content: center; gap: var(--s-3); justify-items: center; background: #0d1020; color: var(--ink-2); font-size: 13px; letter-spacing: 0.12em; }
.game__boot-ring { width: 46px; height: 46px; border-radius: 50%; border: 3px solid rgba(143, 214, 255, 0.2); border-top-color: var(--cyan); animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 玻璃面板：藍邊、斜切角，跟世界裡的白牆藍邊同一套語言 */
.hud__block, .panel, .logpanel, .game__toast {
  background: var(--glass); border: 1px solid var(--glass-line); backdrop-filter: blur(14px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 10px 30px -14px rgba(0, 0, 0, 0.7);
}
.hud__block, .panel, .logpanel { clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px)); border-radius: 4px; }

.game__top {
  position: absolute; left: 0; right: 0; top: 0; z-index: 3;
  display: flex; align-items: center; gap: var(--s-4); flex-wrap: wrap;
  padding: var(--s-3) var(--s-4); background: linear-gradient(180deg, rgba(5, 6, 14, 0.55), transparent); pointer-events: none;
}
.game__top > * { pointer-events: auto; }
.game__back { color: var(--ink); padding-left: var(--s-2); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6); }
.game__back:hover { background: rgba(255, 255, 255, 0.12); color: var(--ink); }
.game__role { font-weight: 600; max-width: 40vw; overflow: hidden; text-overflow: ellipsis; }
.game__title { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.game__chip { font-size: 12px; letter-spacing: 0.06em; padding: 3px 10px; background: var(--glass); border: 1px solid var(--glass-line); backdrop-filter: blur(8px); clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%); }
.game__scene { margin-left: auto; display: flex; gap: var(--s-4); align-items: flex-end; font-size: 13px; color: var(--ink); flex-wrap: wrap; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7); }
.game__scene-item small { display: block; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cyan); opacity: 0.85; }
.game__scene-item--round { font-variant-numeric: tabular-nums; margin-right: var(--s-2); }
.game__logbtn { color: var(--ink); border: 1px solid var(--glass-line); background: var(--glass); }
.game__logbtn--on, .game__logbtn:hover { background: rgba(143, 214, 255, 0.18); color: var(--ink); }

.hud { position: absolute; left: var(--s-4); top: 76px; width: min(260px, 32vw); display: grid; gap: var(--s-2); z-index: 3; transition: opacity var(--dur) var(--ease); }
.game--talking .hud { opacity: 0.35; pointer-events: none; }
.hud__block { padding: var(--s-3) var(--s-4); font-size: 13px; line-height: 1.55; }
.hud__block p { margin: 0; color: var(--ink); }
.hud__block--goal { border-color: rgba(255, 213, 74, 0.55); }
.hud__block--goal .hud__eyebrow { color: #ffd54a; }
.hud__eyebrow { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--cyan); margin-bottom: var(--s-1); }
.hud__rows { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--s-3); margin: 0; }
.hud__rows dt { color: var(--ink-3); white-space: nowrap; }
.hud__rows dd { margin: 0; overflow-wrap: anywhere; }
.hud__npcs { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.hud__npc { all: unset; display: grid; grid-template-columns: 1fr 64px; align-items: center; gap: var(--s-2); cursor: pointer; padding: 4px 6px; margin: 0 -6px; border-radius: 4px; }
.hud__npc:hover { background: rgba(143, 214, 255, 0.12); }
.hud__aff { height: 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.18); overflow: hidden; }
.hud__aff i { display: block; height: 100%; background: linear-gradient(90deg, #ff9ab5, #ff5c8a); transition: width var(--dur-slow) var(--ease); }

.minimap { position: absolute; right: var(--s-4); top: 76px; width: 150px; height: 150px; z-index: 3; filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.5)); }

.logpanel { position: absolute; right: var(--s-4); top: 240px; width: min(320px, 40vw); max-height: calc(100vh - 264px); overflow-y: auto; z-index: 4; padding: var(--s-3) var(--s-4); font-size: 13px; }
/* 日誌開著且在對話：對話框靠左、讓出右邊一欄給日誌，兩個面板不重疊 */
@media (min-width: 861px) {
  .game--log .panel { left: var(--s-4); transform: none; width: min(920px, calc(100% - 320px - 3 * var(--s-4))); }
  .game--log.game--talking .logpanel { top: 76px; }
  .game--log.game--talking .minimap { display: none; }
}
.logpanel__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s-2); color: var(--cyan); letter-spacing: 0.1em; text-transform: uppercase; font-size: 11px; }
.logpanel__empty { color: var(--ink-3); margin: 0; }
.logpanel__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.logpanel__item { display: grid; gap: 2px; padding-left: var(--s-3); border-left: 2px solid var(--glass-line); }
.logpanel__item--turn { border-left-color: #ffd54a; }
.logpanel__item--you { border-left-color: var(--cyan); color: var(--ink-2); }
.logpanel__item b { font-size: 12px; }

.game__sheets { position: absolute; inset: 0; z-index: 8; pointer-events: none; }
.game__sheets > * { pointer-events: auto; }
.game__sheetfoot { gap: 8px; margin-top: -4px; }
.game__sheetfoot[aria-disabled="true"] { opacity: 0.5; pointer-events: none; }
.logpanel__rewind { all: unset; cursor: pointer; font-size: 11px; color: var(--cyan); text-decoration: underline; text-underline-offset: 2px; }
.logpanel__rewind:disabled { opacity: 0.4; cursor: default; }
.game__fatal { position: absolute; left: 50%; top: 40%; transform: translateX(-50%); z-index: 4; background: var(--glass); padding: var(--s-4) var(--s-5); border-radius: 4px; }
.game__toast { position: absolute; left: 50%; top: 72px; transform: translateX(-50%); z-index: 4; padding: 6px 16px; font-size: 13px; letter-spacing: 0.04em; }

.game__hint { position: absolute; left: 50%; bottom: 6vh; transform: translateX(-50%); z-index: 3; display: grid; justify-items: center; gap: 6px; text-align: center; }
.game__hint small { color: var(--ink-2); font-size: 12px; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7); white-space: nowrap; }
.game__hint--move { bottom: 3vh; }
.game__hint .btn--primary { box-shadow: 0 0 0 4px rgba(143, 214, 255, 0.18), 0 8px 24px -8px rgba(0, 0, 0, 0.7); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 9px rgba(143, 214, 255, 0.08), 0 8px 24px -8px rgba(0, 0, 0, 0.7); } }

.panel {
  position: absolute; left: 50%; bottom: var(--s-4); transform: translateX(-50%); z-index: 5;
  width: min(920px, calc(100% - 2 * var(--s-4))); display: grid; gap: var(--s-3);
  padding: var(--s-4) var(--s-5) var(--s-4) calc(var(--s-5) + 6px);
  animation: rise 260ms var(--ease);
}
.panel::before { content: ""; position: absolute; left: 0; top: 14px; bottom: 14px; width: 3px; background: var(--cyan); }
@keyframes rise { from { transform: translate(-50%, 12px); opacity: 0; } }
.panel__head { display: flex; align-items: center; justify-content: space-between; }
.panel__who { font-size: 16px; letter-spacing: 0.04em; color: var(--cyan); }
.panel__who::before { content: "▸ "; opacity: 0.7; }
.panel__tools { display: flex; gap: 2px; flex-wrap: wrap; justify-content: flex-end; }
.panel__tools .btn { color: var(--ink-2); }
.panel__tools .btn:hover { color: var(--ink); background: rgba(255, 255, 255, 0.1); }
.panel__close { color: var(--ink-2); }
.panel__close:hover { color: var(--ink); background: rgba(255, 255, 255, 0.1); }
.panel__narr { position: relative; max-height: 20vh; overflow-y: auto; font-size: 15px; line-height: 1.75; scroll-behavior: smooth; }
.panel__p { margin: 0 0 0.6em; }
.panel__p--wait { color: var(--ink-3); }
.panel__you { margin: 0 0 var(--s-2); font-size: 13px; color: var(--ink-2); }
.panel__you span { display: inline-block; margin-right: var(--s-2); padding: 0 8px; border-radius: 3px; background: rgba(143, 214, 255, 0.16); color: var(--cyan); font-size: 11px; }
.panel__caret { display: inline-block; width: 8px; height: 1em; vertical-align: -2px; background: var(--ink); animation: caret 0.9s steps(2) infinite; }
@keyframes caret { 50% { opacity: 0; } }
.panel__error { margin: var(--s-2) 0 0; color: #ff9b96; font-size: 13px; }
.panel__login { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-2) var(--s-3); background: rgba(143, 214, 255, 0.1); border: 1px dashed var(--glass-line); font-size: 13px; }
.panel__actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.act { color: var(--ink); background: rgba(143, 214, 255, 0.1); border-color: var(--glass-line); border-radius: 3px; clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); padding: 0 var(--s-5); }
.act:hover { background: rgba(143, 214, 255, 0.24); }
.panel__input { display: flex; gap: var(--s-2); }
.panel__input .input { background: rgba(255, 255, 255, 0.08); border-color: var(--glass-line); color: var(--ink); border-radius: 3px; }
.panel__input .input::placeholder { color: var(--ink-3); }

@media (max-width: 860px) {
  /* 手機：頂列只留返回鍵與日誌鍵，場景資料收進日誌；標題碎片單獨一行 */
  .game__scene { position: absolute; right: var(--s-3); top: var(--s-3); margin: 0; width: auto; gap: 0; }
  .game__scene-item { display: none; }
  .game__title { width: 100%; }
  .hud { top: 108px; width: 52vw; }
  .hud__block:not(.hud__block--goal) { display: none; }
  .game--talking .hud, .game--talking .minimap { display: none; }
  .minimap { top: 96px; width: 96px; height: 96px; }
  .logpanel { top: 200px; width: calc(100% - 2 * var(--s-4)); }
  .panel { bottom: var(--s-3); width: calc(100% - 2 * var(--s-3)); padding: var(--s-3) var(--s-4) var(--s-3) calc(var(--s-4) + 6px); }
  .panel__narr { max-height: 28vh; font-size: 14px; }
  .game__hint small { white-space: normal; max-width: 80vw; }
}
</style>

<!-- 世界裡的標籤（CSS2DRenderer 產生的 DOM 不在 scoped 範圍內） -->
<style>
.w-label { font: 600 13px/1.2 var(--font); color: #fff; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7), 0 0 12px rgba(0, 0, 0, 0.4); white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
.w-label--you { color: #ffe9a8; font-size: 12px; }
.w-label--place { color: rgba(255, 255, 255, 0.9); font-size: 12px; font-weight: 500; letter-spacing: 0.08em; padding: 2px 8px; border: 1px solid rgba(143, 214, 255, 0.35); background: rgba(12, 16, 32, 0.45); clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); }
.w-label--npc b { color: var(--c, #fff); font-size: 14px; }
.w-hearts { font-size: 11px; color: #ff7fa5; letter-spacing: 1px; }
.w-quest[hidden], .w-mood[hidden] { display: none; }
.w-quest { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #ffd54a; color: #3a2a00; font-size: 13px; font-weight: 800; animation: w-bounce 1.2s ease-in-out infinite; }
@keyframes w-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.w-mood { max-width: 220px; white-space: normal; font: 12px/1.45 var(--font); color: #2a2c3a; background: rgba(255, 255, 255, 0.94); border-radius: 12px; padding: 6px 10px; position: relative; }
.w-mood::after { content: ""; position: absolute; left: 50%; bottom: -5px; width: 10px; height: 10px; background: inherit; transform: translateX(-50%) rotate(45deg); }
.w-float { font: 700 14px/1 var(--font); color: #fff; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7); animation: w-float 1.4s ease-out forwards; white-space: nowrap; }
.w-float--up { color: #ff8fb0; }
.w-float--down { color: #9fb6ff; }
@keyframes w-float { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-36px); opacity: 0; } }
</style>
