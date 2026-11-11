<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { APPEARANCE_FIELDS, CARD_CSS_MAX_BYTES, readAppearance, writeAppearance } from "@/lib/card-appearance";
import { confirmDialog } from "@/lib/confirm";

const props = defineProps<{ modelValue: string; cssDialect?: string; invalid?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [string]; remove: [] }>();
const { t, locale } = useI18n();
const id = useId();
const open = ref(false);
const added = ref(false);
const referenceOpen = ref(false);
const toggleButton = ref<HTMLButtonElement>();
const values = reactive<Record<string, string>>({});
const storedValues = reactive<Record<string, string>>({});
const customCss = ref("");
let written: string | undefined;

function hydrate(css: string) {
  const parsed = readAppearance(css);
  for (const field of APPEARANCE_FIELDS) values[field.id] = storedValues[field.id] = parsed.values[field.id] ?? "";
  customCss.value = parsed.customCss;
}
watch(() => props.modelValue, (css) => {
  if (css === written) return;
  hydrate(css);
}, { immediate: true });

function valid(value: string, kind: "color" | "font") {
  const text = value.trim();
  return !text || (!/[;{}]|\/\*/.test(text) && typeof CSS !== "undefined" && CSS.supports(kind === "font" ? "font-family" : "color", text));
}
const problems = computed(() => Object.fromEntries(APPEARANCE_FIELDS.map(field => [field.id, !valid(values[field.id] ?? "", field.kind)])));
function commit() {
  written = writeAppearance(storedValues, customCss.value);
  emit("update:modelValue", written);
}
function updateField(field: (typeof APPEARANCE_FIELDS)[number], value: string) {
  values[field.id] = value;
  if (!valid(value, field.kind)) return;
  storedValues[field.id] = value.trim();
  commit();
}
function updateCustom(value: string) {
  const parsed = readAppearance(value);
  if (parsed.customCss !== value) {
    for (const field of APPEARANCE_FIELDS) values[field.id] = storedValues[field.id] = parsed.values[field.id] ?? "";
  }
  customCss.value = parsed.customCss;
  commit();
}

const bytes = computed(() => new TextEncoder().encode(props.modelValue).length);
const overLimit = computed(() => props.invalid || bytes.value > CARD_CSS_MAX_BYTES);
watch(overLimit, value => { if (value) { open.value = true; added.value = true; } }, { immediate: true });
const count = computed(() => APPEARANCE_FIELDS.filter(field => (storedValues[field.id] ?? "").trim()).length);
const hasCustom = computed(() => !!customCss.value.trim());
const used = computed(() => !!props.modelValue.trim());
const summary = computed(() => {
  if (count.value && hasCustom.value) return t("editor.cardCss.summary.both", { n: count.value }, count.value);
  if (count.value) return t("editor.cardCss.summary.appearance", { n: count.value }, count.value);
  return t(hasCustom.value ? "editor.cardCss.summary.custom" : "editor.cardCss.unused");
});
async function toggle() {
  if (open.value) { open.value = false; return; }
  open.value = true;
  const firstUse = !used.value && !added.value;
  added.value = true;
  await nextTick();
  if (firstUse) document.getElementById(`${id}-aiBg`)?.focus();
}
async function remove() {
  if (props.modelValue.trim() && !(await confirmDialog({
    title: t("editor.cardCss.removeTitle"), message: t("editor.cardCss.removeMessage"),
    confirmText: t("editor.cardCss.removeConfirm"), danger: true, dangerAppearance: "subdued",
  }))) return;
  hydrate(""); written = "";
  emit("update:modelValue", ""); emit("remove");
  open.value = false; added.value = false;
  await nextTick(); toggleButton.value?.focus();
}

