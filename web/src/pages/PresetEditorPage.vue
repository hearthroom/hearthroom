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
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";
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
  FRAMEWORK_IDS, adaptationId, isPromptPack, nativeProblems, addEntry, canDeleteEntry, deleteEntry, detachedPrompts, entryRows, insertEntry, newDocument, restoreOrder, setEnabled,
  type EntryRow, type PresetDocument,
} from "@/lib/st-preset";
import { operationKeys, usePresetAccess } from "@/lib/use-preset-access";
import { useLocalePath } from "@/lib/use-locale";
import PresetEntryDetail from "@/components/preset/PresetEntryDetail.vue";
import PresetParams from "@/components/preset/PresetParams.vue";
import PresetExportDialog from "@/components/preset/PresetExportDialog.vue";
import PresetInspectDialog from "@/components/preset/PresetInspectDialog.vue";
import PresetReauth from "@/components/preset/PresetReauth.vue";
import PresetToolReply from "@/components/preset/PresetToolReply.vue";
import { anyParamInvalid, paramLabelKey } from "@/components/preset/preset-params";

const { t } = useI18n();
const { lp } = useLocalePath();
const route = useRoute();
const router = useRouter();
const { token, needsConsent, consentNeeded, reauthorize } = usePresetAccess();
const ops = operationKeys();

/** 由綺夢社提供的條目在畫面上合成幾列（酒館把角色資料拆成五條，對玩家是同一件事），另加一列記憶。 */
const PROVIDED: Record<string, string> = {
  charDescription: "charDescription", charPersonality: "charDescription", scenario: "charDescription",
  personaDescription: "charDescription", dialogueExamples: "charDescription",
  worldInfoBefore: "worldInfo", worldInfoAfter: "worldInfo", chatHistory: "chatHistory",
};
const PROVIDED_ROWS = ["charDescription", "worldInfo", "chatHistory", "memory"] as const;

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
const inspecting = ref<"before" | "after" | null>(null);

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
const tagOf = (r: EntryRow) => (movedAfter(r) ? undefined : compatOf(r.identifier)?.uiStatus);
const provided = computed(() => {
  const present = new Set(rows.value.filter((r) => r.slot === "F" && FRAMEWORK_IDS.has(r.identifier)).map((r) => PROVIDED[r.identifier]));
  return PROVIDED_ROWS.filter((k) => k === "memory" || present.has(k));
});

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
  doc.value = next;
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

