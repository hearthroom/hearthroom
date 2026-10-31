<script setup lang="ts">
/**
 * 預設編輯器：酒館式的條目清單（新增、排序、開關、移出），加上採樣參數與版本。
 *
 * 結構就是酒館的預設本身，從酒館匯入的與在這裡寫的是同一種東西（owner 2026-10-29）。
 * 角色、玩家、世界書、對話記錄這幾條由綺夢社提供：列出來讓作者知道自己的條目落在哪，
 * 但不能改內容、不能關、不能搬到對話記錄中間——那是快取、錨點與時間流的根基。
 *
 * 哪條要調整、哪條不支援，以服務端 analyze 為準；編輯中停手半秒就重判一次。
 * 每次儲存是一個新版本：已經在用舊版本的對話不會跟著變，要用新版得在畫布裡自己換。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";
import { useI18n } from "vue-i18n";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { ApiError } from "@/lib/api";
import { pageTitle } from "@/lib/i18n";
import { dateTime, whole } from "@/lib/format";
import { confirmDialog } from "@/lib/confirm";
import {
  analyzePreset, createPreset, fetchModelOptions, fetchPreset, fetchRevision, resultUnknown, revisePreset,
  type Compatibility, type ModelOption, type PresetDetail, type WriteReceipt,
} from "@/lib/presets";
import {
  adaptationId, inspectRows, withSelectionDefaults, isPromptPack, nativeProblems, addEntry, canDeleteEntry, deleteEntry, detachedPrompts, entryRows, insertEntry, moveEntryTo, newDocument, prefixLayout, restoreOrder, setEnabled,
  type EntryRow, type InspectRow, type PresetDocument, type ProvidedKind,
} from "@/lib/st-preset";
import { operationKeys, usePresetAccess } from "@/lib/use-preset-access";
import { usePointerReorder } from "@/lib/use-pointer-reorder";
import { useLocalePath } from "@/lib/use-locale";
import PresetEntryDetail from "@/components/preset/PresetEntryDetail.vue";
import PresetParams from "@/components/preset/PresetParams.vue";
import PresetExportDialog from "@/components/preset/PresetExportDialog.vue";
import PresetInspectDialog from "@/components/preset/PresetInspectDialog.vue";
import PresetReauth from "@/components/preset/PresetReauth.vue";
import PresetToolReply from "@/components/preset/PresetToolReply.vue";
import { anyParamInvalid, invalidParams, paramLabelKey } from "@/components/preset/preset-params";

const { t } = useI18n();
const { lp } = useLocalePath();
const route = useRoute();
const router = useRouter();
const { token, needsConsent, consentNeeded, reauthorize } = usePresetAccess();
const ops = operationKeys();

// /me/presets/new 與 /me/presets/:id 是同一條路由：建好之後換網址時元件沿用，離開前的確認也跟著走
const presetId = computed(() => (typeof route.params.presetId === "string" && route.params.presetId !== "new" ? route.params.presetId : ""));
const detail = ref<PresetDetail | null>(null);
const doc = ref<PresetDocument | null>(null);
const savedDoc = ref<PresetDocument | null>(null);
const title = ref("");
const models = ref<string[]>([]);
const modelOptions = ref<ModelOption[]>([]);
const saved = ref("");
/** 這份草稿是以哪個版本為基準改的；存檔時拿它跟上游比，別處先存了就會知道 */
const baseVersion = ref(0);
const loading = ref(true);
const loadError = ref("");
const compat = ref<Compatibility | null>(null);
const analyzing = ref(false);
const selected = ref("");
const providedOpen = ref("");
const query = ref("");
const saving = ref(false);
const unconfirmed = ref(false);
const saveError = ref("");
const conflict = ref(false);
const status = ref("");
const savedVersion = ref(0);
const exporting = ref(false);
const inspecting = ref<{ rows: InspectRow[]; name: string } | null>(null);

const snapshot = () => JSON.stringify({ title: title.value, models: models.value, doc: doc.value });
const dirty = computed(() => !!doc.value && snapshot() !== saved.value);
const rows = computed(() => (doc.value ? entryRows(doc.value) : []));
const custom = computed(() => rows.value.filter((r) => r.slot !== "F"));
const detached = computed(() => (doc.value ? detachedPrompts(doc.value) : []));
const compatOf = (id: string) => compat.value?.entries.find((e) => e.identifier === id);
const selectedRow = computed(() => custom.value.find((r) => r.identifier === selected.value));
const savedPrompt = (id: string) => savedDoc.value ? entryRows(savedDoc.value).find((r) => r.identifier === id)?.prompt ?? (savedDoc.value.st.prompts as { identifier: string }[] | undefined)?.find((p) => p.identifier === id) : undefined;
const head = computed(() => detail.value?.version ?? 0);
const imported = computed(() => detail.value?.sourceKind === "imported");
/** 封存的預設只能看：上游不收它的新版本，畫面上也不讓改（匯出照樣可以） */
const readOnly = computed(() => !!detail.value?.archived);

