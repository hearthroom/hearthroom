<script setup lang="ts">
import PanelPreview from "@/components/editor/PanelPreview.vue";
/**
 * 卡片變數的編輯區：骨架（JSON）、寫法切換、變數規則、面板皮膚。
 *
 * 骨架是作者手打的 JSON，打到一半一定解不開，所以錯誤只在下面標出來、不擋輸入；
 * 存檔前編輯頁會再檢查一次（stateProblem），上游拒收時也照同一組句子講。
 * 每一輪都會把目前的數值整份送進對話，所以骨架下面常駐一行「每一輪大約多送幾個字」，
 * 超過 4 KB 換成提醒的樣子——數值太多會讓每一輪變慢、變貴，作者應該在寫的時候就知道。
 *
 * 面板預覽：皮膚是 Handlebars，渲染器之後由遊玩畫布那邊提供（同一套才會跟對話頁長得一樣），
 * 這裡不自己做一個模板引擎：預覽用遊玩畫布同一份渲染器（PanelPreview）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  STATE_TURN_WARN_BYTES,
  formatJson,
  normalizeState,
  stateLimitParams,
  stateProblem,
  stateTurnSize,
  stateValues,
  type CardStateDraft,
  type StateConvention,
} from "@/lib/card-state";
import { confirmDialog } from "@/lib/confirm";
import examples from "@/locales/card-defaults/state-examples.json";

const props = defineProps<{ modelValue: CardStateDraft; language: string }>();
const emit = defineEmits<{ "update:modelValue": [CardStateDraft] }>();
const { t, locale } = useI18n();

const update = (patch: Partial<CardStateDraft>) => emit("update:modelValue", { ...props.modelValue, ...patch });
const field = <K extends keyof CardStateDraft>(key: K) =>
  computed({ get: () => props.modelValue[key], set: (value: CardStateDraft[K]) => update({ [key]: value } as Partial<CardStateDraft>) });
const dataText = field("dataText");
const rulesText = field("rulesText");
const template = field("template");

const CONVENTIONS: StateConvention[] = ["mvu", "plain"];

/** 骨架解不開時，盡量指出第幾行（各家瀏覽器的錯誤訊息格式不同，拿不到就只講格式有誤）。 */
const parseError = computed(() => {
  const text = props.modelValue.dataText;
  if (!text.trim()) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const line = /line (\d+)/i.exec(message)?.[1];
    const position = /position (\d+)/i.exec(message)?.[1];
    const at = line ? Number(line) : position ? text.slice(0, Number(position)).split("\n").length : 0;
    return at ? t("editor.state.data.errorAt", { line: at }) : t("editor.state.data.error");
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? "" : t("editor.state.data.notObject");
});

/** 解得開之後的其他問題（太大、太深、規則太長…），各標在自己那一格下面。 */
const problem = computed(() => (parseError.value ? null : stateProblem(props.modelValue)));
const problemText = computed(() => (problem.value ? t(`editor.state.reject.${problem.value}`, stateLimitParams()) : ""));
const dataProblem = computed(() => parseError.value || (problem.value && !["rules_text_size", "template_size"].includes(problem.value) ? problemText.value : ""));

const size = computed(() => (parseError.value ? null : stateTurnSize(props.modelValue)));
const sizeWarn = computed(() => (size.value?.bytes ?? 0) > STATE_TURN_WARN_BYTES);
const sizeText = computed(() =>
  size.value ? t(sizeWarn.value ? "editor.state.size.warn" : "editor.state.size", { n: size.value.chars.toLocaleString(String(locale.value)) }) : "",
);

/** 給預覽插槽的值：正規化之後、每一輪實際送出的那份。 */
const values = computed(() => (parseError.value ? null : stateValues(props.modelValue)?.data ?? null));

type ExampleKey = "affection" | "inventory" | "quests";
const EXAMPLES: ExampleKey[] = ["affection", "inventory", "quests"];
type ExampleSet = Record<ExampleKey, Record<string, unknown>>;

/**
 * 插入範例：範例跟著卡片語言（鍵名是那個語言的字）。骨架是空的就直接放；
 * 解得開就把範例的項目併進去（同名的由範例蓋掉）；解不開時先問要不要整份換掉。
 * 範例原本是 MVU 寫法；「只有值」時拿掉規則，空物件在那種寫法裡本來就能新增項目。
 */
