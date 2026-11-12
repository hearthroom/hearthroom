<script setup lang="ts">
/** Card images keep selected files in memory until a named card can own them. */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import LibraryPicker from "./LibraryPicker.vue";

const props = defineProps<{
  label: string;
  modelValue: string;
  hint?: string;
  pickLabel: string;
  clearLabel: string;
  uploading: string;
  /** share＝連結預覽的 1.91:1（1200×630） */
  ratio?: "square" | "wide" | "tall" | "share";
  /** 畫出中央 75%×75% 的安全區虛線：背景在舞台用 cover 裁邊，重要元素要放在這裡面。 */
  safeZone?: boolean;
  libraryLabel: string;
  /** 有給才出現「生成」：用登入身分生圖，對話框與存放位置由編輯器管。 */
  generateLabel?: string;
  ready?: boolean;
  importedFile?: File | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [string];
  pick: [File, (url: string) => void, (message: string, kind?: "retry" | "gone" | "stale" | "invalid") => void];
  adopt: [string, (url: string) => void, (message: string, kind?: "retry" | "gone" | "stale" | "invalid") => void];
  needsName: [];
  pending: [boolean];
  busy: [boolean];
  generate: [];
}>();

const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
watch(busy, value => emit("busy", value));
const error = ref("");
const dragging = ref(false);
const selected = ref<File | null>(null);
const selectedAsset = ref("");
const preview = ref("");
const failureKind = ref<"retry" | "gone" | "stale" | "invalid" | null>(null);
const hasPending = computed(() => Boolean(selected.value || selectedAsset.value));
const canUpload = computed(() => props.ready !== false);
watch(hasPending, value => emit("pending", value));
function clearSelection() {
  if (selected.value && preview.value) URL.revokeObjectURL(preview.value);
  selected.value = null; selectedAsset.value = ""; preview.value = "";
  error.value = ""; failureKind.value = null;
}
onBeforeUnmount(() => { clearSelection(); emit("pending", false); });
/** 從資源庫挑：作者的圖多半早就傳過一次了，不必為了換張卡再傳一份。 */
const picking = ref(false);

function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  // input 的 value 要清掉，不然選同一個檔第二次不會觸發 change
  (event.target as HTMLInputElement).value = "";
  if (file) pick(file);
}

/** 圖片框本身也收拖放：作者手上的圖多半在桌面或另一個視窗，拖過來比開檔案對話框快 */
function onDrop(event: DragEvent) {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file && file.type.startsWith("image/")) pick(file);
}

function pick(file: File) {
  if (busy.value) return;
  clearSelection();
  selected.value = file;
  preview.value = URL.createObjectURL(file);
  if (!canUpload.value) { emit("needsName"); return; }
  send();
}
function pickedLibrary(url: string, id: string) {
  clearSelection(); selectedAsset.value = id; preview.value = url; send();
}
function send() {
  if (busy.value || !hasPending.value || !canUpload.value) return;
  busy.value = true; error.value = ""; failureKind.value = null;
  const ok = (url: string) => { clearSelection(); emit("update:modelValue", url); busy.value = false; };
  const fail = (message: string, kind: "retry" | "gone" | "stale" | "invalid" = "retry") => {
    error.value = message; failureKind.value = kind; busy.value = false;
    if (kind === "gone") {
      if (selected.value && preview.value) URL.revokeObjectURL(preview.value);
      selected.value = null; selectedAsset.value = ""; preview.value = "";
    }
  };
  if (selected.value) emit("pick", selected.value, ok, fail);
  else emit("adopt", selectedAsset.value, ok, fail);
}
function requestLibrary() { if (!canUpload.value) emit("needsName"); else picking.value = true; }
function requestGenerate() { if (!canUpload.value) emit("needsName"); else emit("generate"); }
function remove() { clearSelection(); emit("update:modelValue", ""); }
function refresh() { window.location.reload(); }
watch(() => props.importedFile, file => { if (file) pick(file); }, { immediate: true });
</script>

