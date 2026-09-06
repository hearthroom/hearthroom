<script setup lang="ts">
/**
 * 匯入：酒館角色卡（一個 PNG / JSON），或魅魔島的三件套（正則匯出檔、世界書 JSON、設定 TXT）。
 *
 * 兩階段：先解析並列出「哪些東西沒能帶過來」，作者確認之後才蓋掉表單。中間不自動套用——
 * 匯入會覆寫整份草稿，而作者可能已經打了半天字。
 *
 * 三件套模式讓作者分批加檔（原站是三個分開下載的），每個檔各自認出是哪一部分，
 * 同一部分再丟一次就換掉舊的；三格都亮了再套用，少一兩格也能套。
 *
 * 次要關鍵詞直接落到條目的 AND 門，跟酒館同一個語意，不再需要作者選要不要併。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { parseTavernFile, tavernToDraft, type ImportResult, type TavernCard } from "@/lib/tavern";
import { classifyMmdFile, mergeMmdFiles, MMD_PARTS, type MmdFile, type MmdImportResult, type MmdPart } from "@/lib/mmd";

const props = defineProps<{ language: string; detailMax?: number }>();
const emit = defineEmits<{ apply: [ImportResult] }>();

const { t } = useI18n();

type Kind = "tavern" | "mmd";
const KIND_KEY = "hr.import.kind";
const readKind = (): Kind => {
  try {
    return localStorage.getItem(KIND_KEY) === "mmd" ? "mmd" : "tavern";
  } catch {
    return "tavern";
  }
};
const kind = ref<Kind>(readKind());
watch(kind, (value) => {
  error.value = "";
  try {
    localStorage.setItem(KIND_KEY, value);
  } catch {
    /* 私密視窗等情況存不了，下次回到預設就好 */
  }
});

const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const error = ref("");
const preview = ref<ImportResult | null>(null);
const raw = ref<TavernCard | null>(null);
const rawImage = ref<Blob | null>(null);

const ERRORS: Record<string, string> = {
  tavern_invalid: "import.error.invalid",
  tavern_no_metadata: "import.error.noMetadata",
  tavern_charx_unsupported: "import.error.charx",
};
const MMD_ERRORS: Record<string, string> = {
  mmd_empty: "import.mmd.error.empty",
  mmd_invalid_json: "import.mmd.error.invalidJson",
  mmd_unknown: "import.mmd.error.unknown",
};

function build() {
  if (!raw.value) return;
  const result = tavernToDraft(raw.value, {
    language: props.language,
    image: rawImage.value,
    labels: { personality: t("import.label.personality"), scenario: t("import.label.scenario") },
  });
  preview.value = result;
}

async function read(file: File) {
  error.value = "";
  preview.value = null;
  try {
    const parsed = await parseTavernFile(file);
    raw.value = parsed.card;
    rawImage.value = parsed.image;
    build();
  } catch (err) {
    raw.value = null;
    const code = err instanceof Error ? err.message : "";
    error.value = t(ERRORS[code] ?? "import.error.invalid");
  }
}

// ── 三件套 ────────────────────────────────────────────────────────────
const mmdFiles = ref<MmdFile[]>([]);
const mmdPreview = computed<MmdImportResult | null>(() =>
  mmdFiles.value.length ? mergeMmdFiles(mmdFiles.value, { language: props.language }) : null,
);
const partFile = (part: MmdPart) => mmdFiles.value.find((f) => f.part === part) ?? null;
const detailTooLong = computed(() => {
  const n = mmdPreview.value ? [...mmdPreview.value.draft.roleDetailDesc].length : 0;
  return props.detailMax && n > props.detailMax ? n : 0;
});