function pick(id: string) { selected.value = id; providedOpen.value = ""; }
function pickProvided(key: string) { providedOpen.value = key; selected.value = ""; }

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
    <nav class="preset-editor__crumb"><RouterLink :to="lp('/me/presets')" class="preset-crumb">{{ $t("preset.editor.back") }}</RouterLink></nav>
    <h1 class="sr-only">{{ $t(presetId ? "preset.editor.title.edit" : "preset.editor.title.new") }}</h1>

    <PresetReauth v-if="needsConsent" @confirm="reauthorize" @cancel="router.push(lp('/me/presets'))" />
    <div v-else-if="loading" class="preset-editor__body" aria-busy="true"><div class="panel ghost preset-editor__ghost" /><div class="panel ghost preset-editor__ghost" /></div>
    <p v-else-if="loadError" class="panel preset-editor__card" role="alert">{{ loadError }} <button type="button" class="btn btn--sm" @click="load">{{ $t("preset.list.retry") }}</button></p>

    <template v-else-if="doc">
      <header class="panel preset-editor__head">
        <fieldset class="preset-editor__fieldset" :disabled="readOnly">
        <div class="field">
          <label for="preset-title">{{ $t("preset.editor.name") }}</label>
          <input id="preset-title" v-model="title" class="input" maxlength="60" required :placeholder="$t('preset.editor.name.placeholder')" data-testid="preset-title" />
        </div>
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
      </header>
      <p v-if="readOnly" class="notice" role="status" data-testid="preset-archived">{{ $t("preset.row.archived") }} · {{ $t("preset.error.archived") }}</p>

      <p v-if="conflict" class="notice" role="alert" data-testid="preset-conflict">
        {{ $t("preset.error.revisionConflict") }}
        <button type="button" class="btn btn--sm" @click="reloadLatest">{{ $t("preset.error.reload") }}</button>
      </p>
      <p v-if="saveError" class="notice notice--error" role="alert">{{ saveError }}</p>

      <div class="preset-editor__body">
        <aside class="panel preset-editor__list" :aria-label="$t('preset.entries.title')">
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
            <div v-if="groupOf(side).length || (side === 'before' && !q)" class="preset-editor__group">
              <h3 class="eyebrow">{{ $t(`preset.entries.group.${side}`) }}</h3>
              <ul>
                <li v-for="r in groupOf(side)" :key="r.identifier">
                  <button type="button" class="preset-editor__row" :class="{ 'is-on': r.identifier === selected, 'is-off': !r.enabled }" :aria-current="r.identifier === selected || undefined" data-testid="entry-row" @click="pick(r.identifier)">
                    <span class="preset-editor__rowName">{{ r.prompt.name || $t("preset.entry.untitled") }}</span>
                    <span v-if="tagOf(r)" class="preset-editor__tag" :class="`preset-editor__tag--${tagOf(r)}`">{{ $t(tagOf(r) === "needs_adjustment" ? "preset.report.status.adjust" : tagOf(r) === "relocated" ? "preset.report.status.relocated" : "preset.report.status.unsupported") }}</span>
                    <span v-else-if="!r.enabled" class="subtle">{{ $t("preset.entries.disabled") }}</span>
                  </button>
                  <label class="preset-editor__toggle">
                    <input type="checkbox" :disabled="readOnly" :checked="r.enabled" :aria-label="`${$t('preset.entry.enabled')}：${r.prompt.name || $t('preset.entry.untitled')}`" @change="setEnabled(doc, r.identifier, ($event.target as HTMLInputElement).checked, { keepSource: imported })" />
                  </label>
                </li>
              </ul>
            </div>
            <div v-if="side === 'before' && !q" class="preset-editor__group">
              <h3 class="eyebrow">{{ $t("preset.entries.group.provided") }}</h3>
              <ul>
                <li v-for="k in provided" :key="k">
                  <button type="button" class="preset-editor__row" :class="{ 'is-on': providedOpen === k }" data-testid="provided-row" @click="pickProvided(k)">
                    <svg class="preset-editor__lock" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                    <span class="preset-editor__rowName">{{ $t(`preset.provided.${k}`) }}</span>
                    <span class="sr-only">{{ $t("preset.provided.label") }}</span>
                  </button>
                </li>
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

        <section class="panel preset-editor__detail">
          <PresetEntryDetail
            v-if="selectedRow" :key="selectedRow.identifier" :doc="doc" :row="selectedRow" :compat="compatOf(selectedRow.identifier)" :saved="savedPrompt(selectedRow.identifier)" :keep-source="imported" :read-only="readOnly"
            @select="pick" @back="selected = ''" @status="status = $event" @inspect="inspecting = shownSide(selectedRow)"
          />
          <div v-else-if="providedOpen" class="preset-editor__provided" data-testid="provided-detail">
            <button type="button" class="btn btn--sm btn--ghost preset-editor__back" @click="providedOpen = ''">{{ $t("preset.entry.back") }}</button>
            <p class="eyebrow">{{ $t("preset.provided.label") }}</p>
            <h2>{{ $t(`preset.provided.${providedOpen}`) }}</h2>
            <p class="muted">{{ $t("preset.provided.body") }}</p>
            <p v-if="imported && providedOpen !== 'memory'" class="subtle">{{ $t("preset.provided.imported") }}</p>
          </div>
          <p v-else class="muted preset-editor__pick">{{ $t("preset.entry.title") }}</p>
        </section>
      </div>

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

      <footer class="preset-editor__foot">
        <div class="preset-editor__state" role="status">
          <template v-if="unconfirmed"><strong>{{ $t("preset.editor.saveUnconfirmed") }}</strong> <span class="subtle">{{ $t("preset.editor.saveUnconfirmed.hint") }}</span></template>
          <template v-else-if="dirty && nativeBlocked.length"><span data-testid="preset-native-blocked">{{ $t("preset.error.native") }} {{ nativeBlocked.join($t("preset.setting.separator")) }}</span></template>
          <template v-else-if="dirty && blocked.length"><span data-testid="preset-blocked">{{ blockedText }}</span></template>
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
    <PresetInspectDialog v-if="inspecting" :side="inspecting" @close="inspecting = null" />
  </div>