<template>
  <div class="field">
    <label>{{ label }}</label>
    <div class="shell">
      <!-- 框本身就是選圖的按鈕：點一下開檔、拖一張進來也行；旁邊那顆文字鈕給不知道能點框的人 -->
      <button type="button" class="frame" :class="[`frame--${ratio ?? 'square'}`, { 'frame--on': dragging, 'frame--busy': busy, 'frame--empty': !modelValue && !preview }]"
              :aria-label="pickLabel" :aria-busy="busy || undefined" :disabled="busy || hasPending || failureKind === 'gone' || failureKind === 'stale'"
              @click="input?.click()" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
        <img v-if="preview || modelValue" :src="preview || modelValue" alt="" />
        <span v-if="busy" class="upload-mask" role="status"><span class="upload-spinner" aria-hidden="true"></span><span class="sr-only">{{ uploading }}</span></span>
        <span v-else-if="hasPending && !error" class="upload-pending">{{ $t("editor.image.pending") }}</span>
        <span v-if="modelValue && safeZone" class="safe" aria-hidden="true"></span>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ph">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M4 17l4.5-4.5 3 3L15 12l5 5" />
        </svg>
      </button>
      <div class="side">
        <p v-if="hint" class="subtle">{{ hint }}</p>
        <template v-if="hasPending && !busy && !error">
          <p v-if="!canUpload" class="notice" role="status">{{ $t("editor.image.waiting") }}</p>
          <p class="subtle">{{ $t("editor.image.waitingNote") }}</p>
        </template>
        <div class="acts">
          <template v-if="hasPending && !busy">
            <button v-if="!error || failureKind === 'retry'" type="button" class="btn btn--sm" :disabled="!canUpload" :aria-disabled="!canUpload" @click="send">{{ $t(error ? 'resource.retry' : 'editor.image.continueUpload') }}</button>
            <button type="button" class="btn btn--sm btn--ghost" @click="remove">{{ clearLabel }}</button>
          </template>
          <template v-else>
            <button type="button" class="btn btn--sm" :disabled="busy || failureKind === 'gone' || failureKind === 'stale'" @click="input?.click()">{{ busy ? uploading : pickLabel }}</button>
            <button type="button" class="btn btn--sm" :disabled="busy || failureKind === 'gone' || failureKind === 'stale'" @click="requestLibrary">{{ libraryLabel }}</button>
            <button v-if="generateLabel" type="button" class="btn btn--sm" :disabled="busy || failureKind === 'gone' || failureKind === 'stale'" @click="requestGenerate">{{ generateLabel }}</button>
            <button v-if="modelValue" type="button" class="btn btn--sm btn--ghost" :disabled="busy" @click="remove">{{ clearLabel }}</button>
          </template>
          <button v-if="failureKind === 'stale'" type="button" class="btn btn--sm" @click="refresh">{{ $t('res.refresh') }}</button>
        </div>
        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      </div>
    </div>
    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only" @change="choose" />
    <LibraryPicker v-if="picking" card-copy @pick="pickedLibrary" @close="picking = false" />
  </div>
</template>

<style scoped>
/* 框是固定寬的，說明與按鈕擠不下時就掉到框下面；不然 grid 裡的最小內容寬會把整欄撐出手機螢幕 */
.shell { display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: flex-start; }
.frame {
  flex: none; padding: 0; border: 1px dashed var(--line-strong); border-radius: var(--r-md);
  background: var(--surface-2); overflow: hidden; display: grid; place-items: center; color: var(--text-3);
  cursor: pointer; transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.frame:hover, .frame--on { border-color: var(--accent); color: var(--accent-text); background: var(--accent-tint); }
/* 有圖之後框線改實線：那是一張圖，不再是一個等著被填的洞 */
.frame:has(img) { border-style: solid; border-color: var(--line); }
.frame:has(img):hover img, .frame--on img { opacity: 0.7; }
.frame--busy { cursor: progress; }
.frame img { transition: opacity var(--dur) var(--ease); }
.frame--square { width: 128px; height: 128px; }
/* 背景是整頁的底圖，照實際比例看才知道會長怎樣；小方框判斷不了亮不亮 */
.frame--wide { width: 256px; height: 144px; }
.frame--tall { width: 144px; height: 256px; }
/* 還沒有圖：直式框縮成縮圖位，不在表單裡撐出一大塊空白（建卡頁 ui.md §2.1） */
.frame--tall.frame--empty { width: 96px; height: 171px; }
.frame--share { width: 256px; height: 134px; }
.frame { position: relative; }
/* 安全區：外圍各 12.5% 是可能被裁掉的區域 */
.safe { position: absolute; inset: 12.5%; border: 1px dashed rgba(255, 255, 255, 0.85); outline: 1px dashed rgba(0, 0, 0, 0.35); pointer-events: none; }
.frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ph { width: 28px; height: 28px; }
.side { flex: 1 1 180px; min-width: 0; display: grid; gap: var(--s-2); align-content: start; }
.acts { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.upload-mask { position: absolute; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--surface) 55%, transparent); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.upload-spinner { width: 24px; height: 24px; border: 2px solid var(--line-strong); border-top-color: var(--accent); border-radius: 50%; animation: upload-turn 1s linear infinite; }
.upload-pending { position: absolute; bottom: var(--s-2); max-width: calc(100% - 16px); padding: 2px 8px; border-radius: var(--r-pill); background: var(--surface); font-size: 12px; }
@keyframes upload-turn { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .upload-spinner { animation: none; } }
</style>
