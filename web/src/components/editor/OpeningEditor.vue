<script setup lang="ts">
/**
 * 開局：作者在兩種呈現裡選一種（owner 2026-11-10，規格 card-editor-redesign ui.md §3）。
 *
 * - 開場白（greeting）：AI 的第一則訊息。顯示規則照樣套在它身上（畫布把開場白當 AI 訊息處理），
 *   所以從一段文字到整個首屏畫面都做得出來；這裡的「玩家看到的」預覽用畫布同一支規則引擎。
 *   開場選項在這種呈現叫「建議的第一句」，點了填進輸入框。
 * - 開場網頁（page）：一頁作者網頁加幾個選項，點選項直接當玩家第一句送出；開場白可以留空。
 *   選項叫「第一句選項」，至少要有一個。
 *
 * 兩種的選項是同一份資料（開場選項），切換時帶過去。切到另一種時，原本那一種專屬的內容
 * （開場白與備選開場白，或網頁內容）先留在草稿裡，儲存時才移除（編輯頁處理），切回來就還原——
 * 可逆優先於確認，不跳確認框。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { applyTavernRules } from "stage-canvas/rule-engine-core";
import { scopeCardHtml } from "stage-canvas/style-scope";
import { openingSrcdoc } from "stage-common/opening-page";
import FieldText from "@/components/editor/FieldText.vue";
import ListEditor from "@/components/editor/ListEditor.vue";
import type { OpeningMode, RegexRule } from "@/lib/regex-rules";
import type { OpeningFileControl } from "@/lib/opening-file";
import {
  formatPageSize, OPENING_PAGE_EDIT_MAX_BYTES, OPENING_PAGE_FILENAME, OPENING_PAGE_INLINE_BYTES,
  OPENING_PAGE_LARGE_HINT_BYTES, pageLimitMB, utf8Length,
} from "@/lib/opening-page";

const props = defineProps<{
  mode: OpeningMode;
  /** 上次存下來（或剛匯入）的呈現：跟現在不同就是「切換了」，另一邊的內容存檔時會移除。 */
  savedMode: OpeningMode;
  welcome: string;
  alternates: string[];
  prologue: string[];
  openingPage: string;
  /** 能不能存網頁內容（上游有作者資產才行）。不能時只有開場白一種。 */
  pageAvailable: boolean;
  rules: RegexRule[];
  cardFormat?: string;
  roleName: string;
  welcomeMax: number;
  /** 必填缺了：開場白或第一句選項的標籤旁標紅。 */
  missing: boolean;
  /** 網頁內容的上限（UTF-8 位元組）；沒給照 512 KB（工坊）。 */
  maxBytes?: number;
  /**
   * 大頁面那一半（上傳、下載、清除、超過編輯門檻的檔案卡）。沒給就只有文字框（工坊開場仍存在 JSON 裡）。
   */
  fileControl?: OpeningFileControl;
}>();
const emit = defineEmits<{
  "update:mode": [OpeningMode];
  "update:welcome": [string];
  "update:alternates": [string[]];
  "update:prologue": [string[]];
  "update:openingPage": [string];
  "edit-rules": [];
}>();
const { t, locale } = useI18n();

const welcomeModel = computed({ get: () => props.welcome, set: (v: string) => emit("update:welcome", v) });
const pageModel = computed({ get: () => props.openingPage, set: (v: string) => emit("update:openingPage", v) });

const MODES: OpeningMode[] = ["greeting", "page"];
const modes = computed(() => (props.pageAvailable ? MODES : MODES.filter((m) => m === "greeting" || props.mode === m)));

const hasGreeting = computed(() => Boolean(props.welcome.trim()) || props.alternates.some((a) => a.trim()));
const pageFile = computed(() => props.fileControl?.file.value ?? null);
/** 文字框有沒有字：/\S/ 找到第一個字就停，不像 trim() 會在頁尾有換行時複製整份。 */
const pageHasText = computed(() => /\S/.test(props.openingPage));
const hasPage = computed(() => !!pageFile.value || pageHasText.value);
const alternateCount = computed(() => props.alternates.filter((a) => a.trim()).length);