const reference = [
  { id: "ai", variable: "--lt-canvas-bubble-ai-bg", selector: '.mes[data-lt-role="ai"] .mes_text' },
  { id: "user", variable: "--lt-canvas-bubble-user-bg", selector: '.mes[data-lt-role="user"] .mes_text' },
  { id: "input", variable: "--lt-canvas-composer-field-bg", selector: ".composer-field" },
  { id: "send", variable: "--lt-canvas-send-bg", selector: ".lt-send" },
  { id: "background", variable: "--lt-canvas-bg", selector: ".canvas-root" },
  { id: "dark", variable: "", selector: '.canvas-root[data-lt-theme="dark"]' },
];
const example = writeAppearance({
  aiBg: "#243447", bubbleText: "#f2f2f5", userBg: "#37465b", inputBg: "#1e2938",
  sendBg: "#355a7c", accent: "#8fc9ff", font: "system-ui, sans-serif", background: "#121b28",
}, "");
const guideHref = computed(() => `${locale.value === "zh-Hant" ? "" : `/${locale.value}`}/guide?way=web#${t("editor.cardCss.guideAnchor")}`);
const copied = ref("");
const copyStatus = ref("");
let copyTimer: ReturnType<typeof setTimeout> | undefined;
async function copy(value: string, key: string) {
  clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText(value);
    copied.value = key; copyStatus.value = t("editor.cardCss.copied");
    copyTimer = setTimeout(() => { copied.value = ""; copyStatus.value = ""; }, 2000);
  } catch {
    copied.value = ""; copyStatus.value = t("editor.cardCss.copyFailed");
  }
}
onBeforeUnmount(() => clearTimeout(copyTimer));
</script>