async function addMmd(files: File[]) {
  error.value = "";
  const problems: string[] = [];
  for (const file of files) {
    try {
      const classified = classifyMmdFile(file.name, await file.text());
      const previous = partFile(classified.part);
      mmdFiles.value = [...mmdFiles.value.filter((f) => f.part !== classified.part), classified];
      if (previous) problems.push(t("import.mmd.replaced", { name: previous.fileName, next: file.name }));
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      problems.push(t(MMD_ERRORS[code] ?? "import.mmd.error.unknown", { name: file.name }));
    }
  }
  error.value = problems.join("\n");
}

function removeMmd(part: MmdPart) {
  mmdFiles.value = mmdFiles.value.filter((f) => f.part !== part);
}

function takeFiles(list: FileList | null | undefined) {
  const files = Array.from(list ?? []);
  if (!files.length) return;
  if (kind.value === "mmd") void addMmd(files);
  else void read(files[0]);
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  takeFiles(event.dataTransfer?.files);
}

function onPick(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = target.files;
  takeFiles(files);
  target.value = "";
}

/** 目前要套用的那份（兩種模式擇一）。 */
const current = computed<ImportResult | null>(() => (kind.value === "mmd" ? mmdPreview.value : preview.value));

function reset() {
  preview.value = null;
  raw.value = null;
  rawImage.value = null;
  mmdFiles.value = [];
  error.value = "";
}

function apply() {
  if (current.value) emit("apply", current.value);
  reset();
}

const cancel = reset;

/** PNG 卡自帶的立繪：先在報告裡給作者看一眼，套用時會拿去當頭像。 */
const thumb = ref("");
watch(rawImage, (image) => {
  if (thumb.value) URL.revokeObjectURL(thumb.value);
  thumb.value = image ? URL.createObjectURL(image) : "";
});
onBeforeUnmount(() => { if (thumb.value) URL.revokeObjectURL(thumb.value); });

</script>