const q = computed(() => query.value.trim().toLowerCase());
const matches = (r: EntryRow) => !q.value || `${r.prompt.name ?? ""}\n${r.prompt.content ?? ""}`.toLowerCase().includes(q.value);
const found = computed(() => custom.value.filter(matches));
/** 已確認改放到對話記錄之後的條目：照採用後的位置列、不再標需調整（來源的位置不動，匯出照原檔） */
const movedAfter = (r: EntryRow) => !!doc.value?.selection.acceptedAdaptationIds.includes(adaptationId(r.identifier));
/** 上游自動調過位置的條目照調整後的位置列（targetSlot S＝之後、P＝之前） */
const shownSide = (r: EntryRow): "before" | "after" => {
  if (movedAfter(r)) return "after";
  const c = compatOf(r.identifier);
  if (c?.uiStatus === "relocated" && (c.targetSlot === "S" || c.targetSlot === "P")) return c.targetSlot === "S" ? "after" : "before";
  return r.side;
};
const groupOf = (side: "before" | "after") => found.value.filter((r) => shownSide(r) === side);
// 拖曳排序（owner 2026-10-30）：搜尋中、唯讀時不給拖——篩過的清單看不出真正的前後
const listEl = ref<HTMLElement | null>(null);
const canDrag = computed(() => !readOnly.value && !q.value);
const reorder = usePointerReorder({ list: listEl, enabled: () => canDrag.value, onDrop: (id, target) => { if (doc.value) moveEntryTo(doc.value, id, target); } });
const dropBefore = computed(() => (reorder.target.value && "beforeId" in reorder.target.value ? reorder.target.value.beforeId : ""));
const dropEnd = computed(() => (reorder.target.value && "side" in reorder.target.value ? reorder.target.value.side : ""));
const tagOf = (r: EntryRow) => (movedAfter(r) ? undefined : compatOf(r.identifier)?.uiStatus);
/**
 * 清單上的一列：自訂條目，或由綺夢社提供、鎖住的一列。對話記錄之前那一區照真實送出順序（畫面規格 (a)）：
 * 版面跟伺服器組前綴同一套規則（prefixLayout）。dropId 是拖曳時「放在這一列前面」用的排序識別；
 * marker 缺席、由伺服器補位的那幾列沒有 dropId——那裡沒有能放進去的位置，只顯示。
 */
type ListItem = { key: string; dropId: string; row?: EntryRow; provided?: ProvidedKind | "history" };
// 伺服器有收進前綴的條目：開著、不是不支援、也沒被調到對話記錄之後（錨點只看這些）
const inPrefix = (id: string) => {
  const r = rows.value.find((x) => x.identifier === id);
  return !!r && compatOf(id)?.uiStatus !== "unsupported" && shownSide(r) === "before";
};
const itemsOf = (side: "before" | "after"): ListItem[] => {
  const shown = groupOf(side);
  // 上游把位置調到另一邊的條目（畫在這一區、實際排在對話記錄另一邊）：它前面不是能放進去的位置
  const entry = (r: EntryRow): ListItem => ({ key: r.identifier, dropId: shownSide(r) === r.side ? r.identifier : "", row: r });
  if (side === "after" || q.value || !doc.value) return shown.map(entry);
  const byId = new Map(shown.map((r) => [r.identifier, r]));
  const items: ListItem[] = [];
  prefixLayout(doc.value, inPrefix).forEach((it, n) => {
    if (it.kind === "entry") {
      const r = byId.get(it.id);
      if (r) { items.push(entry(r)); byId.delete(it.id); }
      return;
    }
    items.push({ key: `${it.kind}:${n}`, dropId: it.virtual ? "" : it.marker, provided: it.kind });
  });
  // 位置被上游調到對話記錄之前、但排序上在後面的條目，接在最後
  for (const r of byId.values()) items.push(entry(r));
  items.push({ key: "history", dropId: "chatHistory", provided: "history" });
  return items;
};

const blocked = computed(() => custom.value.filter((r) => {
  if (!r.enabled) return false;
  const c = compatOf(r.identifier);
  if (c?.uiStatus === "unsupported") return true;
  return c?.uiStatus === "needs_adjustment" && !(c.adaptationId && doc.value?.selection.acceptedAdaptationIds.includes(c.adaptationId));
}));
const blockedText = computed(() => t("preset.editor.saveBlocked", {
  n: whole(blocked.value.length), names: blocked.value.map((r) => r.prompt.name || t("preset.entry.untitled")).join(t("preset.setting.separator")),
}, blocked.value.length));
/**
 * 本站寫的預設：上游每一條都查（關著、移出排序的也算），所以「停用後再存」對它沒用，
 * 只能改掉或刪掉。這裡照上游的規則先找出來，存檔鈕不開，免得送出去才 422。
 */
const nativeBlocked = computed(() => {
  if (imported.value || !doc.value) return [];
  const prompts = (doc.value.st.prompts ?? []) as { identifier: string; name?: string }[];
  return nativeProblems(doc.value).map((id) => {
    if (id === "temperature" || id === "top_p") return t(paramLabelKey(id));
    return prompts.find((p) => p.identifier === id)?.name || t("preset.entry.untitled");
  });
});
const canSave = computed(() => !readOnly.value && !nativeBlocked.value.length && dirty.value && !saving.value && !analyzing.value && !blocked.value.length && !!title.value.trim() && !!doc.value && !anyParamInvalid(doc.value));

function adopt(next: PresetDocument, nextTitle: string, nextModels: string[], version: number, clean = true) {
  doc.value = withSelectionDefaults(next);
  title.value = nextTitle;
  models.value = [...nextModels];
  baseVersion.value = version;
  if (clean) { saved.value = snapshot(); savedDoc.value = structuredClone(next); }
  if (!rows.value.some((r) => r.identifier === selected.value)) selected.value = "";
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const tk = await token();
    void fetchModelOptions(tk).then((o) => { modelOptions.value = o; }).catch(() => {});
    if (!presetId.value) {
      detail.value = null;
      savedVersion.value = 0;
      adopt(newDocument(t("preset.entries.newName")), "", [], 0);
      compat.value = null;
      return;
    }
    detail.value = await fetchPreset(tk, presetId.value);
    const { revision, compatibility } = await fetchRevision(tk, presetId.value, detail.value.headRevisionId);
    adopt(revision.document, detail.value.title, revision.recommendedModels, revision.version);
    compat.value = compatibility;
    document.title = pageTitle(detail.value.title);
  } catch (err) {
    if (!consentNeeded(err)) loadError.value = err instanceof Error ? err.message : t("preset.error.unavailable");
  } finally {
    loading.value = false;
  }
}