/** 切換了、而且另一邊真的有東西會在存檔時移除：說清楚，給一顆切回去。 */
const switchNotice = computed(() => {
  if (props.mode === props.savedMode) return "";
  if (props.mode === "page" && hasGreeting.value)
    return alternateCount.value
      ? t("editor.opening.switched.toPageWithAlternates", { n: alternateCount.value })
      : t("editor.opening.switched.toPage");
  if (props.mode === "greeting" && hasPage.value) return t("editor.opening.switched.toGreeting");
  return "";
});
/** 舊卡兩種都有（沒切換過）：照舊兩樣都顯示，提醒作者選一種，不擋儲存。 */
const leftover = computed<"greeting" | "page" | null>(() => {
  if (props.mode !== props.savedMode) return null;
  if (props.mode === "page" && hasGreeting.value) return "greeting";
  if (props.mode === "greeting" && hasPage.value) return "page";
  return null;
});
function removeLeftover() {
  if (leftover.value === "greeting") {
    emit("update:welcome", "");
    emit("update:alternates", []);
  } else if (leftover.value === "page") {
    // 檔案卡的內容清掉就救不回來：走同一個確認
    if (pageFile.value && props.fileControl) void props.fileControl.clear();
    else emit("update:openingPage", "");
  }
}

// ── 開場白：撰寫／玩家看到的 ──────────────────────────────────────────
const welcomeTab = ref<"write" | "player">("write");
const pageTab = ref<"write" | "preview">("write");
const pageInput = ref<HTMLTextAreaElement>();
const modeChoices = ref<HTMLElement>();
const pageMax = computed(() => props.maxBytes ?? OPENING_PAGE_INLINE_BYTES);
/**
 * 文字框的位元組數。大頁面每按一鍵整份重算會拖慢打字：超過 64 KB 的頁面逐字打字時停手 150ms 再算
 * （計數器與上限提示晚一點更新，存檔時另外照實際大小檢查）；貼上、匯入、讀進來這種一次變很多的立刻算。
 */
const textBytes = ref(utf8Length(props.openingPage));
let bytesTimer: ReturnType<typeof setTimeout> | undefined;
watch(() => props.openingPage, (page, before) => {
  clearTimeout(bytesTimer);
  const typing = Math.abs(page.length - (before?.length ?? 0)) <= 64;
  if (page.length <= 64 * 1024 || !typing) textBytes.value = utf8Length(page);
  else bytesTimer = setTimeout(() => { textBytes.value = utf8Length(props.openingPage); }, 150);
});
onBeforeUnmount(() => clearTimeout(bytesTimer));
const pageBytes = computed(() => (pageFile.value ? pageFile.value.bytes : textBytes.value));
const pageOver = computed(() => pageBytes.value > pageMax.value);
const pageUsage = computed(() => !!pageFile.value || pageBytes.value > 64 * 1024);
/** 上限印成 MB（512 KB 印成 0.5）。 */
const pageMaxMB = computed(() => pageLimitMB(pageMax.value, String(locale.value)));
const pageLarge = computed(() => pageBytes.value > OPENING_PAGE_LARGE_HINT_BYTES);
const pageCard = ref<HTMLElement>();
const pageFileInput = ref<HTMLInputElement>();
const pageUploadButton = ref<HTMLButtonElement>();
const fileError = computed(() => {
  const code = props.fileControl?.error.value;
  if (!code) return "";
  return code === "errTooBig" ? t("editor.openingPage.errTooBig", { max: formatPageSize(pageMax.value, String(locale.value)) }) : t(`editor.openingPage.${code}`);
});
const fileNotice = computed(() => {
  const code = props.fileControl?.notice.value;
  if (code === "pasted") return t("editor.openingPage.pasted");
  if (code === "picked") return t("editor.openingPage.pickedHint");
  if (code === "cleared") return t("editor.openingPage.clearedHint");
  return "";
});
const pageUnsaved = computed(() => !!props.fileControl && (props.fileControl.dirty() || !!props.fileControl.notice.value));
const transfer = computed(() => props.fileControl?.transfer.value ?? null);
const transferLabel = computed(() => {
  const now = transfer.value;
  if (!now) return "";
  return t(now.kind === "upload" ? "editor.openingPage.uploading" : "editor.openingPage.downloading", { percent: now.percent ?? 0 });
});

/**
 * 一次貼上就超過編輯門檻：整份收成檔案（文字框換成檔案卡）。逐字打字跨過門檻不切換，游標不會跳走。
 */
