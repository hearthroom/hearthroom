<script setup lang="ts">
/**
 * 公開一份自己的預設。一屏放得下（owner 2026-10-30）：一句說明、用途與模型清單、
 * 來源／原作者（選填），「公開」鈕與貼著它的聲明小字。不勾選、不另外確認：按下公開就是同意那句聲明，
 * 上游記下當時顯示的聲明版本（declarationVersion）。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/lib/api";
import { legalPage, currentProvider } from "@/lib/provider";
import { presetErrorText, publishPreset, resultUnknown, type PresetPurpose, type PresetSummary, type WriteReceipt } from "@/lib/presets";
import { operationKeys } from "@/lib/use-preset-access";
import PresetSheet from "./PresetSheet.vue";
import PresetModelPicker from "./PresetModelPicker.vue";
import { useModelCatalog } from "./preset-share";

const props = defineProps<{ preset: PresetSummary; declaration: string; token: () => Promise<string> }>();
const emit = defineEmits<{ close: []; done: [receipt: WriteReceipt]; stale: [] }>();
const { t, locale } = useI18n();
const ops = operationKeys();
const catalog = useModelCatalog(props.token);

const ATTRIBUTION_MAX = 200;
const purpose = ref<PresetPurpose | "">(props.preset.purpose || "");
const tested = ref<string[]>([...props.preset.recommendedModels]);
const attribution = ref(props.preset.attribution ?? "");
const busy = ref(false);
const error = ref("");
watch([purpose, tested], () => { error.value = ""; }, { deep: true });

const changedModels = computed(() => tested.value.length !== props.preset.recommendedModels.length || tested.value.some((m, i) => m !== props.preset.recommendedModels[i]));
const termsUrl = computed(() => legalPage(currentProvider(), "terms", locale.value));


async function submit() {
  if (busy.value) return;
  error.value = "";
  if (!purpose.value) { error.value = t("preset.purpose.required"); return; }
  if (purpose.value === "specific" && !tested.value.length) { error.value = t("preset.purpose.models.required"); return; }
  busy.value = true;
  error.value = "";
  const input = {
    purpose: purpose.value, expectedVersion: props.preset.version, declaration: props.declaration, attribution: attribution.value.trim().slice(0, ATTRIBUTION_MAX),
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
    // 版本衝突在這裡不是「存檔」：不用編輯器那句，用公開自己的說法
    else if (err instanceof ApiError && err.reason === "preset_revision_conflict") error.value = t("preset.share.error.conflict");
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

    <fieldset class="publish__field publish__purpose">
      <legend class="publish__label">{{ $t("preset.purpose.label") }}</legend>
      <label v-for="value in (['general', 'specific'] as const)" :key="value" class="publish__choice">
        <input v-model="purpose" type="radio" name="publish-purpose" :value="value" :data-testid="`publish-purpose-${value}`" />
        <span><strong>{{ $t(`preset.purpose.${value}`) }}</strong><span class="publish__hint">{{ $t(`preset.purpose.${value}.hint`) }}</span></span>
      </label>
    </fieldset>
    <div class="publish__field">
      <label for="publish-models" class="publish__label">{{ $t(purpose === 'specific' ? 'preset.purpose.models.specific' : 'preset.purpose.models.general') }}</label>
      <PresetModelPicker v-model="tested" :groups="catalog" input-id="publish-models" :label="$t(purpose === 'specific' ? 'preset.purpose.models.specific' : 'preset.purpose.models.general')" data-testid="publish-models" />
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
/* 韓文在詞中間斷行會剩一個音節掛在下一行：照站上 ConfirmDialog、CoachSpot 的做法整詞換行 */
:lang(ko) .publish__lede, :lang(ko) .publish__hint, :lang(ko) .publish__declaration, :lang(ko) .notice { word-break: keep-all; }
.publish__field { display: grid; gap: var(--s-2); }
.publish__label { font-size: 13px; font-weight: 600; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--s-2); }
.publish__hint { font-weight: 400; color: var(--text-3); font-size: 12px; }
.publish__field .input { width: 100%; height: var(--h-lg); }
.publish__submit { display: grid; gap: var(--s-2); margin-top: var(--s-1); }
.publish__submit .btn { width: 100%; }
.publish__declaration { font-size: 12.5px; line-height: 1.6; }
/* 站上 .link 用 --accent，淺色白底只有 3.5:1；小字裡的連結照 tokens 的規定用 --accent-text */
.publish__declaration a { color: var(--accent-text); padding-block: 8px; }
/* 行內連結的上下 padding 不改行高，只把點擊區撐到約 31px（QA W4：原本 15px） */
</style>

<style scoped>
.publish__purpose { border: 0; margin: 0; padding: 0; }
.publish__purpose legend { margin-bottom: var(--s-2); }
.publish__choice { display: flex; align-items: center; gap: var(--s-2); min-height: var(--h-lg); cursor: pointer; }
.publish__choice > span { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--s-2); }
.publish__choice strong { font-size: 13px; font-weight: 600; }
.publish__choice input { accent-color: var(--accent-btn); }
:lang(ko) .publish__choice { word-break: keep-all; }
</style>