<template>
  <section class="panel card-style" data-card-css-panel>
    <div class="card-style__head">
      <div class="card-style__title">
        <h3>{{ t("editor.cardCss.title") }}</h3>
        <span class="chip" :class="{ 'card-style__chip--used': used }">{{ summary }}</span>
      </div>
      <button ref="toggleButton" type="button" class="btn btn--sm" data-card-css-toggle :aria-expanded="open" :aria-controls="`${id}-body`" @click="toggle">
        {{ t(open ? "editor.cardCss.collapse" : used || added ? "editor.cardCss.expand" : "editor.cardCss.add") }}
      </button>
    </div>
    <p class="muted card-style__lede">{{ t("editor.cardCss.lede") }}</p>
    <div v-if="open" :id="`${id}-body`" class="card-style__body">
      <div class="card-style__appearance">
        <h4>{{ t("editor.cardCss.appearance") }}</h4>
        <div class="card-style__fields">
          <div v-for="field in APPEARANCE_FIELDS" :key="field.id" class="card-style__field">
            <span class="card-style__swatch" :class="{ 'card-style__swatch--default': !values[field.id]?.trim() || problems[field.id] }" :style="field.kind === 'color' && !problems[field.id] ? { backgroundColor: values[field.id] || undefined } : undefined" aria-hidden="true">
              <span v-if="field.kind === 'font'" :style="!problems[field.id] ? { fontFamily: values[field.id] || undefined } : undefined">Aa</span>
            </span>
            <label :for="`${id}-${field.id}`">{{ t(`editor.cardCss.field.${field.id}`) }}</label>
            <input :id="`${id}-${field.id}`" class="input card-style__value" :data-appearance-field="field.id" :value="values[field.id]" :placeholder="t('editor.cardCss.default')" :aria-invalid="problems[field.id] || undefined" :aria-describedby="problems[field.id] ? `${id}-${field.id}-error` : undefined" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" @input="updateField(field, ($event.target as HTMLInputElement).value)" />
            <button v-if="values[field.id]" type="button" class="btn btn--sm btn--icon btn--ghost card-style__clear" :data-appearance-clear="field.id" :aria-label="t('editor.cardCss.clearField', { name: t(`editor.cardCss.field.${field.id}`) })" @click="updateField(field, '')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
            <span v-else class="card-style__clear-space" aria-hidden="true" />
            <p v-if="problems[field.id]" :id="`${id}-${field.id}-error`" class="card-style__error">{{ t(field.kind === "font" ? "editor.cardCss.invalidFont" : "editor.cardCss.invalidColor") }}</p>
          </div>
        </div>
      </div>

      <div class="field card-style__custom">
        <label :for="`${id}-custom`">{{ t("editor.cardCss.custom") }}</label>
        <textarea :id="`${id}-custom`" class="input" :value="customCss" :placeholder="t('editor.cardCss.placeholder')" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" :aria-invalid="overLimit || undefined" :aria-describedby="`${id}-custom-hint ${id}-usage${overLimit ? ` ${id}-limit` : ''}`" @input="updateCustom(($event.target as HTMLTextAreaElement).value)" />
        <div class="card-style__custom-meta">
          <span :id="`${id}-custom-hint`" class="subtle">{{ t("editor.cardCss.customHint") }}</span>
          <span :id="`${id}-usage`" class="subtle card-style__usage" :class="{ 'card-style__error': overLimit }" data-card-css-usage>{{ t("editor.cardCss.usage", { size: (bytes / 1024).toLocaleString(String(locale), { maximumFractionDigits: 1 }), max: CARD_CSS_MAX_BYTES / 1024 }) }}</span>
        </div>
        <p v-if="overLimit" :id="`${id}-limit`" class="card-style__error" role="alert">{{ t("editor.cardCss.tooLong", { max: CARD_CSS_MAX_BYTES / 1024 }) }}</p>
      </div>
      <p class="card-style__note">{{ t("editor.cardCss.priority") }}</p>

      <div class="card-style__reference">
        <button type="button" class="btn btn--ghost card-style__reference-toggle" data-card-css-reference-toggle :aria-expanded="referenceOpen" :aria-controls="`${id}-reference`" @click="referenceOpen = !referenceOpen">
          {{ t("editor.cardCss.reference") }}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" :class="{ 'is-open': referenceOpen }"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <div v-if="referenceOpen" :id="`${id}-reference`" class="card-style__reference-body">
          <p class="subtle">{{ t("editor.cardCss.referenceHint") }}</p>
          <dl class="card-style__positions">
            <div v-for="position in reference" :key="position.id" class="card-style__position">
              <dt>{{ t(`editor.cardCss.position.${position.id}`) }}</dt>
              <dd class="card-style__code-row">
                <code>{{ position.variable || '—' }}</code>
                <button v-if="position.variable" type="button" class="btn btn--sm btn--ghost" :aria-label="t('editor.cardCss.copyVariable', { name: t(`editor.cardCss.position.${position.id}`) })" @click="copy(position.variable, `${position.id}-variable`)">{{ t(copied === `${position.id}-variable` ? "editor.cardCss.copied" : "editor.cardCss.copy") }}</button>
              </dd>
              <dd class="card-style__code-row">
                <code>{{ position.selector }}</code>
                <button type="button" class="btn btn--sm btn--ghost" :data-copy-selector="position.id" :aria-label="t('editor.cardCss.copySelector', { name: t(`editor.cardCss.position.${position.id}`) })" @click="copy(position.selector, position.id)">{{ t(copied === position.id ? "editor.cardCss.copied" : "editor.cardCss.copy") }}</button>
              </dd>
            </div>
          </dl>
          <p class="subtle">{{ t("editor.cardCss.directCssHint") }}</p>
          <p class="subtle">{{ t("editor.cardCss.fengyueHint") }}</p>
          <div v-if="props.cssDialect === 'fengyue'" class="card-style__aliases" data-fengyue-aliases>
            <p class="subtle">{{ t("editor.cardCss.fengyueAliases") }}</p>
            <div class="card-style__code-row"><code>#installedBuiltInCss</code><button type="button" class="btn btn--sm btn--ghost" data-copy-fengyue-root @click="copy('#installedBuiltInCss', 'fengyue-root')">{{ t(copied === 'fengyue-root' ? "editor.cardCss.copied" : "editor.cardCss.copyFengyueRoot") }}</button></div>
            <div class="card-style__code-row"><code>.dark #installedBuiltInCss</code><button type="button" class="btn btn--sm btn--ghost" data-copy-fengyue-dark @click="copy('.dark #installedBuiltInCss', 'fengyue-dark')">{{ t(copied === 'fengyue-dark' ? "editor.cardCss.copied" : "editor.cardCss.copyFengyueDark") }}</button></div>
          </div>
          <div class="card-style__example">
            <div class="card-style__example-head"><h4>{{ t("editor.cardCss.example") }}</h4><button type="button" class="btn btn--sm btn--ghost" data-copy-example @click="copy(example, 'example')">{{ t(copied === 'example' ? "editor.cardCss.copied" : "editor.cardCss.copy") }}</button></div>
            <pre><code>{{ example }}</code></pre>
          </div>
          <p class="subtle card-style__copy-status" role="status" aria-live="polite">{{ copyStatus }}</p>
          <a class="link" :href="guideHref" data-card-css-guide>{{ t("editor.cardCss.guide") }}</a>
        </div>
      </div>
      <div><button type="button" class="btn btn--sm btn--danger" data-card-css-remove @click="remove">{{ t("editor.cardCss.remove") }}</button></div>
    </div>
  </section>
</template>