function onPagePaste(event: ClipboardEvent) {
  const control = props.fileControl;
  const area = event.target as HTMLTextAreaElement | null;
  const pasted = event.clipboardData?.getData("text/plain") ?? "";
  if (!control || !area || !pasted) return;
  const next = area.value.slice(0, area.selectionStart ?? area.value.length) + pasted + area.value.slice(area.selectionEnd ?? area.value.length);
  if (utf8Length(next) <= OPENING_PAGE_EDIT_MAX_BYTES) return;
  event.preventDefault();
  control.paste(next);
  void nextTick(() => pageCard.value?.focus());
}

async function onPagePick(event: Event) {
  const input = event.target as HTMLInputElement;
  const picked = input.files?.[0];
  input.value = "";
  if (!picked || !props.fileControl) return;
  const replaced = await props.fileControl.pick(picked);
  await nextTick();
  if (!replaced) pageUploadButton.value?.focus();
  else (pageFile.value ? pageCard.value : pageInput.value)?.focus();
}

async function clearPageFile(event: Event) {
  const trigger = event.currentTarget as HTMLElement | null;
  const done = await props.fileControl?.clear();
  await nextTick();
  if (done) pageInput.value?.focus();
  else trigger?.focus();
}

/** 檔案卡的預覽：不自動讀，按了才讀；讀到的頁面用 Blob 網址掛進預覽框（不轉成字串）。 */
const filePreviewUrl = ref("");
function dropFilePreview() {
  if (filePreviewUrl.value) URL.revokeObjectURL(filePreviewUrl.value);
  filePreviewUrl.value = "";
}
async function loadFilePreview() {
  const control = props.fileControl;
  if (!control) return;
  const target = pageFile.value;
  const blob = await control.previewContent();
  if (!blob || pageFile.value !== target) return;
  dropFilePreview();
  filePreviewUrl.value = URL.createObjectURL(new Blob([openingSrcdoc(""), blob], { type: "text/html" }));
}
watch(pageFile, dropFilePreview);
onBeforeUnmount(dropFilePreview);

async function focusPage() {
  pageTab.value = "write";
  await nextTick();
  if (pageInput.value) pageInput.value.focus();
  else modeChoices.value?.querySelector<HTMLButtonElement>('[data-opening-mode="page"]')?.focus();
}

defineExpose({ focusPage });

/** 只有套到 AI 訊息、而且開著的規則，跟畫布對開場白做的一樣。 */
const aiRules = computed(() => props.rules.filter((r) => r.enabled && (!r.targets || r.targets.includes("ai"))));
const format = computed(() => (props.cardFormat === "tavern" || props.cardFormat === "fengyue" ? props.cardFormat : "mmd"));

/**
 * 規則可能很多、開場白可能很長：打字時不要每個字都整份重算。停手 300ms 再算，
 * 算出「套到幾條」與預覽要的 HTML。規則寫錯（regex 編不起來）算不出來時當作沒套到。
 */
const ruleHits = ref(0);
const playerHtml = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
function recompute() {
  const text = props.welcome;
  const macros = { char: props.roleName.trim() || undefined };
  let hits = 0;
  if (text.trim()) {
    for (const rule of aiRules.value) {
      try {
        if (applyTavernRules(text, [rule], { macros, messageRole: "ai" }).html !== text) hits++;
      } catch { /* 寫壞的規則畫布也會跳過 */ }
    }
  }
  ruleHits.value = hits;
  if (welcomeTab.value !== "player") return;
  try {
    playerHtml.value = scopeCardHtml(applyTavernRules(text, aiRules.value, { macros, messageRole: "ai" }).html, format.value);
  } catch {
    playerHtml.value = text;
  }
}
watch(() => [props.welcome, props.rules, props.roleName, welcomeTab.value], () => {
  clearTimeout(timer);
  timer = setTimeout(recompute, 300);
}, { immediate: true, deep: true });
onBeforeUnmount(() => clearTimeout(timer));

/**
 * 預覽框：無同源、可跑腳本（跟畫布對作者 HTML 的信任一樣）。純文字的開場白保留換行；
 * 已經是一整塊 HTML 的不動空白，不然排版用的縮排會變成一堆空行。
 */