// 停手半秒重判一次；回來的順序可能亂，只收最後一次送出的結果
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
watch(doc, () => {
  // 剛讀進來、還沒動過的版本，上游已經一起給了判定
  if (!doc.value || loading.value || (!dirty.value && compat.value)) return;
  clearTimeout(timer);
  analyzing.value = true;
  timer = setTimeout(async () => {
    const mine = ++seq;
    try {
      const out = await analyzePreset(await token(), doc.value!);
      if (mine === seq) compat.value = out;
    } catch (err) {
      consentNeeded(err);
    } finally {
      if (mine === seq) analyzing.value = false;
    }
  }, 500);
}, { deep: true });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 送出後沒收到回應：用同一把冪等鍵再問，拿回原本的收據，不會多存一個版本。 */
async function send(action: string, call: (key: string) => Promise<WriteReceipt>): Promise<WriteReceipt> {
  for (let attempt = 0; ; attempt++) {
    try {
      const receipt = await call(ops.key(action));
      ops.done(action);
      return receipt;
    } catch (err) {
      if (!resultUnknown(err) || attempt >= 3) { if (!resultUnknown(err)) ops.done(action); throw err; }
      unconfirmed.value = true;
      await wait(2000 * (attempt + 1));
    }
  }
}

async function save() {
  if (!doc.value || !canSave.value) return;
  saving.value = true;
  saveError.value = "";
  status.value = "";
  const action = presetId.value ? `revise:${presetId.value}:${baseVersion.value}:${snapshot()}` : `create:${snapshot()}`;
  try {
    // 同一把冪等鍵重送的必須是同一份內容：先凍住，重試期間玩家再改也不會混進去
    const input = structuredClone({ title: title.value.trim(), document: toRaw(doc.value), recommendedModels: [...models.value] });
    const sent = snapshot();
    const id = presetId.value;
    const tk = await token();
    const receipt = await send(action, (key) => id
      ? revisePreset(tk, id, { ...input, expectedVersion: baseVersion.value }, key)
      : createPreset(tk, input, key));
    conflict.value = false;
    savedVersion.value = receipt.version;
    saved.value = sent;
    savedDoc.value = structuredClone(input.document);
    if (!id) {
      await router.replace(lp(`/me/presets/${receipt.presetId}`));
      await load();
      savedVersion.value = receipt.version;
    } else {
      baseVersion.value = receipt.version;
      detail.value = await fetchPreset(await token(), id).catch(() => detail.value);
    }
  } catch (err) {
    if (consentNeeded(err)) return;
    if (err instanceof ApiError && err.reason === "preset_revision_conflict") conflict.value = true;
    else saveError.value = resultUnknown(err) ? t("preset.error.unknown") : err instanceof Error ? err.message : t("preset.error.unavailable");
  } finally {
    unconfirmed.value = false;
    saving.value = false;
  }
}

/** 別處先存了新版本：讀回最新的版本號當基準，草稿不動，再存就是更新的一版。 */
async function reloadLatest() {
  if (!presetId.value) return;
  try {
    detail.value = await fetchPreset(await token(), presetId.value);
    baseVersion.value = detail.value.version;
    conflict.value = false;
  } catch (err) {
    if (!consentNeeded(err)) saveError.value = err instanceof Error ? err.message : t("preset.error.unavailable");
  }
}

async function restoreFrom(revisionId: string, version: number) {
  if (!presetId.value) return;
  if (dirty.value && !(await confirmDialog({ title: t("preset.editor.leave.title"), message: t("preset.editor.leave.body"), confirmText: t("preset.editor.leave.confirm"), cancelText: t("preset.editor.leave.keep"), focusCancel: true }))) return;
  try {
    const { revision, compatibility } = await fetchRevision(await token(), presetId.value, revisionId);
    // 從舊版本開始的草稿：存檔時仍以目前最新版本為基準，存成新的一版，不改舊版
    adopt(revision.document, title.value, revision.recommendedModels, head.value, false);
    compat.value = compatibility;
    status.value = t("preset.versions.restore.done", { n: version });
  } catch (err) {
    if (!consentNeeded(err)) saveError.value = err instanceof Error ? err.message : t("preset.error.unavailable");
  }
}

function newEntry() {
  if (!doc.value) return;
  query.value = "";
  providedOpen.value = "";
  selected.value = addEntry(doc.value, { name: t("preset.entries.newName"), slot: "P" });
}

function resetOrder() {
  if (!doc.value || !savedDoc.value) return;
  restoreOrder(doc.value, savedDoc.value);
  status.value = t("preset.entries.resetOrder.done");
}

function reinsert(id: string) {
  if (!doc.value) return;
  const side = savedDoc.value && entryRows(savedDoc.value).find((r) => r.identifier === id)?.side === "after" ? "S" : "P";
  insertEntry(doc.value, id, side);
  selected.value = id;
  status.value = t("preset.unused.reinsert.done");
}

async function removeUnused(id: string, name: string) {
  if (!doc.value) return;
  const ok = await confirmDialog({ title: t("preset.unused.delete.title", { name }), message: t("preset.unused.delete.body"), confirmText: t("preset.unused.delete.confirm"), cancelText: t("preset.unused.delete.keep"), danger: true });
  if (ok) deleteEntry(doc.value, id);
}

