<script setup lang="ts">
/**
 * 生圖頁的輸入框：一大格描述，左邊「＋」加參考圖，底下一排下拉選技能、模型、參數，右邊生成鍵寫著這次要多少點。
 * 描述開頭打「/」叫出技能清單。送出不鎖輸入框：上一次還在生成時可以接著送下一次，結果都進快取區。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { GenerationModel } from "@/lib/media-generation";
import { SKILLS, fitSize, ratioBox, ratioLabel, type Recipe, type Skill } from "@/lib/studio";

const props = defineProps<{
  models: GenerationModel[];
  uploading?: boolean;
  /** 伺服器開了 Agent 模式（寫計畫的對話模型）才出現模式切換。 */
  agent?: boolean;
  /** 正在排計畫：送出鍵先停住。 */
  planning?: boolean;
}>();
const emit = defineEmits<{
  submit: [input: { model: string; prompt: string; size: string; n: number; images: string[] }, recipe: Recipe];
  /** Agent 模式：一句想法交給頁面去排計畫；model 是目前選的生圖模型（計畫照它的張數上限排）。 */
  plan: [input: { idea: string; references: string[]; model: string }];
  pickLibrary: [];
  upload: [File];
}>();
const { t } = useI18n();

const PROMPT_MAX = 3600;
const mode = ref<"generate" | "agent">("generate");
const text = ref("");
const skill = ref<Skill | null>(null);
const references = ref<string[]>([]);
const usable = computed(() => (references.value.length ? props.models.filter((m) => m.maxReferences > 0) : props.models));
const modelId = ref("");
const model = computed(() => usable.value.find((m) => m.id === modelId.value) ?? usable.value[0]);
const size = ref("");
const count = ref(1);
watch(model, (m, old) => {
  if (!m) return;
  if (!m.sizes.includes(size.value)) size.value = fitSize(m.sizes, skill.value?.shape ?? "square");
  count.value = Math.min(count.value, m.maxImages);
  if (references.value.length > m.maxReferences && old) references.value = references.value.slice(0, m.maxReferences);
}, { immediate: true });
const cost = computed(() => (model.value ? model.value.credits * count.value : 0));
const canSubmit = computed(() =>
  mode.value === "agent"
    ? !!model.value && !!text.value.trim() && !props.planning
    : !!model.value && !!size.value && (!!text.value.trim() || !!skill.value) && !text.value.startsWith("/"),
);

const modelLabel = (m: GenerationModel) => (m.laneName ? `${m.name} · ${m.laneName}` : m.name);
const priceLabel = (m: GenerationModel) => t(m.priced > 1 ? "studio.model.priceFrom" : "studio.model.price", { n: m.credits });

// 下拉：同一時間只開一個；點外面或按 Esc 收起
type Menu = "add" | "mode" | "skill" | "model" | "params";
const menu = ref<Menu | null>(null);
const root = ref<HTMLElement | null>(null);
const field = ref<HTMLTextAreaElement | null>(null);
const file = ref<HTMLInputElement | null>(null);
const toggle = (m: Menu) => (menu.value = menu.value === m ? null : m);
const onPointer = (e: PointerEvent) => {
  if (menu.value && !root.value?.contains(e.target as Node)) menu.value = null;
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape" && menu.value) {
    menu.value = null;
    field.value?.focus();
  }
};
onMounted(() => {
  document.addEventListener("pointerdown", onPointer);
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointer);
  document.removeEventListener("keydown", onKey);
});

// 描述開頭打「/」：列出技能，後面的字拿來篩
const slash = computed(() => (mode.value === "generate" && text.value.startsWith("/") ? text.value.slice(1).trim().toLowerCase() : null));
const skills = computed(() => {
  const q = slash.value ?? "";
  return SKILLS.filter((s) => !q || t(`studio.skill.${s.id}.name`).toLowerCase().includes(q));
});
watch(slash, (q) => {
  if (q !== null) menu.value = "skill";
  else if (menu.value === "skill" && !skillFromButton) menu.value = null;
});
let skillFromButton = false;
function openSkills() {
  skillFromButton = menu.value !== "skill";
  toggle("skill");
}
function useSkill(s: Skill) {
  skill.value = s;
  if (slash.value !== null) text.value = "";
  menu.value = null;
  skillFromButton = false;
  if (model.value) {
    size.value = fitSize(model.value.sizes, s.shape);
    count.value = s.count === "max" ? model.value.maxImages : 1;
  }
  void nextTick(() => field.value?.focus());
}

function addReference(url: string) {
  if (!url || references.value.includes(url)) return;
  const cap = Math.max(...props.models.map((m) => m.maxReferences), 0);
  if (references.value.length >= cap) references.value = references.value.slice(1);
  references.value = [...references.value, url];
  // 現在的模型不收參考圖（或收不下這麼多）：換到最便宜的那個收得下的
  if (!model.value || model.value.maxReferences < references.value.length) {
    modelId.value = props.models.find((m) => m.maxReferences >= references.value.length)?.id ?? modelId.value;
  }
}
function chooseFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  menu.value = null;
  if (f) emit("upload", f);
}

