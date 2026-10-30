<script setup lang="ts">
/** 一項採樣參數：沿用模型設定（值留著，匯出回酒館時還在），或自訂一個值。 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { clearParam, paramState, setParamAdopted, setParamValue, type ParamKey, type PresetDocument } from "@/lib/st-preset";
import type { CompatibilityField } from "@/lib/presets";
import { PARAM_CHOICES, PARAM_RANGE, fieldReason, paramInvalid, paramLabelKey } from "./preset-params";

const props = defineProps<{ doc: PresetDocument; param: ParamKey; field?: CompatibilityField; native?: boolean }>();
const { t, te } = useI18n();

const state = computed(() => paramState(props.doc, props.param));
const range = computed(() => PARAM_RANGE[props.param]);
const choices = computed(() => PARAM_CHOICES[props.param]);
const invalid = computed(() => paramInvalid(props.doc, props.param));
const label = computed(() => t(paramLabelKey(props.param)));
const reasons = computed(() => (props.field?.reasonCodes ?? []).map((c) => fieldReason(c, props.field?.uiStatus, label.value, t, te)).filter(Boolean));
// 溫度偏高只提示一句（owner 2026-10-30）：不擋存檔、不改值；套用與遊玩畫面都不提
const temperatureHigh = computed(() => props.param === "temperature" && state.value.adopted && !invalid.value && Number(state.value.value) > 1.5);
const id = `param-${props.param}`;

function mode(custom: boolean) {
  if (custom && state.value.value === undefined) setParamValue(props.doc, props.param, choices.value?.[1] ?? (props.param === "temperature" ? 1 : range.value?.min ?? 0));
  // 本站寫的預設沒有來源檔要保留：改回沿用模型就把值拿掉（留著的值上游一樣會查範圍）
  else if (!custom && props.native) clearParam(props.doc, props.param);
  else setParamAdopted(props.doc, props.param, custom);
}
function setNumber(raw: string) {
  const n = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(n)) setParamValue(props.doc, props.param, n);
}
</script>

<template>
  <div class="param" :data-testid="`param-${param}`">
    <label :for="id" class="param__label">{{ label }}</label>
    <div class="param__controls">
      <select :id="id" class="input" :value="state.adopted ? 'custom' : 'model'" @change="mode(($event.target as HTMLSelectElement).value === 'custom')">
        <option value="model">{{ $t("preset.params.useModel") }}</option>
        <option value="custom">{{ $t("preset.params.custom") }}</option>
      </select>
      <template v-if="state.adopted">
        <select v-if="choices" class="input" :aria-label="label" :value="state.value" @change="setParamValue(doc, param, ($event.target as HTMLSelectElement).value)">
          <option v-for="c in choices" :key="c" :value="c">{{ $t(`preset.params.level.${c}`) }}</option>
        </select>
        <input v-else type="number" class="input" :aria-label="label" :min="range?.min" :max="range?.max" :step="range?.step" :value="state.value" :aria-invalid="invalid || undefined" @input="setNumber(($event.target as HTMLInputElement).value)" />
      </template>
    </div>
    <p v-if="invalid" class="param__error">{{ $t("preset.params.rangeError", { param: label }) }}</p>
    <p v-if="temperatureHigh" class="param__note" data-testid="param-temperature-high">{{ $t("preset.params.temperature.high") }}</p>
    <p v-for="text in state.adopted ? reasons : []" :key="text" class="param__note">{{ text }}</p>
  </div>
</template>

<style scoped>
.param { display: grid; gap: var(--s-1); align-content: start; }
.param__label { font-size: 13px; font-weight: 600; }
.param { min-width: 0; }
.param__controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--s-2); }
.param__controls .input { min-width: 0; }
.param__controls > :only-child { grid-column: 1 / -1; }
.param__error { margin: 0; font-size: 12px; color: var(--danger); overflow-wrap: anywhere; }
.param__note { margin: 0; font-size: 12px; color: var(--text-2); overflow-wrap: anywhere; }
</style>