const HTML_BLOCK = /<(div|section|style|table|p|br|button|img|ul|ol|details|svg)\b/i;
const playerDoc = computed(() => {
  const html = playerHtml.value;
  const plain = !HTML_BLOCK.test(html);
  return "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    + "<style>:root{color-scheme:light dark}body{margin:0;padding:12px;font:15px/1.7 system-ui,sans-serif;overflow-wrap:anywhere}"
    + (plain ? ".msg{white-space:pre-line}" : "") + "</style>"
    + `<div class="msg">${html}</div>`;
});
const pageDoc = computed(() => openingSrcdoc(props.openingPage));
</script>

<template>
  <div class="opening">
    <div class="omode" ref="modeChoices" role="radiogroup" :aria-label="$t('editor.opening.mode')">
      <button v-for="m in modes" :key="m" type="button" class="omode__card" :class="{ 'omode__card--on': mode === m }"
              role="radio" :aria-checked="mode === m" :data-opening-mode="m" @click="emit('update:mode', m)">
        <span class="omode__dot" aria-hidden="true" />
        <span class="omode__text">
          <span class="omode__name">{{ $t(`editor.opening.${m}`) }}</span>
          <span class="omode__desc">{{ $t(`editor.opening.${m}.desc`) }}</span>
        </span>
        <!-- 示意小圖：一段話／一頁網頁加選項 -->
        <svg v-if="m === 'greeting'" class="omode__art" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <rect x="6" y="10" width="44" height="30" rx="8" />
          <path d="M14 40l-4 10 12-10" />
          <path d="M15 20h26M15 27h20M15 33h12" />
        </svg>
        <svg v-else class="omode__art" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <rect x="8" y="6" width="48" height="34" rx="5" />
          <path d="M8 14h48" />
          <rect x="10" y="46" width="44" height="6" rx="3" />
          <rect x="10" y="55" width="30" height="6" rx="3" />
        </svg>
      </button>
    </div>

    <p v-if="switchNotice" class="notice opening__notice opening__notice--switched" role="status" data-opening-switched>
      <span>{{ switchNotice }}</span>
      <button type="button" class="btn btn--sm btn--ghost" @click="emit('update:mode', savedMode)">{{ $t("editor.opening.switchBack") }}</button>
    </p>
    <p v-else-if="leftover" class="notice opening__notice" role="status" data-opening-leftover>
      <span>{{ $t(`editor.opening.leftover.${leftover}`) }}</span>
      <span class="opening__acts">
        <button type="button" class="btn btn--sm btn--ghost" @click="removeLeftover">{{ $t(`editor.opening.leftover.${leftover}.remove`) }}</button>
        <button type="button" class="btn btn--sm btn--ghost" @click="emit('update:mode', leftover)">{{ $t(`editor.opening.leftover.${leftover}.use`) }}</button>
      </span>
    </p>

    <template v-if="mode === 'greeting'">
      <div class="field">
        <div class="opening__head">
          <label for="f-welcome">{{ $t("editor.welcome") }}<span class="req" aria-hidden="true">*</span></label>
          <div class="seg seg--sm" role="tablist" :aria-label="$t('editor.welcome')">
            <button type="button" class="seg__item" :class="{ 'seg__item--on': welcomeTab === 'write' }" role="tab"
                    :aria-selected="welcomeTab === 'write'" @click="welcomeTab = 'write'">{{ $t("editor.readme.write") }}</button>
            <button type="button" class="seg__item" :class="{ 'seg__item--on': welcomeTab === 'player' }" role="tab"
                    :aria-selected="welcomeTab === 'player'" data-opening-player @click="welcomeTab = 'player'">{{ $t("editor.opening.player") }}</button>
          </div>
        </div>
        <FieldText v-show="welcomeTab === 'write'" id="f-welcome" v-model="welcomeModel" label="" :rows="8"
                   :max="welcomeMax" :hint="$t('editor.welcome.hint')" />
        <div v-if="welcomeTab === 'player'" class="opening__preview">
          <iframe v-if="welcome.trim()" class="opening__frame" sandbox="allow-scripts" :srcdoc="playerDoc"
                  :title="$t('editor.opening.player')" data-opening-player-frame />
          <p v-else class="subtle">{{ $t("editor.opening.player.empty") }}</p>
        </div>
        <p class="subtle opening__rules" data-opening-rule-hint>
          {{ ruleHits ? $t("editor.opening.rules.hit", { n: ruleHits }) : $t("editor.opening.rules.none") }}
          <button type="button" class="link opening__link" @click="emit('edit-rules')">{{ $t("editor.opening.rules.edit") }}</button>
        </p>
      </div>

      <ListEditor :model-value="alternates" :label="$t('editor.alternates')" :hint="$t('editor.alternates.hint')"
                  :rows="4" :add-label="$t('editor.alternates.add')" :remove-label="$t('list.remove')"
                  :up-label="$t('list.up')" :down-label="$t('list.down')" @update:model-value="emit('update:alternates', $event)" />

      <ListEditor :model-value="prologue" :label="$t('editor.opening.suggest')" :hint="$t('editor.opening.suggest.hint')"
                  :add-label="$t('editor.opening.suggest.add')" :remove-label="$t('list.remove')"
                  :up-label="$t('list.up')" :down-label="$t('list.down')" @update:model-value="emit('update:prologue', $event)" />
    </template>

    <template v-else>
      <div class="field">
        <div class="opening__head">
          <span class="opening__title">
            <label :for="pageFile ? undefined : 'f-opening-page'" :id="pageFile ? 'f-opening-page-label' : undefined">{{ $t("editor.openingPage") }}</label>
            <span v-if="pageUnsaved" class="opening__unsaved" data-opening-unsaved>{{ $t("editor.openingPage.unsaved") }}</span>
          </span>
          <div class="opening__tools">
            <template v-if="fileControl">
              <button ref="pageUploadButton" type="button" class="btn btn--sm btn--ghost" data-opening-upload
                      :disabled="!!transfer" @click="pageFileInput?.click()">{{ $t("editor.openingPage.upload") }}</button>
              <button v-if="!pageFile && pageHasText" type="button" class="btn btn--sm btn--ghost" data-opening-download
                      @click="fileControl.download()">{{ $t("editor.openingPage.download") }}</button>
              <input ref="pageFileInput" type="file" accept=".html,.htm,text/html" hidden data-opening-file-input @change="onPagePick" />
            </template>
            <div class="seg seg--sm" role="tablist" :aria-label="$t('editor.openingPage')">
              <button type="button" class="seg__item" :class="{ 'seg__item--on': pageTab === 'write' }" role="tab"
                      :aria-selected="pageTab === 'write'" @click="pageTab = 'write'">{{ $t("editor.readme.write") }}</button>
              <button type="button" class="seg__item" :class="{ 'seg__item--on': pageTab === 'preview' }" role="tab"
                      :aria-selected="pageTab === 'preview'" @click="pageTab = 'preview'">{{ $t("editor.readme.preview") }}</button>
            </div>
          </div>
        </div>
        <p v-if="fileNotice" class="subtle opening__file-notice" role="status" data-opening-file-notice>{{ fileNotice }}</p>
        <div v-show="pageTab === 'write'" class="opening__page-write">
          <div v-if="pageFile" ref="pageCard" class="ofile" role="group" tabindex="-1" data-opening-file
               aria-labelledby="f-opening-file-name" aria-describedby="f-opening-file-desc f-opening-page-usage">
            <div class="ofile__head">
              <svg class="ofile__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5M9.5 13.5 8 15l1.5 1.5M14.5 13.5 16 15l-1.5 1.5" />
              </svg>
              <span id="f-opening-file-name" class="ofile__name">{{ OPENING_PAGE_FILENAME }}</span>
              <span class="ofile__size">{{ formatPageSize(pageFile.bytes, String(locale)) }}</span>
            </div>
            <p id="f-opening-file-desc" class="ofile__desc">{{ $t("editor.openingPage.fileDesc") }}</p>
            <div v-if="transfer && transfer.kind !== 'preview'" class="ofile__progress" data-opening-progress>
              <div class="ofile__track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
                   :aria-valuenow="transfer.percent ?? undefined" :aria-label="transferLabel">
                <div class="ofile__bar" :style="{ width: `${transfer.percent ?? 0}%` }" />
              </div>
              <span class="ofile__progress-text">{{ transferLabel }}</span>
              <button type="button" class="btn btn--sm btn--ghost" data-opening-cancel @click="fileControl?.cancel()">{{ $t("editor.openingPage.cancel") }}</button>
            </div>
            <div class="ofile__acts">
              <button type="button" class="btn btn--sm btn--ghost" data-opening-download :disabled="!!transfer"
                      @click="fileControl?.download()">{{ $t("editor.openingPage.download") }}</button>
              <button type="button" class="btn btn--sm btn--danger" data-opening-clear :disabled="!!transfer"
                      @click="clearPageFile">{{ $t("editor.openingPage.clear") }}</button>
            </div>
          </div>
          <textarea v-else id="f-opening-page" ref="pageInput" v-model="pageModel" class="input opening__page-input" rows="8"
                    autocomplete="off" :aria-invalid="pageOver || undefined"
                    :aria-describedby="`f-opening-page-hint${pageUsage ? ' f-opening-page-usage' : ''}${pageOver ? ' f-opening-page-limit' : ''}`"
                    @paste="onPagePaste" />
          <div class="opening__page-meta">
            <span v-if="!pageFile" id="f-opening-page-hint" class="subtle">{{ $t("editor.openingPage.hint") }}</span>
            <span v-if="pageUsage" id="f-opening-page-usage" class="subtle opening__page-usage" :class="{ 'opening__page-error': pageOver }">
              {{ $t("editor.openingPage.usage", { size: formatPageSize(pageBytes, String(locale)), max: pageMaxMB }) }}
            </span>
          </div>
          <p v-if="pageLarge" class="subtle opening__large" data-opening-large>{{ $t("editor.openingPage.largeHint") }}</p>
        </div>
        <p v-if="fileError" class="opening__page-error" role="alert" data-opening-file-error>{{ fileError }}</p>
        <p v-if="pageOver" id="f-opening-page-limit" class="opening__page-error" role="alert">
          {{ $t("editor.openingPage.tooLong", { max: pageMaxMB }) }}
        </p>
        <div v-if="pageTab === 'preview'" class="opening__preview">
          <template v-if="pageFile">
            <iframe v-if="filePreviewUrl" class="opening__frame opening__frame--page" sandbox="allow-scripts" :src="filePreviewUrl"
                    :title="$t('editor.openingPage')" data-opening-file-preview />
            <div v-else class="opening__preview-load">
              <p class="subtle">{{ $t("editor.openingPage.previewHint", { size: formatPageSize(pageFile.bytes, String(locale)) }) }}</p>
              <div v-if="transfer?.kind === 'preview'" class="ofile__progress">
                <div class="ofile__track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
                     :aria-valuenow="transfer.percent ?? undefined" :aria-label="transferLabel">
                  <div class="ofile__bar" :style="{ width: `${transfer.percent ?? 0}%` }" />
                </div>
                <span class="ofile__progress-text">{{ transferLabel }}</span>
              </div>
              <button v-else type="button" class="btn btn--sm btn--ghost" data-opening-preview-load @click="loadFilePreview">{{ $t("editor.openingPage.previewLoad") }}</button>
            </div>
          </template>
          <iframe v-else-if="pageHasText" class="opening__frame opening__frame--page" sandbox="allow-scripts" :srcdoc="pageDoc"
                  :title="$t('editor.openingPage')" />
          <p v-else class="subtle">{{ $t("editor.opening.page.empty") }}</p>
        </div>
      </div>

      <div class="opening__choices" :class="{ 'is-missing': missing }">
        <ListEditor :model-value="prologue" :label="$t('editor.opening.choices')" required :hint="$t('editor.opening.choices.hint')"
                    :add-label="$t('editor.opening.choices.add')" :remove-label="$t('list.remove')"
                    :up-label="$t('list.up')" :down-label="$t('list.down')" @update:model-value="emit('update:prologue', $event)" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.opening { display: grid; gap: var(--s-4); min-width: 0; }