function submit() {
  if (!canSubmit.value || !model.value) return;
  if (mode.value === "agent") {
    emit("plan", { idea: text.value.trim(), references: [...references.value], model: model.value.id });
    return;
  }
  const words = text.value.trim();
  const scaffold = skill.value ? t(`studio.skill.${skill.value.id}.prompt`) : "";
  const prompt = [scaffold, words].filter(Boolean).join("\n").slice(0, 4000);
  emit(
    "submit",
    { model: model.value.id, prompt, size: size.value, n: count.value, images: [...references.value] },
    { prompt: words, ...(skill.value ? { skill: skill.value.id } : {}), ...(references.value.length ? { references: [...references.value] } : {}) },
  );
}
function onEnter(e: KeyboardEvent) {
  // Enter 送出、Shift+Enter 換行；選字中的 Enter 是輸入法的，不算
  if (e.shiftKey || e.isComposing) return;
  e.preventDefault();
  if (menu.value === "skill" && skills.value[0]) useSkill(skills.value[0]);
  else submit();
}

/** 「再生成一次」：照上一次的描述、技能、參考圖、模型與尺寸回填。 */
function fill(recipe: Recipe, task: { model?: string; size?: string; n?: number }) {
  mode.value = "generate";
  text.value = recipe.prompt;
  skill.value = SKILLS.find((s) => s.id === recipe.skill) ?? null;
  references.value = recipe.references ?? [];
  if (task.model && props.models.some((m) => m.id === task.model)) modelId.value = task.model;
  void nextTick(() => {
    if (task.size && model.value?.sizes.includes(task.size)) size.value = task.size;
    if (task.n && model.value) count.value = Math.min(task.n, model.value.maxImages);
    field.value?.focus();
  });
}
/** 計畫送出去了：清掉輸入框，下一次從空白開始。 */
function clear() {
  text.value = "";
}
defineExpose({ fill, addReference, clear, focus: () => field.value?.focus() });
</script>