const inEntry = computed(() => !!selected.value || !!providedOpen.value);
// 頁首兩個分頁（UI/UX editor-layout 規格）：條目／預設設定。用 v-show 切，草稿與欄位狀態都留著
const tab = ref<"entries" | "settings">("entries");
const TABS = ["entries", "settings"] as const;
function tabKey(e: KeyboardEvent) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  tab.value = tab.value === "entries" ? "settings" : "entries";
  void nextTick(() => document.querySelector<HTMLElement>(`[data-testid=editor-tab-${tab.value}]`)?.focus());
}
// 存檔被擋的原因可能在另一個分頁：採樣值不合法時在「預設設定」上點一個紅點
const settingsAlert = computed(() => !!doc.value && anyParamInvalid(doc.value));
// 存檔被不合法的採樣值擋住時，存檔列說是哪幾個，並給一顆鍵跳過去（QA Q1）
const badParams = computed(() => (doc.value ? invalidParams(doc.value) : []));
function goToBadParam() {
  const key = badParams.value[0];
  if (!key) return;
  tab.value = "settings";
  void nextTick(() => {
    // 數值欄；選項型參數（推理強度等）是第二個下拉——第一個下拉是「沿用模型設定／自訂」
    const field = document.querySelector<HTMLElement>(`[data-testid=param-${key}]`);
    const input = field?.querySelector<HTMLElement>("input[type=number]") ?? field?.querySelectorAll<HTMLElement>("select")[1] ?? field?.querySelector<HTMLElement>("select");
    input?.scrollIntoView({ block: "center" });
    input?.focus({ preventScroll: true });
  });
}
const detailEl = ref<HTMLElement | null>(null);
/** 剛才從哪一列點進來：返回時捲回那一列、焦點也回去 */
let cameFrom = "";
const phoneLayout = () => window.matchMedia?.("(max-width: 760px)").matches ?? true;
/**
 * 進條目編輯：捲到頂、焦點在條目名稱。手機上條目清單會整個藏起來、頁面一下子變短，不重設捲動的話
 * 瀏覽器會停在原本的高度，畫面就落在頁底的「更多參數」（owner 2026-10-30 回報）。
 */
function enterEntry(focusSelector: string) {
  void nextTick(() => {
    // 手機：清單藏起來、頁面變短，回頁頂。桌機：頁面不捲，只有編輯區自己回頂端（清單位置不動）
    if (phoneLayout()) window.scrollTo({ top: 0 });
    else if (detailEl.value) detailEl.value.scrollTop = 0;
    document.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
  });
}
function pick(id: string) {
  selected.value = id; providedOpen.value = ""; cameFrom = `entry:${id}`;
  // 焦點放條目標題，不放名稱輸入框：iPad 等觸控裝置不會沒點輸入框就彈鍵盤（owner 2026-10-30）
  enterEntry(`#${CSS.escape(`entry-title-${id}`)}`);
}
function leaveEntry() {
  const from = cameFrom;
  selected.value = ""; providedOpen.value = "";
  void nextTick(() => {
    const [kind, id] = [from.slice(0, from.indexOf(":")), from.slice(from.indexOf(":") + 1)];
    const el = kind === "entry"
      ? [...document.querySelectorAll<HTMLElement>("[data-testid=entry-row]")].find((b) => b.closest("[data-drag-id]")?.getAttribute("data-drag-id") === id)
      : [...document.querySelectorAll<HTMLElement>("[data-testid=provided-row]")].find((b) => b.dataset.provided === id);
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  });
}
/** 查看位置：照條目真實的位置；上游調到對話記錄之後的照調整後的位置 */
function inspect(r: EntryRow) {
  if (!doc.value) return;
  const rows = inspectRows(doc.value, r.identifier, inPrefix, shownSide(r) === "after");
  if (rows) inspecting.value = { rows, name: r.prompt.name || t("preset.entry.untitled") };
}
function pickProvided(key: string) {
  providedOpen.value = key; selected.value = ""; cameFrom = `provided:${key}`;
  enterEntry(".preset-editor__provided h2");
}

function toggleModel(value: string, on: boolean) {
  models.value = on ? [...new Set([...models.value, value])] : models.value.filter((m) => m !== value);
}
const modelLabel = (value: string) => modelOptions.value.find((o) => o.value === value)?.label ?? value;

const guard = (e: BeforeUnloadEvent) => { if (dirty.value) e.preventDefault(); };
onBeforeRouteLeave(async () => {
  if (!dirty.value || saving.value) return true;
  return confirmDialog({ title: t("preset.editor.leave.title"), message: t("preset.editor.leave.body"), confirmText: t("preset.editor.leave.confirm"), cancelText: t("preset.editor.leave.keep"), focusCancel: true });
});
watch(presetId, (next, prev) => { if (next !== prev && !saving.value) void load(); });
onMounted(() => {
  document.title = pageTitle(t(presetId.value ? "preset.editor.title.edit" : "preset.editor.title.new"));
  window.addEventListener("beforeunload", guard);
  // 從匯入頁過來：告訴他存好了、在哪裡找得到
  if (typeof route.query.imported === "string") {
    status.value = t("preset.report.confirmed", { name: route.query.imported });
    // 只講這一次：重新整理或改名之後不該還顯示當初的名字（QA N04）
    void router.replace({ path: route.path, hash: route.hash });
  }
  void load();
});
onBeforeUnmount(() => { window.removeEventListener("beforeunload", guard); clearTimeout(timer); });
</script>

