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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { applyTavernRules } from "stage-canvas/rule-engine-core";
import { scopeCardHtml } from "stage-canvas/style-scope";
import { openingSrcdoc } from "stage-common/opening-page";
import FieldText from "@/components/editor/FieldText.vue";
import ListEditor from "@/components/editor/ListEditor.vue";
import type { OpeningMode, RegexRule } from "@/lib/regex-rules";

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
}>();
const emit = defineEmits<{
  "update:mode": [OpeningMode];
  "update:welcome": [string];
  "update:alternates": [string[]];
  "update:prologue": [string[]];
  "update:openingPage": [string];
  "edit-rules": [];
}>();
const { t } = useI18n();

const welcomeModel = computed({ get: () => props.welcome, set: (v: string) => emit("update:welcome", v) });
const pageModel = computed({ get: () => props.openingPage, set: (v: string) => emit("update:openingPage", v) });

const MODES: OpeningMode[] = ["greeting", "page"];
const modes = computed(() => (props.pageAvailable ? MODES : MODES.filter((m) => m === "greeting" || props.mode === m)));

const hasGreeting = computed(() => Boolean(props.welcome.trim()) || props.alternates.some((a) => a.trim()));
const hasPage = computed(() => Boolean(props.openingPage.trim()));
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
  } else if (leftover.value === "page") emit("update:openingPage", "");
}

// ── 開場白：撰寫／玩家看到的 ──────────────────────────────────────────
const welcomeTab = ref<"write" | "player">("write");
const pageTab = ref<"write" | "preview">("write");

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
    <div class="omode" role="radiogroup" :aria-label="$t('editor.opening.mode')">
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

    <p v-if="switchNotice" class="notice opening__notice" role="status" data-opening-switched>
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
          <label for="f-opening-page">{{ $t("editor.openingPage") }}</label>
          <div class="seg seg--sm" role="tablist" :aria-label="$t('editor.openingPage')">
            <button type="button" class="seg__item" :class="{ 'seg__item--on': pageTab === 'write' }" role="tab"
                    :aria-selected="pageTab === 'write'" @click="pageTab = 'write'">{{ $t("editor.readme.write") }}</button>
            <button type="button" class="seg__item" :class="{ 'seg__item--on': pageTab === 'preview' }" role="tab"
                    :aria-selected="pageTab === 'preview'" @click="pageTab = 'preview'">{{ $t("editor.readme.preview") }}</button>
          </div>
        </div>
        <FieldText v-show="pageTab === 'write'" id="f-opening-page" v-model="pageModel" label="" :rows="8"
                   :hint="$t('editor.openingPage.hint')" />
        <div v-if="pageTab === 'preview'" class="opening__preview">
          <iframe v-if="openingPage.trim()" class="opening__frame opening__frame--page" sandbox="allow-scripts" :srcdoc="pageDoc"
                  :title="$t('editor.openingPage')" />
          <p v-else class="subtle">{{ $t("editor.opening.page.empty") }}</p>
        </div>
      </div>

      <div class="opening__choices" :class="{ 'is-missing': missing }">
        <ListEditor :model-value="prologue" :label="$t('editor.opening.choices')" :hint="$t('editor.opening.choices.hint')"
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
.opening__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: var(--h-sm); }
.opening__head label { font-size: 13px; font-weight: 600; line-height: 1.3; }
.opening__head .seg__item { height: 28px; padding: 0 12px; font-size: 12.5px; }
.req { color: var(--danger); margin-left: 2px; }
.opening__preview { min-height: 180px; border-radius: var(--r-md); background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; display: grid; }
.opening__preview > .subtle { margin: 0; padding: var(--s-4); }
.opening__frame { width: 100%; min-height: 320px; border: 0; background: transparent; }
.opening__frame--page { background: #fff; }
.opening__rules { margin: 0; }
.opening__link { background: transparent; border: 0; padding: 0; font: inherit; color: var(--accent-text); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.opening__choices.is-missing :deep(.field > label) { color: var(--danger); }
.opening :deep(.field) { margin-bottom: 0; }

@media (max-width: 760px) {
  .omode { grid-template-columns: minmax(0, 1fr); }
}
</style>