.omode { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-3); }
.omode__card {
  display: grid; grid-template-columns: auto minmax(0, 1fr) 64px; align-items: start; gap: var(--s-3);
  padding: var(--s-3) var(--s-4); text-align: left; cursor: pointer;
  border: 1px solid var(--border-strong); border-radius: var(--r-md); background: var(--surface); color: var(--text);
  font: inherit; transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.omode__card:hover { border-color: var(--text-3); }
.omode__card:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.omode__card--on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.omode__dot {
  width: 18px; height: 18px; margin-top: 2px; border-radius: 50%;
  border: 1.5px solid var(--border-strong); background: var(--surface);
}
.omode__card--on .omode__dot { border: 5px solid var(--accent); }
.omode__text { display: grid; gap: 4px; min-width: 0; }
.omode__name { font-size: 15px; font-weight: 600; }
.omode__desc { font-size: 13px; line-height: 1.55; color: var(--text-2); }
.omode__art { width: 64px; height: 64px; color: var(--text-3); }
.omode__card--on .omode__art { color: var(--accent-text); }
:lang(ko) .omode__desc { word-break: keep-all; }
:lang(ja) .omode__desc { word-break: auto-phrase; }

.opening__notice { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2) var(--s-3); margin: 0; }
.opening__acts { display: flex; flex-wrap: wrap; gap: var(--s-2); }
/* 剛切換造成的提示用淡強調底，跟「這張卡原本就兩樣都有」的灰底分得開 */
.opening__notice--switched { background: var(--accent-tint); }
.opening__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: var(--h-sm); }
.opening__head label { font-size: 13px; font-weight: 600; line-height: 1.3; }
.opening__head .seg__item { height: 28px; padding: 0 12px; font-size: 12.5px; }
.req { color: var(--danger); margin-left: 2px; }
.opening__preview { min-height: 180px; border-radius: var(--r-md); background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; display: grid; }
.opening__preview > .subtle { margin: 0; padding: var(--s-4); }
.opening__frame { width: 100%; min-height: 320px; border: 0; background: transparent; }
.opening__frame--page { background: #fff; }
.opening__page-write { display: grid; gap: var(--s-2); min-width: 0; }
.opening__page-input { min-height: calc(8 * 1.7em + 26px); resize: vertical; }
.opening__page-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s-2); }
.opening__page-meta > :first-child { flex: 1 1 16em; }
.opening__page-usage { margin-inline-start: auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
.opening__page-error { margin: 0; color: var(--danger); font-size: 12.5px; }
/* 標題列在手機上自然換行：標籤不被擠成一字一行，工具列整排換到下一行 */
.opening__head:has(.opening__tools) { flex-wrap: wrap; row-gap: var(--s-2); }
.opening__title { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); flex: 0 0 auto; max-width: 100%; }
.opening__title label { font-size: 13px; font-weight: 600; line-height: 1.3; }
.opening__unsaved {
  display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: var(--r-pill);
  background: var(--accent-tint); color: var(--accent-text); font-size: 12px; font-weight: 500; white-space: nowrap;
}
.opening__tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--s-2); }
.opening__tools .btn { position: relative; }
/* 30px 高的小按鈕，點擊區補到 44px */
.opening__tools .btn::after, .ofile__acts .btn::after { content: ""; position: absolute; inset: -7px 0; }
.opening__file-notice { margin: 0; }
.opening__large { margin: 0; }
.ofile {
  display: grid; gap: var(--s-2); padding: var(--s-3) var(--s-4);
  border-radius: var(--r-md); background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line);
}
.ofile:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft); }
.ofile__head { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
.ofile__icon { width: 22px; height: 22px; flex: none; color: var(--text-2); }
.ofile__name { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.ofile__size {
  display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: var(--r-pill);
  background: var(--surface); color: var(--text-2); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap;
}
.ofile__desc { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-2); }
.ofile__acts { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.ofile__acts .btn { position: relative; }
.ofile__progress { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
.ofile__track { flex: 1 1 10em; height: 6px; border-radius: var(--r-pill); background: var(--surface); overflow: hidden; box-shadow: inset 0 0 0 1px var(--line); }
.ofile__bar { height: 100%; background: var(--accent); transition: width var(--dur) var(--ease); }
.ofile__progress-text { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.opening__preview-load { display: grid; gap: var(--s-3); align-content: start; justify-items: start; padding: var(--s-4); }
.opening__preview-load > p { margin: 0; }
.opening__preview-load .ofile__progress { width: 100%; }
:lang(ko) .ofile__desc { word-break: keep-all; }
.opening__rules { margin: 0; }
.opening__link { background: transparent; border: 0; padding: 0; font: inherit; color: var(--accent-text); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.opening__choices.is-missing :deep(.field > label) { color: var(--danger); }
.opening :deep(.field) { margin-bottom: 0; }

@media (max-width: 760px) {
  .omode { grid-template-columns: minmax(0, 1fr); }
  .opening__page-meta > :first-child { flex-basis: 100%; }
}
</style>