<template>
  <div class="page preset-editor" :class="{ 'preset-editor--entry': !!selectedRow || !!providedOpen }">
    <!-- 一個高度只有一個返回（owner 2026-10-30）：手機的條目編輯層頂端是「返回條目」，回到條目清單層才是「返回我的預設」 -->
    <nav class="preset-editor__crumb">
      <RouterLink :to="lp('/me/presets')" class="preset-crumb" data-testid="preset-crumb" :data-in-entry="inEntry || undefined">{{ $t("preset.editor.back") }}</RouterLink>
      <button v-if="inEntry" type="button" class="btn btn--sm preset-editor__entryBack" data-testid="entry-back" @click="leaveEntry">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        {{ $t("preset.entry.back") }}
      </button>
    </nav>
    <h1 class="sr-only">{{ $t(presetId ? "preset.editor.title.edit" : "preset.editor.title.new") }}</h1>

    <PresetReauth v-if="needsConsent" @confirm="reauthorize" @cancel="router.push(lp('/me/presets'))" />
    <div v-else-if="loading" class="preset-editor__body" aria-busy="true"><div class="panel ghost preset-editor__ghost" /><div class="panel ghost preset-editor__ghost" /></div>
    <p v-else-if="loadError" class="panel preset-editor__card" role="alert">{{ loadError }} <button type="button" class="btn btn--sm" @click="load">{{ $t("preset.list.retry") }}</button></p>

    <template v-else-if="doc">
      <header class="panel preset-editor__head">
        <fieldset class="preset-editor__fieldset" :disabled="readOnly">
        <div class="field preset-editor__titleField">
          <label for="preset-title">{{ $t("preset.editor.name") }}</label>
          <input id="preset-title" v-model="title" class="input" maxlength="60" required :placeholder="$t('preset.editor.name.placeholder')" data-testid="preset-title" />
        </div>
        </fieldset>
        <div class="seg preset-editor__tabs" role="tablist" :aria-label="$t('preset.editor.tabs.label')" @keydown="tabKey">
          <button v-for="k in TABS" :key="k" type="button" role="tab" class="seg__item" :class="{ 'seg__item--on': tab === k }" :aria-selected="tab === k" :tabindex="tab === k ? 0 : -1"
            :aria-controls="`editor-panel-${k}`" :data-testid="`editor-tab-${k}`" @click="tab = k">
            {{ k === "entries" ? $t("preset.editor.tab.entries", { n: whole(custom.length) }, custom.length) : $t("preset.editor.tab.settings") }}
            <template v-if="k === 'settings' && settingsAlert"><span class="editor-tab__dot" aria-hidden="true"></span><span class="sr-only">{{ $t("preset.editor.tab.settings.alert") }}</span></template>
          </button>
        </div>
      </header>
      <p v-if="readOnly" class="notice" role="status" data-testid="preset-archived">{{ $t("preset.row.archived") }} · {{ $t("preset.error.archived") }}</p>

      <p v-if="conflict" class="notice" role="alert" data-testid="preset-conflict">
        {{ $t("preset.error.revisionConflict") }}
        <button type="button" class="btn btn--sm" @click="reloadLatest">{{ $t("preset.error.reload") }}</button>
      </p>
      <p v-if="saveError" class="notice notice--error" role="alert">{{ saveError }}</p>

      <div v-show="tab === 'entries'" id="editor-panel-entries" class="preset-editor__body" role="tabpanel">
        <aside ref="listEl" class="panel preset-editor__list" :aria-label="$t('preset.entries.title')">
          <div class="preset-editor__listHead">
            <h2>{{ $t("preset.entries.title") }}</h2>
            <button v-if="!readOnly" type="button" class="btn btn--sm" data-testid="entry-add" @click="newEntry">{{ $t("preset.entries.add") }}</button>
          </div>
          <p class="subtle">{{ $t("preset.entries.hint") }}</p>
          <input v-model="query" type="search" class="input" :placeholder="$t('preset.entries.search')" :aria-label="$t('preset.entries.search')" data-testid="entry-search" />
          <p v-if="q" class="subtle" role="status">{{ found.length ? $t("preset.entries.searchResult", { n: whole(found.length) }, found.length) : $t("preset.entries.searchEmpty", { q: query.trim() }) }}</p>

          <div v-if="!custom.length" class="preset-editor__empty">
            <strong>{{ $t("preset.editor.emptyEntries.title") }}</strong>
            <p class="subtle">{{ $t("preset.editor.emptyEntries.body") }}</p>
          </div>

          <template v-for="side in (['before', 'after'] as const)" :key="side">
            <!-- 拖曳中兩區都要看得到，空的那一區才放得進去 -->
            <div v-if="itemsOf(side).length || reorder.dragging.value" class="preset-editor__group" :data-drop-side="side"
              :class="{ 'is-drop-end': dropEnd === side }">
              <h3 class="eyebrow">{{ $t(`preset.entries.group.${side}`) }}</h3>
              <!-- 照真實送出順序（畫面規格 (a)）：由綺夢社提供的內容是鎖住的一列，插在它真正的位置 -->
              <ul>
                <template v-for="it in itemsOf(side)" :key="it.key">
                  <li v-if="it.row" :data-drag-id="it.row.identifier" :data-drop-id="it.dropId || undefined"
                    :class="{ 'is-drop-before': !!it.dropId && dropBefore === it.dropId, 'is-dragging': reorder.dragging.value === it.row.identifier }">
                    <!-- 把手：滑鼠直接拖、手機長按拖；鍵盤與輔助科技用條目選單的上移／下移，所以不進 Tab 順序 -->
                    <span v-if="canDrag" class="preset-editor__handle" aria-hidden="true" data-testid="entry-drag" @pointerdown="reorder.start($event, it.row.identifier)">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                    </span>
                    <button type="button" class="preset-editor__row" :class="{ 'is-on': it.row.identifier === selected, 'is-off': !it.row.enabled }" :aria-current="it.row.identifier === selected || undefined" data-testid="entry-row" @click="pick(it.row.identifier)">
                      <span class="preset-editor__rowName">{{ it.row.prompt.name || $t("preset.entry.untitled") }}</span>
                      <span v-if="tagOf(it.row)" class="preset-editor__tag" :class="`preset-editor__tag--${tagOf(it.row)}`">{{ $t(tagOf(it.row) === "needs_adjustment" ? "preset.report.status.adjust" : tagOf(it.row) === "relocated" ? "preset.report.status.relocated" : "preset.report.status.unsupported") }}</span>
                      <span v-else-if="!it.row.enabled" class="subtle">{{ $t("preset.entries.disabled") }}</span>
                    </button>
                    <label class="preset-editor__toggle">
                      <input type="checkbox" :disabled="readOnly" :checked="it.row.enabled" :aria-label="`${$t('preset.entry.enabled')}：${it.row.prompt.name || $t('preset.entry.untitled')}`" @change="setEnabled(doc, it.row.identifier, ($event.target as HTMLInputElement).checked, { keepSource: imported })" />
                    </label>
                  </li>
                  <li v-else :data-drop-id="it.dropId || undefined" :class="{ 'is-drop-before': !!it.dropId && dropBefore === it.dropId }">
                    <span v-if="canDrag" class="preset-editor__handle" aria-hidden="true"></span>
                    <button type="button" class="preset-editor__row" :class="{ 'is-on': providedOpen === it.provided }" data-testid="provided-row" :data-provided="it.provided" @click="pickProvided(it.provided!)">
                      <svg class="preset-editor__lock" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                      <span class="preset-editor__rowName">{{ $t(`preset.provided.${it.provided}`) }}</span>
                      <span class="sr-only">{{ $t("preset.provided.label") }}</span>
                    </button>
                  </li>
                </template>
              </ul>
            </div>
          </template>

          <div v-if="!readOnly" class="preset-editor__tools">
            <button type="button" class="btn btn--sm btn--ghost" :disabled="!savedDoc" @click="resetOrder">{{ $t("preset.entries.resetOrder") }}</button>
          </div>
          <details class="preset-editor__library" data-testid="entry-library">
            <summary>{{ $t("preset.entries.unused", { n: detached.length }) }}</summary>
            <p class="subtle">{{ detached.length ? $t("preset.unused.body") : $t("preset.unused.empty") }}</p>
            <ul>
              <li v-for="p in detached" :key="p.identifier">
                <span class="preset-editor__rowName">{{ p.name || $t("preset.entry.untitled") }}</span>
                <button v-if="!readOnly" type="button" class="btn btn--sm btn--ghost" @click="reinsert(p.identifier)">{{ $t("preset.unused.reinsert") }}</button>
                <!-- 檔案裡另一組排序還用著的條目不給刪：刪了那一組會懸空 -->
                <button v-if="!readOnly && canDeleteEntry(doc, p.identifier)" type="button" class="btn btn--sm btn--danger" @click="removeUnused(p.identifier, p.name || $t('preset.entry.untitled'))">{{ $t("preset.unused.delete") }}</button>
              </li>
            </ul>
          </details>
        </aside>

        <section ref="detailEl" class="panel preset-editor__detail" tabindex="-1" :aria-label="$t('preset.entry.title')">
          <PresetEntryDetail
            v-if="selectedRow" :key="selectedRow.identifier" :doc="doc" :row="selectedRow" :compat="compatOf(selectedRow.identifier)" :saved="savedPrompt(selectedRow.identifier)" :keep-source="imported" :read-only="readOnly"
            @select="pick" @back="leaveEntry" @status="status = $event" @inspect="inspect(selectedRow)"
          />
          <div v-else-if="providedOpen" class="preset-editor__provided" data-testid="provided-detail">
            <p class="eyebrow">{{ $t("preset.provided.label") }}</p>
            <h2 tabindex="-1">{{ $t(`preset.provided.${providedOpen}`) }}</h2>
            <p class="muted">{{ $t("preset.provided.body") }}</p>
            <p v-if="imported" class="subtle">{{ $t("preset.provided.imported") }}</p>
          </div>
          <div v-else class="preset-editor__pick" data-testid="editor-pick-hint">
            <p class="muted">{{ $t("preset.editor.pickHint") }}</p>
            <button v-if="!readOnly" type="button" class="btn btn--sm" @click="newEntry">{{ $t("preset.entries.add") }}</button>
          </div>
        </section>
      </div>

      <div v-show="tab === 'settings'" id="editor-panel-settings" class="preset-editor__settings" role="tabpanel">
      <section class="panel preset-editor__section">
        <fieldset class="preset-editor__fieldset" :disabled="readOnly">
        <div class="field">
          <label for="preset-models">{{ $t("preset.editor.models") }}</label>
          <div class="preset-editor__models">
            <button v-for="m in models" :key="m" type="button" class="chip chip--on" :aria-label="`${modelLabel(m)} ×`" @click="toggleModel(m, false)">{{ modelLabel(m) }} ×</button>
            <select id="preset-models" class="input preset-editor__modelPick" :value="''" @change="toggleModel(($event.target as HTMLSelectElement).value, true); ($event.target as HTMLSelectElement).value = ''">
              <option value="" disabled>{{ $t("preset.editor.models.placeholder") }}</option>
              <option v-for="o in modelOptions.filter((o) => !models.includes(o.value))" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <p class="subtle">{{ $t("preset.editor.models.hint") }}</p>
        </div>
        </fieldset>
      </section>
      <section class="panel preset-editor__section">
        <fieldset class="preset-editor__fieldset" :disabled="readOnly">
          <PresetToolReply :enabled="!!doc.selection.toolReply" :detected="!!compat?.toolReply?.externalToolBindingsDetected" :tool="compat?.toolReply?.tool"
            @change="(v) => { doc!.selection.toolReply = v; }" />
        </fieldset>
      </section>

      <!-- 條目包（Prompt Manager 匯出的那種）只有條目，沒有採樣參數 -->
      <details v-if="!isPromptPack(doc.st)" class="panel preset-editor__section" open>
        <summary>{{ $t("preset.params.title") }}</summary>
        <fieldset class="preset-editor__fieldset" :disabled="readOnly"><PresetParams :doc="doc" :fields="compat?.fields ?? []" :native="!imported" /></fieldset>
      </details>

      <details v-if="detail?.revisions?.length" class="panel preset-editor__section" data-testid="preset-versions">
        <summary>{{ $t("preset.versions.title") }}</summary>
        <p class="subtle">{{ $t("preset.versions.body") }}</p>
        <ul class="preset-editor__versions">
          <li v-for="v in detail.revisions" :key="v.revisionId">
            <span>{{ $t("preset.versions.item", { version: v.version, datetime: dateTime(v.createdAt), count: whole(v.enabledEntryCount) }, v.enabledEntryCount) }}</span>
            <span v-if="v.version === head" class="subtle">{{ $t("preset.versions.current") }}</span>
            <button v-else-if="!readOnly" type="button" class="btn btn--sm btn--ghost" @click="restoreFrom(v.revisionId, v.version)">{{ $t("preset.versions.restore") }}</button>
          </li>
        </ul>
      </details>

      </div>

      <footer class="preset-editor__foot">
        <div class="preset-editor__state" role="status">
          <template v-if="unconfirmed"><strong>{{ $t("preset.editor.saveUnconfirmed") }}</strong> <span class="subtle">{{ $t("preset.editor.saveUnconfirmed.hint") }}</span></template>
          <template v-else-if="dirty && nativeBlocked.length"><span data-testid="preset-native-blocked">{{ $t("preset.error.native") }} {{ nativeBlocked.join($t("preset.setting.separator")) }}</span></template>
          <template v-else-if="dirty && blocked.length"><span data-testid="preset-blocked">{{ blockedText }}</span></template>
          <template v-else-if="dirty && badParams.length">
            <span data-testid="preset-params-blocked">
              {{ $t("preset.editor.paramsBlocked", { names: badParams.map((k) => $t(paramLabelKey(k))).join($t("preset.setting.separator")) }) }}
              <button type="button" class="btn btn--sm" @click="goToBadParam">{{ $t("preset.editor.paramsBlocked.go") }}</button>
            </span>
          </template>
          <template v-else-if="dirty">{{ $t("preset.editor.dirty") }}</template>
          <template v-else-if="savedVersion"><strong>{{ $t("preset.editor.saved", { n: savedVersion }) }}</strong> <span class="subtle">{{ $t("preset.editor.saved.hint") }}</span></template>
          <template v-if="status"><span v-if="unconfirmed || dirty || savedVersion" class="subtle" aria-hidden="true"> · </span><span class="subtle">{{ status }}</span></template>
        </div>
        <div class="preset-editor__actions">
          <button v-if="detail" type="button" class="btn" @click="exporting = true">{{ $t("preset.row.export") }}</button>
          <button type="button" class="btn btn--primary btn--lg" :disabled="!canSave" data-testid="preset-save" @click="save">
            {{ saving ? $t("preset.editor.saving") : $t("preset.editor.save") }}
          </button>
        </div>
      </footer>
    </template>

    <PresetExportDialog v-if="exporting && detail" :preset="detail" :token="token" @close="exporting = false" />
    <PresetInspectDialog v-if="inspecting" :rows="inspecting.rows" :name="inspecting.name" @close="inspecting = null" />
  </div>
