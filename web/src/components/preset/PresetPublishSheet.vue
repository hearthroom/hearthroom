<script setup lang="ts">
/**
 * 公開一份自己的預設。一屏放得下（owner 2026-10-30）：一句說明、測試過的模型（選填，留空＝通用）、
 * 來源／原作者（選填），「公開」鈕與貼著它的聲明小字。不勾選、不另外確認：按下公開就是同意那句聲明，
 * 上游記下當時顯示的聲明版本（declarationVersion）。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/lib/api";
import { legalPage, currentProvider } from "@/lib/provider";
import { presetErrorText, publishPreset, resultUnknown, type PresetSummary, type WriteReceipt } from "@/lib/presets";
import { operationKeys } from "@/lib/use-preset-access";
import PresetSheet from "./PresetSheet.vue";
import { modelLabel, useModelOptions } from "./preset-share";

const props = defineProps<{ preset: PresetSummary; declaration: string; token: () => Promise<string> }>();
const emit = defineEmits<{ close: []; done: [receipt: WriteReceipt]; stale: [] }>();
const { t, locale } = useI18n();
const ops = operationKeys();
const options = useModelOptions(props.token);

const ATTRIBUTION_MAX = 200;
const tested = ref<string[]>([...props.preset.recommendedModels]);
const attribution = ref(props.preset.attribution ?? "");
const busy = ref(false);
const error = ref("");

const others = computed(() => options.value.filter((o) => !tested.value.includes(o.value)));
const changedModels = computed(() => tested.value.length !== props.preset.recommendedModels.length || tested.value.some((m, i) => m !== props.preset.recommendedModels[i]));
const termsUrl = computed(() => legalPage(currentProvider(), "terms", locale.value));

function addModel(e: Event) {
  const el = e.target as HTMLSelectElement;
  if (el.value && !tested.value.includes(el.value)) tested.value = [...tested.value, el.value];
  el.value = "";
}
const removeModel = (code: string) => { tested.value = tested.value.filter((m) => m !== code); };

async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const input = {
    expectedVersion: props.preset.version, declaration: props.declaration, attribution: attribution.value.trim().slice(0, ATTRIBUTION_MAX),
    ...(changedModels.value ? { recommendedModels: tested.value } : {}),
  };
  const action = `publish:${props.preset.id}:${JSON.stringify(input)}`;
  try {
    const receipt = await publishPreset(await props.token(), props.preset.id, input, ops.key(action));
    ops.done(action);
    emit("done", receipt);
  } catch (err) {
    if (!resultUnknown(err)) ops.done(action);
    if (resultUnknown(err)) error.value = t("preset.error.unknown");
    else error.value = (err instanceof ApiError && presetErrorText(err)) || t("preset.share.error.publish");
    // 聲明換版或別處先改了：清單要重讀，下一次按才會送新的版本與聲明
    if (err instanceof ApiError && err.code === "preset_conflict") emit("stale");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PresetSheet :title="t('preset.share.publish.title', { name: preset.title })" testid="publish-sheet" @close="emit('close')">
    <p class="publish__lede">{{ $t("preset.share.publish.lede") }}</p>

    <div class="publish__field" role="group" aria-labelledby="publish-tested">
      <p id="publish-tested" class="publish__label">{{ $t("preset.share.publish.tested.label") }}<span class="publish__hint">{{ $t("preset.share.publish.tested.hint") }}</span></p>
      <div class="publish__models">
        <button
          v-for="code in tested" :key="code" type="button" class="publish__model publish__model--on" aria-pressed="true"
          data-testid="publish-model" @click="removeModel(code)"
        >{{ modelLabel(code) }}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg></button>
        <span v-if="others.length" class="publish__selectWrap">
          <select class="publish__model publish__select" value="" :aria-label="$t('preset.share.publish.tested.label')" data-testid="publish-model-add" @change="addModel">
            <option value="" disabled>{{ $t("preset.share.filter.pickModel") }}</option>
            <option v-for="m in others" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </span>
      </div>
    </div>

    <label class="publish__field">
      <span class="publish__label">{{ $t("preset.share.publish.source.label") }}</span>
      <input v-model="attribution" autocomplete="off" class="input" :maxlength="ATTRIBUTION_MAX" :placeholder="$t('preset.share.publish.source.placeholder')" data-testid="publish-source" />
    </label>

    <p v-if="error" class="notice notice--error" role="alert" data-testid="publish-error">{{ error }}</p>

    <div class="publish__submit">
      <button type="button" class="btn btn--primary btn--lg" :disabled="busy || !declaration" data-testid="publish-confirm" @click="submit">{{ $t("preset.share.publish.submit") }}</button>
      <i18n-t keypath="preset.publish.declaration" tag="p" class="subtle publish__declaration" scope="global" data-testid="publish-declaration">
        <template #terms><a class="link" :href="termsUrl" target="_blank" rel="noopener">{{ $t("login.terms") }}</a></template>
      </i18n-t>
    </div>
  </PresetSheet>
</template>

<style scoped>
.publish__lede { font-size: 13.5px; line-height: 1.6; color: var(--text-2); }
.publish__field { display: grid; gap: var(--s-2); }
.publish__label { font-size: 13px; font-weight: 600; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--s-2); }
.publish__hint { font-weight: 400; color: var(--text-3); font-size: 12px; }
/* 模型很多也不撐高彈層：超過三排就在這一格裡捲 */
.publish__models { display: flex; flex-wrap: wrap; gap: var(--s-2); max-height: 128px; overflow-y: auto; }
.publish__model {
  display: inline-flex; align-items: center; gap: 6px; min-height: var(--h-md); padding: 0 var(--s-3) 0 14px;
  border-radius: var(--r-pill); border: 1px solid var(--border-strong); background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; overflow-wrap: anywhere; text-align: left;
}
.publish__model:hover { background: var(--surface-2); }
.publish__model--on, .publish__model--on:hover { background: var(--accent-tint); border-color: transparent; color: var(--accent-text); }
/* 還沒選的提示字：看起來是提示，不像已選的 chip */
.publish__select { height: var(--h-md); width: 100%; padding-right: var(--s-7); appearance: none; -webkit-appearance: none; color: var(--text-2); font-weight: 400; text-overflow: ellipsis; }
/* 箭頭由外框畫，跟公開分頁的模型下拉、搜尋頁同一個細線折角 */
.publish__selectWrap { position: relative; display: inline-flex; max-width: 100%; color: var(--text-3); }
.publish__selectWrap::after {
  content: ""; position: absolute; inset-inline-end: var(--s-4); top: 50%;
  width: 6px; height: 6px; border-inline-end: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: translateY(-70%) rotate(45deg); pointer-events: none;
}
@supports (appearance: base-select) {
  @media (hover: hover) and (pointer: fine) {
    .publish__select { appearance: base-select; }
    .publish__select::picker-icon { display: none; }
  }
}
.publish__field .input { width: 100%; height: var(--h-lg); }
.publish__submit { display: grid; gap: var(--s-2); margin-top: var(--s-1); }
.publish__submit .btn { width: 100%; }
.publish__declaration { font-size: 12.5px; line-height: 1.6; }
/* 站上 .link 用 --accent，淺色白底只有 3.5:1；小字裡的連結照 tokens 的規定用 --accent-text */
.publish__declaration a { color: var(--accent-text); padding-block: 8px; }
/* 行內連結的上下 padding 不改行高，只把點擊區撐到約 31px（QA W4：原本 15px） */
</style>