<style scoped>
.card-style { display: grid; gap: var(--s-3); min-width: 0; }
.card-style__head, .card-style__title { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; min-width: 0; }
.card-style__head { justify-content: space-between; gap: var(--s-3); }
.card-style h3, .card-style h4, .card-style p { margin: 0; }
.card-style h3 { font-size: 15px; }
.card-style h4 { font-size: 14px; }
.card-style .chip { white-space: nowrap; font-variant-numeric: tabular-nums; }
.card-style__chip--used { background: var(--accent-tint); color: var(--accent-text); }
.card-style__body { display: grid; gap: var(--s-4); padding-top: var(--s-3); border-top: 1px solid var(--line); min-width: 0; }
.card-style__lede, .card-style__body { overflow-wrap: anywhere; }
.card-style__appearance { display: grid; gap: var(--s-3); }
.card-style__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-3) var(--s-4); }
.card-style__field { display: grid; grid-template-columns: 28px minmax(0, 1fr) 108px var(--h-sm); align-items: center; gap: var(--s-2); }
.card-style__field label { font-size: 13px; line-height: 1.45; }
.card-style__value { min-width: 0; padding-inline: var(--s-2); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.card-style__swatch { width: 28px; height: 28px; border-radius: var(--r-sm); box-shadow: inset 0 0 0 1px var(--line-strong); display: flex; align-items: center; justify-content: center; font-size: 12px; overflow: hidden; }
.card-style__swatch--default { background: repeating-linear-gradient(135deg, var(--surface-2) 0 4px, var(--surface) 4px 8px); }
.card-style__clear { width: var(--h-sm); height: var(--h-sm); }
.card-style__error { color: var(--danger); font-size: 12px; }
.card-style__field .card-style__error { grid-column: 2 / -1; }
.card-style__custom { display: grid; gap: var(--s-2); margin-bottom: 0; }
.card-style__custom textarea { min-height: 140px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; resize: vertical; }
.card-style__custom-meta { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: var(--s-2); }
.card-style__usage { white-space: nowrap; font-variant-numeric: tabular-nums; }
.card-style__note { padding: var(--s-3); background: var(--surface-2); color: var(--text-2); border-radius: var(--r-sm); font-size: 13px; }
.card-style__reference-toggle { width: 100%; padding-inline: 0; justify-content: space-between; font-size: 14px; font-weight: 600; }
.card-style__reference-toggle svg { transition: transform var(--dur) var(--ease); }
.card-style__reference-toggle svg.is-open { transform: rotate(180deg); }
.card-style__reference-body { display: grid; gap: var(--s-3); padding-top: var(--s-2); }
.card-style__aliases { display: grid; gap: var(--s-2); }
.card-style__positions { margin: 0; }
.card-style__position { display: grid; grid-template-columns: 112px minmax(0, 1fr) minmax(0, 1.2fr); gap: var(--s-3); padding-block: var(--s-2); border-bottom: 1px solid var(--line); align-items: center; }
.card-style__position dt { font-size: 13px; font-weight: 600; }
.card-style__code-row { display: flex; align-items: center; gap: var(--s-2); margin: 0; min-width: 0; }
.card-style__code-row code { min-width: 0; font-size: 12px; overflow-wrap: anywhere; }
.card-style__code-row button { flex-shrink: 0; margin-left: auto; }
.card-style__example { padding: var(--s-3); background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-sm); min-width: 0; }
.card-style__example-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
.card-style__example pre { margin: var(--s-2) 0 0; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.card-style__copy-status { min-height: 1.5em; }
.card-style [data-card-css-remove] { max-width: 100%; white-space: normal; height: auto; min-height: var(--h-sm); padding-block: var(--s-2); }
:lang(ko) .card-style__field label, :lang(ko) .card-style__position dt { word-break: keep-all; }
:lang(ja) .card-style__field label, :lang(ja) .card-style__position dt { word-break: auto-phrase; }
@media (max-width: 760px) {
  .card-style__fields { grid-template-columns: minmax(0, 1fr); }
  .card-style__position { grid-template-columns: minmax(0, 1fr); gap: var(--s-1); }
  .card-style__custom textarea { min-height: 120px; }
}
@media (hover: none), (pointer: coarse) {
  .card-style .btn, .card-style input.input { min-height: var(--h-lg); }
  .card-style__field { grid-template-columns: 28px minmax(0, 1fr) 108px var(--h-lg); }
  .card-style__clear { min-width: var(--h-lg); }
}
@media (prefers-reduced-motion: reduce) { .card-style__reference-toggle svg { transition: none; } }
</style>
