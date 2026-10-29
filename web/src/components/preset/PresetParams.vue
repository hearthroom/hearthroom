<script setup lang="ts">
/**
 * 採樣參數。上下文長度、歷史、記憶與工具不在這裡：那些由綺夢社決定，預設改不到。
 * 篇幅另有滑桿，不歸預設管。
 */
import { computed } from "vue";
import { ADVANCED_PARAMS, BASIC_PARAMS, paramState, type PresetDocument } from "@/lib/st-preset";
import type { CompatibilityField } from "@/lib/presets";
import PresetParamField from "./PresetParamField.vue";

const props = defineProps<{ doc: PresetDocument; fields: CompatibilityField[] }>();
const field = (key: string) => props.fields.find((f) => f.path === key);
const advancedSet = computed(() => ADVANCED_PARAMS.filter((k) => paramState(props.doc, k).adopted).length);
</script>

<template>
  <div class="params">
    <p class="subtle">{{ $t("preset.params.lede") }}</p>
    <div class="params__grid">
      <PresetParamField v-for="key in BASIC_PARAMS" :key="key" :doc="doc" :param="key" :field="field(key)" />
    </div>
    <details class="params__more" :open="advancedSet > 0">
      <summary>{{ $t("preset.params.advanced") }}</summary>
      <div class="params__grid">
        <PresetParamField v-for="key in ADVANCED_PARAMS" :key="key" :doc="doc" :param="key" :field="field(key)" />
      </div>
    </details>
    <p class="subtle">{{ $t("preset.params.managed") }}</p>
  </div>
</template>

<style scoped>
.params { display: grid; gap: var(--s-3); }
.params > p { margin: 0; }
.params__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--s-3); }
.params__more summary { cursor: pointer; min-height: var(--h-md); display: flex; align-items: center; font-weight: 600; }
.params__more .params__grid { margin-top: var(--s-3); }
@media (max-width: 760px) { .params__grid { grid-template-columns: 1fr; } }
</style>