<template>
  <form ref="root" class="composer panel" @submit.prevent="submit">
    <div class="composer__top">
      <div class="composer__refs">
        <button type="button" class="composer__add" :aria-label="$t('studio.ref.add')" :aria-expanded="menu === 'add'" :disabled="uploading" @click="toggle('add')">
          <span v-if="uploading" class="spinner" aria-hidden="true" />
          <svg v-else viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
        </button>
        <div v-if="menu === 'add'" class="pop pop--add" role="menu">
          <button type="button" role="menuitem" class="pop__item" @click="menu = null; emit('pickLibrary')">{{ $t("studio.ref.library") }}</button>
          <button type="button" role="menuitem" class="pop__item" @click="file?.click()">{{ $t("studio.ref.upload") }}</button>
          <p class="pop__note subtle">{{ $t("studio.ref.note") }}</p>
        </div>
        <input ref="file" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="chooseFile" />
        <span v-for="(u, i) in references" :key="u" class="composer__ref">
          <img :src="u" alt="" />
          <button type="button" class="composer__ref-x" :aria-label="$t('studio.ref.remove', { n: i + 1 })" @click="references = references.filter((r) => r !== u)">×</button>
        </span>
      </div>
      <div class="composer__text">
        <span v-if="skill && mode === 'generate'" class="composer__skill">
          / {{ $t(`studio.skill.${skill.id}.name`) }}
          <button type="button" :aria-label="$t('studio.skill.clear')" @click="skill = null">×</button>
        </span>
        <textarea
          ref="field"
          v-model="text"
          class="composer__input"
          autocomplete="off"
          rows="3"
          :maxlength="PROMPT_MAX"
          :aria-label="$t('studio.prompt.label')"
          :placeholder="mode === 'agent' ? $t('studio.agent.hint') : skill ? $t(`studio.skill.${skill.id}.hint`) : $t('studio.prompt.hint')"
          @keydown.enter="onEnter"
        />
        <p v-if="mode === 'agent'" class="composer__tip subtle">{{ $t("studio.agent.note") }}</p>
        <p v-else-if="skill?.wantsReference && !references.length" class="composer__tip subtle">{{ $t("studio.skill.wantsReference") }}</p>
      </div>
    </div>

    <div class="composer__bar">
      <div class="composer__chips">
        <div v-if="agent" class="anchor">
          <button type="button" class="pill" :class="{ 'pill--on': mode === 'agent' }" :aria-expanded="menu === 'mode'" @click="toggle('mode')">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.5 5.5l1.4 1.4M13.1 13.1l1.4 1.4M5.5 14.5l1.4-1.4M13.1 6.9l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /><circle cx="10" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
            {{ $t(mode === "agent" ? "studio.mode.agent" : "studio.mode.generate") }}
          </button>
          <div v-if="menu === 'mode'" class="pop pop--wide" role="listbox" :aria-label="$t('studio.mode.label')">
            <button v-for="m in ['generate', 'agent'] as const" :key="m" type="button" role="option" class="pop__row" :aria-selected="mode === m" @click="mode = m; menu = null">
              <strong>{{ $t(`studio.mode.${m}`) }}</strong>
              <span class="subtle">{{ $t(`studio.mode.${m}Desc`) }}</span>
            </button>
          </div>
        </div>
        <div v-if="mode === 'generate'" class="anchor">
          <button type="button" class="pill" :class="{ 'pill--on': skill }" :aria-expanded="menu === 'skill'" @click="openSkills">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 15 8-10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
            {{ skill ? $t(`studio.skill.${skill.id}.name`) : $t("studio.skill.label") }}
          </button>
          <div v-if="menu === 'skill'" class="pop pop--wide" role="listbox" :aria-label="$t('studio.skill.label')">
            <button v-for="s in skills" :key="s.id" type="button" role="option" class="pop__row" :aria-selected="skill?.id === s.id" @click="useSkill(s)">
              <strong>{{ $t(`studio.skill.${s.id}.name`) }}</strong>
              <span class="subtle">{{ $t(`studio.skill.${s.id}.desc`) }}</span>
            </button>
            <p v-if="!skills.length" class="pop__note subtle">{{ $t("studio.skill.none") }}</p>
          </div>
        </div>
        <div class="anchor">
          <button type="button" class="pill" :aria-expanded="menu === 'model'" :disabled="!usable.length" @click="toggle('model')">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 3 6 3.5v7L10 17l-6-3.5v-7L10 3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
            {{ model ? modelLabel(model) : $t("studio.model.label") }}
          </button>
          <div v-if="menu === 'model'" class="pop pop--wide" role="listbox" :aria-label="$t('studio.model.label')">
            <button v-for="m in usable" :key="m.id" type="button" role="option" class="pop__row" :aria-selected="m.id === model?.id" @click="modelId = m.id; menu = null">
              <strong>{{ modelLabel(m) }}</strong>
              <span class="subtle">
                {{ priceLabel(m) }} · {{ $t("studio.model.max", { n: m.maxImages }) }}<template v-if="m.maxReferences"> · {{ $t("studio.model.refs", { n: m.maxReferences }) }}</template>
              </span>
            </button>
          </div>
        </div>
        <div v-if="mode === 'generate'" class="anchor">
          <button type="button" class="pill" :aria-expanded="menu === 'params'" :disabled="!model" @click="toggle('params')">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h7m4 0h1M4 14h1m4 0h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /><circle cx="13" cy="6" r="2" fill="none" stroke="currentColor" stroke-width="1.5" /><circle cx="7" cy="14" r="2" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
            {{ ratioLabel(size) }} · {{ $t("studio.params.countShort", { n: count }) }}
          </button>
          <div v-if="menu === 'params' && model" class="pop pop--params">
            <p class="pop__title">{{ $t("studio.params.ratio") }}</p>
            <div class="ratios" role="radiogroup" :aria-label="$t('studio.params.ratio')">
              <button v-for="s in model.sizes" :key="s" type="button" role="radio" class="ratio" :aria-checked="s === size" @click="size = s">
                <span class="ratio__box" :style="{ width: ratioBox(s).w + 'px', height: ratioBox(s).h + 'px' }" aria-hidden="true" />
                <span>{{ ratioLabel(s) }}</span>
                <span class="ratio__px">{{ s.replace("x", "×") }}</span>
              </button>
            </div>
            <p class="pop__title">{{ $t("studio.params.count") }}</p>
            <div class="seg-row" role="radiogroup" :aria-label="$t('studio.params.count')">
              <button v-for="n in model.maxImages" :key="n" type="button" role="radio" class="seg-btn" :aria-checked="n === count" @click="count = n">{{ n }}</button>
            </div>
          </div>
        </div>
      </div>
      <button type="submit" class="btn btn--primary composer__go" :disabled="!canSubmit">
        {{ mode === "agent" ? $t(planning ? "studio.agent.planning" : "studio.agent.submit") : $t(model && model.priced > 1 ? "studio.submitFrom" : "studio.submit", { n: cost }) }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.composer { position: relative; display: grid; gap: var(--s-3); padding: var(--s-4); border-radius: var(--r-lg); }
.composer__top { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--s-3); align-items: start; }
.composer__refs { position: relative; display: flex; flex-direction: column; gap: var(--s-2); }
.composer__add {
  display: grid; place-items: center; width: 64px; height: 64px; border-radius: var(--r-md);
  border: 1px dashed var(--line-strong); background: var(--surface-2); color: var(--text-2); cursor: pointer;
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}
.composer__add:hover, .composer__add:focus-visible { border-color: var(--accent); color: var(--accent-text); outline: none; }
.composer__add svg { width: 22px; height: 22px; }
.composer__ref { position: relative; width: 64px; height: 64px; }
.composer__ref img { width: 100%; height: 100%; object-fit: cover; border-radius: var(--r-md); border: 1px solid var(--line); }
.composer__ref-x {
  position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; border-radius: 50%; border: 0;
  background: var(--text); color: var(--surface); font-size: 14px; line-height: 22px; cursor: pointer;
}
.composer__text { display: grid; gap: var(--s-2); min-width: 0; }
.composer__skill {
  justify-self: start; display: inline-flex; align-items: center; gap: var(--s-1); padding: 2px 4px 2px 10px;
  border-radius: var(--r-pill); background: var(--accent-soft); color: var(--accent-text); font-size: 13px; font-weight: 600;
}
.composer__skill button { border: 0; background: none; color: inherit; font-size: 15px; width: 22px; height: 22px; cursor: pointer; }
.composer__input {
  width: 100%; min-height: 84px; resize: vertical; border: 0; background: transparent; color: var(--text);
  font: inherit; font-size: 15px; line-height: 1.6; padding: 0;
}
.composer__input:focus { outline: none; }
.composer__input::placeholder { color: var(--text-3); }
.composer__tip { margin: 0; }
.composer__bar { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; }
.composer__chips { display: flex; gap: var(--s-2); flex-wrap: wrap; flex: 1 1 auto; min-width: 0; }
.composer__go { flex: none; min-width: 120px; }
.anchor { position: relative; min-width: 0; }
.pill {
  display: inline-flex; align-items: center; gap: 6px; height: var(--h-md); max-width: 100%; padding: 0 var(--s-3);
  border-radius: var(--r-md); border: 1px solid var(--line-strong); background: var(--surface); color: var(--text);
  font-size: 13.5px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pill:hover:not(:disabled), .pill[aria-expanded="true"] { background: var(--surface-2); }
.pill:disabled { opacity: 0.5; cursor: not-allowed; }
.pill--on { border-color: var(--accent); color: var(--accent-text); }
.pill svg { width: 16px; height: 16px; flex: none; }
.pop {
  position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; min-width: 220px; padding: var(--s-2);
  background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--r-md); box-shadow: var(--shadow-md);
  display: grid; gap: 2px;
}
.pop--add { top: 0; left: calc(100% + 8px); }
.pop--wide { width: min(360px, calc(100vw - 32px)); max-height: 360px; overflow-y: auto; }
.pop--params { width: min(380px, calc(100vw - 32px)); gap: var(--s-2); padding: var(--s-3); }
.pop__item, .pop__row {
  display: grid; gap: 2px; text-align: left; padding: var(--s-2) var(--s-3); border: 0; border-radius: var(--r-sm);
  background: none; color: var(--text); font: inherit; font-size: 14px; cursor: pointer;
}
.pop__row strong { font-weight: 600; }
.pop__row .subtle { font-size: 12.5px; }
.pop__item:hover, .pop__row:hover, .pop__row:focus-visible, .pop__item:focus-visible { background: var(--surface-2); outline: none; }
.pop__row[aria-selected="true"] { background: var(--accent-soft); }
.pop__note { margin: var(--s-1) var(--s-3); }
.pop__title { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--text-2); }
.ratios { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: var(--s-2); }
.ratio {
  display: grid; justify-items: center; gap: 4px; padding: var(--s-2) var(--s-1); border-radius: var(--r-sm);
  border: 1px solid var(--line); background: var(--surface-2); color: var(--text); font-size: 13px; cursor: pointer;
}
.ratio[aria-checked="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-text); }
.ratio__box { display: block; border: 1.5px solid currentColor; border-radius: 3px; margin: 3px 0; }
.ratio__px { font-size: 11px; color: var(--text-3); }
.seg-row { display: flex; gap: var(--s-2); }
.seg-btn {
  flex: 1; height: var(--h-sm); border-radius: var(--r-sm); border: 1px solid var(--line); background: var(--surface-2);
  color: var(--text); font: inherit; font-size: 14px; cursor: pointer;
}
.seg-btn[aria-checked="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-text); font-weight: 600; }
.spinner {
  width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .composer { padding: var(--s-3); }
  .composer__add, .composer__ref { width: 52px; height: 52px; }
  .composer__go { flex: 1 1 100%; }
  .pop--add { left: 0; top: calc(100% + 6px); }
  .pop--wide, .pop--params { position: fixed; left: 16px; right: 16px; top: auto; bottom: 16px; width: auto; max-height: 60vh; }
}
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