</template>

<style scoped>
.preset-editor { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-4); padding-block: var(--s-5) var(--s-8); }
.preset-editor__crumb { font-size: 13px; }
/* 封存時整組停用用的外框：不佔版面 */
.preset-editor__fieldset { display: contents; }
/* 返回連結用內文次要色＋底線（站上的粉色小字在這裡只有 3.2:1） */
.preset-crumb { color: var(--text-2); text-decoration: underline; text-underline-offset: 3px; display: inline-flex; align-items: center; min-height: var(--h-sm); }
.preset-crumb:hover { color: var(--text); }

.preset-editor__card { padding: var(--s-5); }
.preset-editor__head { padding: var(--s-4) var(--s-5); display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s-4); }
.preset-editor__head .field { margin-bottom: 0; }
.preset-editor__head .field > p { margin: 0; }
.preset-editor__models { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1); min-width: 0; }
/* 原生下拉會撐到最長的選項那麼寬（模型名可能很長）：限制在欄位寬度內，名稱過長的已選模型自己換行 */
.preset-editor__modelPick { flex: 1 1 160px; width: auto; min-width: 0; max-width: 100%; }
.preset-editor__models .chip { max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-align: start; }
.preset-editor__body { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: var(--s-4); align-items: start; }
.preset-editor__list, .preset-editor__detail, .preset-editor__section { min-width: 0; }
.preset-editor__ghost { min-height: 320px; }
.preset-editor__list { padding: var(--s-3); display: grid; gap: var(--s-3); }
.preset-editor__list > p { margin: 0; padding-inline: var(--s-2); }
.preset-editor__listHead { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); padding-inline: var(--s-2); }
.preset-editor__listHead h2 { margin: 0; font-size: 16px; }
.preset-editor__empty { padding: var(--s-3) var(--s-2); display: grid; gap: var(--s-1); }
.preset-editor__empty p { margin: 0; }
.preset-editor__group h3 { margin: 0 0 var(--s-1); padding-inline: var(--s-2); }
.preset-editor__group ul, .preset-editor__library ul, .preset-editor__versions { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.preset-editor__group li { display: flex; align-items: center; gap: var(--s-1); }
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
.preset-editor__pick { margin: 0; }
.preset-editor__provided { display: grid; gap: var(--s-2); align-content: start; }
.preset-editor__provided h2 { margin: 0; font-size: 18px; }
.preset-editor__provided p { margin: 0; }
.preset-editor__back { display: none; justify-self: start; }
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
@media (max-width: 760px) {
  .preset-editor__head { grid-template-columns: minmax(0, 1fr); }
  .preset-editor__body { grid-template-columns: minmax(0, 1fr); }
  .preset-editor__back { display: inline-flex; }
  .preset-editor--entry .preset-editor__list { display: none; }
  .preset-editor:not(.preset-editor--entry) .preset-editor__detail { display: none; }
  .preset-editor__foot { margin-inline: calc(-1 * var(--s-4)); padding-inline: var(--s-4); }
  .preset-editor__actions { width: 100%; }
  .preset-editor__actions .btn--primary { flex: 1; }
}
</style>
