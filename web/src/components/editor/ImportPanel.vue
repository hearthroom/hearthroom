<script setup lang="ts">
/**
 * 匯入一張酒館角色卡。
 *
 * 兩階段：先解析並列出「哪些東西沒能帶過來」，作者確認之後才蓋掉表單。中間不自動套用——
 * 匯入會覆寫整份草稿，而作者可能已經打了半天字。
 *
 * 次要關鍵詞直接落到條目的 AND 門，跟酒館同一個語意，不再需要作者選要不要併。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { parseTavernFile, tavernToDraft, type ImportResult, type TavernCard } from "@/lib/tavern";

const props = defineProps<{ language: string }>();
const emit = defineEmits<{ apply: [ImportResult] }>();

const { t } = useI18n();

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

function onDrop(event: DragEvent) {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) void read(file);
}

function onPick(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (file) void read(file);
}

function apply() {
  if (preview.value) emit("apply", preview.value);
  preview.value = null;
  raw.value = null;
  rawImage.value = null;
}

const cancel = () => {
  preview.value = null;
  raw.value = null;
  rawImage.value = null;
};

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
      <p class="muted">{{ $t("import.drop") }}</p>
      <button type="button" class="btn btn--sm" @click="input?.click()">{{ $t("import.pick") }}</button>
      <p class="subtle">{{ $t("import.formats") }}</p>
      <input ref="input" type="file" accept=".png,.json,image/png,application/json" class="sr-only" @change="onPick" />
    </div>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <div v-if="preview" class="review panel">
      <div class="review__head">
        <img v-if="thumb" :src="thumb" alt="" class="review__thumb" />
        <div>
          <h3>{{ $t("import.review.title", { name: preview.draft.roleName || $t("import.review.unnamed") }) }}</h3>
          <p class="subtle">{{ $t("import.review.spec", { spec: preview.spec }) }}</p>
        </div>
      </div>

      <ul class="landed">
        <li>{{ $t("import.landed.persona", { n: [...preview.draft.roleDetailDesc].length }) }}</li>
        <li>{{ $t("import.landed.greetings", { n: 1 + preview.draft.alternates.length }) }}</li>
        <li>{{ $t("import.landed.examples", { n: preview.draft.talkExample.length }) }}</li>
        <li>{{ $t("import.landed.tags", { n: preview.draft.roleTag.length }) }}</li>
        <li v-if="preview.worldbook">{{ $t("import.landed.worldbook", { n: preview.worldbook.entries.length }) }}</li>
        <li v-if="preview.image">{{ $t("import.landed.image") }}</li>
      </ul>

      <div v-if="preview.dropped.length" class="dropped">
        <p class="subtle strong">{{ $t("import.dropped.title") }}</p>
        <ul>
          <li v-for="(note, i) in preview.dropped" :key="i" class="subtle">{{ $t(note.key, note.params ?? {}) }}</li>
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
.drop {
  display: grid; justify-items: center; gap: var(--s-2);
  padding: var(--s-5) var(--s-4); text-align: center;
  border: 1px dashed var(--line-strong); border-radius: var(--r-lg);
  color: var(--text-3); transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.drop--on { border-color: var(--accent); background: var(--accent-tint); }
.drop p { margin: 0; }
.review { margin-top: var(--s-3); padding: var(--s-4); display: grid; gap: var(--s-2); }
.review__head { display: flex; gap: var(--s-3); align-items: center; }
.review__thumb { width: 48px; height: 64px; object-fit: cover; border-radius: var(--r-sm); flex: none; box-shadow: 0 0 0 1px var(--line); }
.review h3 { margin: 0; font-size: 16px; }
.landed { margin: 0; padding-left: 1.1em; display: grid; gap: 4px; color: var(--text-2); font-size: 13px; }
.dropped ul { margin: var(--s-1) 0 0; padding-left: 1.1em; display: grid; gap: 4px; }
.strong { font-weight: 600; color: var(--text-2); }
.acts { display: flex; gap: var(--s-2); }
</style>