async function insertExample(key: ExampleKey) {
  const set = (examples as Record<string, ExampleSet>)[props.language] ?? (examples as Record<string, ExampleSet>).en;
  const example = props.modelValue.convention === "mvu" ? set[key] : normalizeState("mvu", set[key]).data;
  const current = props.modelValue.dataText.trim();
  if (!current) return update({ dataText: formatJson(example) });
  let parsed: unknown;
  try {
    parsed = JSON.parse(current);
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return update({ dataText: formatJson({ ...(parsed as Record<string, unknown>), ...example }) });
  }
  const ok = await confirmDialog({ message: t("editor.state.example.replace"), confirmText: t("editor.state.example.replaceConfirm"), danger: true });
  if (ok) update({ dataText: formatJson(example) });
}
</script>

<template>
  <div class="cstate">
    <div class="field">
      <span id="f-state-convention-label" class="cstate__label">{{ $t("editor.state.convention") }}</span>
      <div class="seg cstate__seg" role="radiogroup" aria-labelledby="f-state-convention-label">
        <button v-for="c in CONVENTIONS" :key="c" type="button" class="seg__item" role="radio"
                :class="{ 'seg__item--on': modelValue.convention === c }" :aria-checked="modelValue.convention === c"
                @click="update({ convention: c })">{{ $t(`editor.state.convention.${c}`) }}</button>
      </div>
      <span class="subtle">{{ $t(`editor.state.convention.${modelValue.convention}.hint`) }}</span>
    </div>

    <div class="field">
      <label for="f-state-data">{{ $t("editor.state.data") }}</label>
      <div class="cstate__examples" role="group" :aria-label="$t('editor.state.examples')">
        <span class="subtle">{{ $t("editor.state.examples") }}</span>
        <button v-for="key in EXAMPLES" :key="key" type="button" class="btn btn--sm" @click="insertExample(key)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {{ $t(`editor.state.example.${key}`) }}
        </button>
      </div>
      <textarea id="f-state-data" v-model="dataText" class="input cstate__code" rows="10" spellcheck="false" autocomplete="off"
                autocapitalize="off" :aria-invalid="dataProblem ? 'true' : undefined"
                :aria-describedby="dataProblem ? 'f-state-data-error' : 'f-state-data-size'" />
      <p v-if="dataProblem" id="f-state-data-error" class="cstate__error" role="alert">{{ dataProblem }}</p>
      <span class="field__foot">
        <span class="subtle">{{ $t("editor.state.data.hint") }}</span>
        <span v-if="sizeText && !sizeWarn" id="f-state-data-size" class="subtle cstate__size" role="status">{{ sizeText }}</span>
      </span>
      <p v-if="sizeText && sizeWarn" id="f-state-data-size" class="cstate__warn" role="status">{{ sizeText }}</p>
    </div>

    <div class="field">
      <label for="f-state-rules">{{ $t("editor.state.rules") }}</label>
      <textarea id="f-state-rules" v-model="rulesText" class="input" rows="5" autocomplete="off"
                :aria-invalid="problem === 'rules_text_size' ? 'true' : undefined" />
      <p v-if="problem === 'rules_text_size'" class="cstate__error" role="alert">{{ problemText }}</p>
      <span class="subtle">{{ $t("editor.state.rules.hint") }}</span>
    </div>

    <div class="field">
      <label for="f-state-template">{{ $t("editor.state.template") }}</label>
      <textarea id="f-state-template" v-model="template" class="input cstate__code" rows="6" spellcheck="false" autocomplete="off"
                autocapitalize="off" :aria-invalid="problem === 'template_size' ? 'true' : undefined" />
      <p v-if="problem === 'template_size'" class="cstate__error" role="alert">{{ problemText }}</p>
      <span class="subtle">{{ $t("editor.state.template.hint") }}</span>
      <PanelPreview :template="modelValue.template" :data="values" />
    </div>
  </div>
</template>

<style scoped>
.cstate__label { font-size: 13px; font-weight: 600; }
/* 最長的是日文「値ごとにルール付き（MVU 形式）」約 240px，兩格在 390 寬手機的版心內放得下；更窄時橫向捲動，不折行（分段控制是固定高度） */
.cstate__seg { justify-self: start; max-width: 100%; overflow-x: auto; }
.cstate__examples { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.cstate__code {
  font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  tab-size: 2;
  white-space: pre;
  overflow-x: auto;
}
.cstate__size { font-variant-numeric: tabular-nums; }
.cstate__error { margin: 0; color: var(--danger); font-size: 13px; line-height: 1.6; }
.cstate__warn {
  margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm);
  background: var(--gold-soft); color: var(--text); font-size: 13px; line-height: 1.6;
}
:lang(ko) .cstate .subtle, :lang(ko) .cstate__warn, :lang(ko) .cstate__error { word-break: keep-all; }
:lang(ja) .cstate .subtle, :lang(ja) .cstate__warn, :lang(ja) .cstate__error { word-break: auto-phrase; }
</style>