</template>

<style scoped>
.preset-editor { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-4); padding-block: var(--s-5) var(--s-8); }
.preset-editor__crumb { font-size: 13px; }
/* 封存時整組停用用的外框：不佔版面 */
.preset-editor__fieldset { display: contents; }
/* 返回連結用內文次要色＋底線（站上的粉色小字在這裡只有 3.2:1） */
.preset-editor__entryBack { display: none; gap: 4px; }
.preset-crumb { color: var(--text-2); text-decoration: underline; text-underline-offset: 3px; display: inline-flex; align-items: center; min-height: var(--h-sm); }
.preset-crumb:hover { color: var(--text); }

.preset-editor__card { padding: var(--s-5); }
.preset-editor__head { padding: var(--s-4) var(--s-5); display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--s-3) var(--s-4); }
.preset-editor__titleField { flex: 1 1 280px; max-width: 520px; }
.preset-editor__tabs { flex-shrink: 0; }
.preset-editor__tabs .seg__item { position: relative; min-height: var(--h-lg); padding-inline: var(--s-4); }
.editor-tab__dot { position: absolute; top: 8px; right: 6px; width: 8px; height: 8px; border-radius: 50%; background: var(--danger); }
.preset-editor__settings { display: grid; gap: var(--s-4); align-content: start; max-width: 760px; width: 100%; }
.preset-editor__head .field { margin-bottom: 0; }
.preset-editor__head .field > p { margin: 0; }
.preset-editor__models { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1); min-width: 0; }
/* 原生下拉會撐到最長的選項那麼寬（模型名可能很長）：限制在欄位寬度內，名稱過長的已選模型自己換行 */
.preset-editor__modelPick { flex: 1 1 160px; width: auto; min-width: 0; max-width: 100%; }
.preset-editor__models .chip { max-width: 100%; height: auto; min-height: 26px; padding-block: 4px; line-height: 1.35; white-space: normal; overflow-wrap: anywhere; text-align: start; }
.preset-editor__body { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: var(--s-4); align-items: start; }
.preset-editor__list, .preset-editor__detail, .preset-editor__section { min-width: 0; }
.preset-editor__ghost { min-height: 320px; }
.preset-editor__list { padding: var(--s-3); display: grid; gap: var(--s-3); }
.preset-editor__list > p { margin: 0; padding-inline: var(--s-2); text-wrap: pretty; }
.preset-editor__listHead { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); padding-inline: var(--s-2); }
.preset-editor__listHead h2 { margin: 0; font-size: 16px; }
.preset-editor__empty { padding: var(--s-3) var(--s-2); display: grid; gap: var(--s-1); }
.preset-editor__empty p { margin: 0; }
.preset-editor__group h3 { margin: 0 0 var(--s-1); padding-inline: var(--s-2); }
.preset-editor__group ul, .preset-editor__library ul, .preset-editor__versions { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; }
.preset-editor__group li { display: flex; align-items: center; gap: var(--s-1); }
.preset-editor__handle { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 44px; margin-left: -8px; min-height: var(--h-lg); color: var(--text-3); cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.preset-editor__handle:hover { color: var(--text-2); }
.preset-editor__group li.is-dragging { opacity: 0.45; }
.preset-editor__group li.is-drop-before { box-shadow: inset 0 2px 0 var(--accent); }
.preset-editor__group.is-drop-end ul::after { content: ""; display: block; height: 2px; margin-top: 2px; border-radius: 1px; background: var(--accent); }
.preset-editor__row { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--s-2); min-height: var(--h-lg); padding: 0 var(--s-2); border: 0; border-radius: var(--r-sm); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.preset-editor__row:hover { background: var(--surface-2); }
.preset-editor__row.is-on { background: var(--accent-tint); color: var(--accent-text); }
.preset-editor__row.is-off .preset-editor__rowName { color: var(--text-3); }
.preset-editor__rowName { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preset-editor__lock { flex-shrink: 0; color: var(--text-3); }
.preset-editor__tag { flex-shrink: 0; font-size: 12px; font-weight: 600; }
.preset-editor__tag--needs_adjustment { color: var(--warning-text); }
.preset-editor__tag--unsupported { color: var(--danger); }
/* 開關自己一塊 44×44 的點擊區，不跟條目按鈕重疊 */
.preset-editor__toggle { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: var(--h-lg); height: var(--h-lg); cursor: pointer; }
.preset-editor__toggle input { width: 18px; height: 18px; margin: 0; accent-color: var(--accent); cursor: pointer; }
.preset-editor__tools { display: flex; justify-content: flex-end; }
.preset-editor__library summary, .preset-editor__section > summary { cursor: pointer; min-height: var(--h-md); display: flex; align-items: center; font-weight: 600; }
.preset-editor__library { padding-inline: var(--s-2); }
.preset-editor__library > p { margin: var(--s-1) 0; }
.preset-editor__library li { display: flex; align-items: center; gap: var(--s-1); min-height: var(--h-lg); }
.preset-editor__detail { padding: var(--s-5); min-height: 320px; }
.preset-editor__pick { display: grid; gap: var(--s-3); justify-items: start; }
.preset-editor__pick p { margin: 0; }
.preset-editor__provided { display: grid; gap: var(--s-2); align-content: start; }
.preset-editor__provided h2 { margin: 0; font-size: 18px; }
.preset-editor__provided p { margin: 0; }
.preset-editor__section { padding: var(--s-3) var(--s-5) var(--s-5); display: grid; gap: var(--s-3); }
.preset-editor__section > p { margin: 0; }
.preset-editor__versions li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); min-height: var(--h-lg); }
/* 存檔列固定在畫面底部：被擋的原因、已存成 vN、匯入完成這些話一進頁面就看得到 */
.preset-editor__foot {
  position: sticky; bottom: 0; z-index: 15; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3);
  padding: var(--s-3) 0 calc(var(--s-3) + env(safe-area-inset-bottom));
  background: color-mix(in srgb, var(--bg) 84%, transparent); -webkit-backdrop-filter: blur(16px) saturate(1.2); backdrop-filter: blur(16px) saturate(1.2); border-top: 1px solid var(--line);
}
.preset-editor__state { flex: 1 1 240px; min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
.preset-editor__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; min-width: 0; }
/* 桌機：一屏工作區，頁面不為長清單而捲；左清單與右編輯區各自捲動（UI/UX editor-layout 規格） */
@media (min-width: 761px) {
  .preset-editor { height: calc(100dvh - var(--header-h)); min-height: 560px; box-sizing: border-box; display: flex; flex-direction: column; padding-block: var(--s-4) 0; }
  .preset-editor > * { flex-shrink: 0; }
  .preset-editor__body, .preset-editor__settings { flex: 1 1 auto; min-height: 360px; }
  .preset-editor__body { grid-template-columns: clamp(300px, 27vw, 380px) minmax(0, 1fr); align-items: stretch; }
  .preset-editor__list, .preset-editor__detail, .preset-editor__settings { overflow: auto; overscroll-behavior: contain; min-height: 0; }
  .preset-editor__list { align-content: start; padding-top: 0; }
  .preset-editor__list > .preset-editor__listHead, .preset-editor__list > input[type="search"] { position: sticky; z-index: 1; background: var(--surface); }
  .preset-editor__list > .preset-editor__listHead { top: 0; padding-top: var(--s-3); padding-bottom: var(--s-2); }
  /* 上下各補一條底色，蓋住標題列與搜尋框之間、以及下方捲過去的列 */
  .preset-editor__list > input[type="search"] { top: 52px; box-shadow: 0 calc(-1 * var(--s-2)) 0 var(--surface), 0 var(--s-2) 0 var(--surface), 0 calc(var(--s-2) + 1px) 0 var(--line); }
  /* 捲動區的下內距在部分瀏覽器不算進捲動高度：最後一張卡片自己留底，才不會貼著存檔列 */
  .preset-editor__settings > :last-child { margin-bottom: var(--s-5); }
  .preset-editor__foot { position: static; }
}
@media (max-width: 760px) {
  .preset-editor__tabs { width: 100%; display: flex; }
  .preset-editor__tabs .seg__item { flex: 1 1 0; }
  .preset-editor__entryBack { display: inline-flex; min-height: var(--h-lg); }
  .preset-crumb[data-in-entry] { display: none; }
  .preset-editor__head { grid-template-columns: minmax(0, 1fr); }
  .preset-editor__body { grid-template-columns: minmax(0, 1fr); }
  .preset-editor--entry .preset-editor__list { display: none; }
  .preset-editor:not(.preset-editor--entry) .preset-editor__detail { display: none; }
  .preset-editor__foot { margin-inline: calc(-1 * var(--s-4)); padding-inline: var(--s-4); }
  .preset-editor__actions { width: 100%; }
  .preset-editor__actions .btn--primary { flex: 1; }
}
</style>