<template>
  <section class="import">
    <div class="seg import__kind" role="radiogroup" :aria-label="$t('import.kind')">
      <button type="button" class="seg__item" :class="{ 'seg__item--on': kind === 'tavern' }" role="radio" :aria-checked="kind === 'tavern'" @click="kind = 'tavern'">{{ $t("import.kind.tavern") }}</button>
      <button type="button" class="seg__item" :class="{ 'seg__item--on': kind === 'mmd' }" role="radio" :aria-checked="kind === 'mmd'" @click="kind = 'mmd'">{{ $t("import.kind.mmd") }}</button>
    </div>

    <div
      class="drop"
      :class="{ 'drop--on': dragging }"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 16V4M8 8l4-4 4 4" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
      <p class="muted">{{ kind === "mmd" ? $t("import.mmd.drop") : $t("import.drop") }}</p>
      <button type="button" class="btn btn--sm" @click="input?.click()">{{ $t("import.pick") }}</button>
      <p class="subtle">{{ kind === "mmd" ? $t("import.mmd.formats") : $t("import.formats") }}</p>
      <input v-if="kind === 'mmd'" ref="input" type="file" multiple accept=".json,.txt,application/json,text/plain" class="sr-only" @change="onPick" />
      <input v-else ref="input" type="file" accept=".png,.json,image/png,application/json" class="sr-only" @change="onPick" />
    </div>

    <p v-if="error" class="notice notice--error import__error" role="alert">{{ error }}</p>

    <ul v-if="kind === 'mmd' && mmdFiles.length" class="parts">
      <li v-for="part in MMD_PARTS" :key="part" class="parts__row" :class="{ 'parts__row--on': partFile(part) }">
        <span class="parts__mark" aria-hidden="true">{{ partFile(part) ? "✓" : "○" }}</span>
        <span class="parts__label">{{ $t(`import.mmd.part.${part}`) }}</span>
        <span class="parts__file subtle">{{ partFile(part)?.fileName ?? $t("import.mmd.pending") }}</span>
        <button v-if="partFile(part)" type="button" class="btn btn--ghost btn--sm" @click="removeMmd(part)">{{ $t("import.mmd.remove") }}</button>
      </li>
    </ul>

    <div v-if="current" class="review panel">
      <div class="review__head">
        <img v-if="thumb && kind === 'tavern'" :src="thumb" alt="" class="review__thumb" />
        <div>
          <h3>{{ $t("import.review.title", { name: current.draft.roleName || $t("import.review.unnamed") }) }}</h3>
          <p class="subtle">{{ $t("import.review.spec", { spec: current.spec === "mmd" ? $t("import.kind.mmd") : current.spec }) }}</p>
        </div>
      </div>

      <ul class="landed">
        <li>{{ $t("import.landed.persona", { n: [...current.draft.roleDetailDesc].length }) }}</li>
        <li>{{ $t("import.landed.greetings", { n: (current.draft.roleWelcome ? 1 : 0) + current.draft.alternates.length }) }}</li>
        <li v-if="current.spec !== 'mmd'">{{ $t("import.landed.examples", { n: current.draft.talkExample.length }) }}</li>
        <li v-if="current.spec !== 'mmd'">{{ $t("import.landed.tags", { n: current.draft.roleTag.length }) }}</li>
        <li v-if="current.worldbook">{{ $t("import.landed.worldbook", { n: current.worldbook.entries.length }) }}</li>
        <li v-if="current.regex">{{ $t("import.landed.regex", { n: current.regex.rules.length }) }}</li>
        <li v-if="current.image">{{ $t("import.landed.image") }}</li>
      </ul>

      <p v-if="detailTooLong" class="notice notice--error">{{ $t("import.mmd.detailTooLong", { n: detailTooLong, max: props.detailMax }) }}</p>

      <div v-if="current.dropped.length" class="dropped">
        <p class="subtle strong">{{ $t("import.dropped.title") }}</p>
        <ul>
          <li v-for="(note, i) in current.dropped" :key="i" class="subtle">{{ $t(note.key, note.params ?? {}) }}</li>
        </ul>
      </div>

      <p class="notice">{{ $t("import.review.overwrite") }}</p>

      <div class="acts">
        <button type="button" class="btn btn--primary btn--sm" @click="apply">{{ $t("import.apply") }}</button>
        <button type="button" class="btn btn--ghost btn--sm" @click="cancel">{{ $t("import.cancel") }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.import__kind { margin-bottom: var(--s-3); }
.drop {
  display: grid; justify-items: center; gap: var(--s-2);
  padding: var(--s-5) var(--s-4); text-align: center;
  border: 1px dashed var(--line-strong); border-radius: var(--r-lg);
  color: var(--text-3); transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.drop--on { border-color: var(--accent); background: var(--accent-tint); }
.drop p { margin: 0; }
.import__error { white-space: pre-line; }
.parts { margin: var(--s-3) 0 0; padding: 0; list-style: none; display: grid; gap: var(--s-1); }
.parts__row {
  display: grid; grid-template-columns: auto auto 1fr auto; align-items: center; gap: var(--s-2);
  min-height: var(--h-sm); padding: 0 var(--s-2); border-radius: var(--r-sm); font-size: 13px; color: var(--text-3);
}
.parts__row--on { color: var(--text); background: var(--surface-2); }
.parts__mark { width: 1.2em; text-align: center; }
.parts__label { font-weight: 600; white-space: nowrap; }
.parts__file { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.review { margin-top: var(--s-3); padding: var(--s-4); display: grid; gap: var(--s-2); }
.review__head { display: flex; gap: var(--s-3); align-items: center; }
.review__thumb { width: 48px; height: 64px; object-fit: cover; border-radius: var(--r-sm); flex: none; box-shadow: 0 0 0 1px var(--line); }
.review h3 { margin: 0; font-size: 16px; }
.landed { margin: 0; padding-left: 1.1em; display: grid; gap: 4px; color: var(--text-2); font-size: 13px; }
.dropped ul { margin: var(--s-1) 0 0; padding-left: 1.1em; display: grid; gap: 4px; }
.strong { font-weight: 600; color: var(--text-2); }
.acts { display: flex; gap: var(--s-2); }
</style>
