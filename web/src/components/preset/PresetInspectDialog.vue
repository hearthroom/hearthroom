<script setup lang="ts">
/** 查看位置：每次回覆前內容送出的順序，標出這條落在哪一段。只列分段名稱，不放綺夢社私有的內容。 */
import { useI18n } from "vue-i18n";
import PresetDialog from "./PresetDialog.vue";

// 條目真實的位置（畫面規格 (a)）：角色與玩家設定之前、之後（對話記錄之前），或對話記錄之後
const props = defineProps<{ place: "beforePersona" | "afterPersona" | "after" }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const STEPS = ["beforePersona", "s1", "afterPersona", "s3", "s4", "s5"] as const;
const here = (step: (typeof STEPS)[number]) => step === (props.place === "after" ? "s4" : props.place);
</script>

<template>
  <PresetDialog :title="t('preset.inspect.title')" @close="emit('close')">
    <p class="muted">{{ $t("preset.inspect.lede") }}</p>
    <ol class="inspect">
      <li v-for="step in STEPS" :key="step" :class="{ 'inspect__here': here(step) }" :aria-current="here(step) ? 'step' : undefined">
        <span>{{ $t(`preset.inspect.${step}`) }}</span>
        <strong v-if="here(step)">{{ $t("preset.inspect.here") }}</strong>
      </li>
    </ol>
    <template #actions>
      <button type="button" class="btn" @click="emit('close')">{{ $t("preset.inspect.close") }}</button>
    </template>
  </PresetDialog>
</template>

<style scoped>
.inspect { margin: 0; padding-left: var(--s-5); display: grid; gap: var(--s-2); }
.inspect li { padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); }
.inspect li span { overflow-wrap: anywhere; }
.inspect__here { background: var(--accent-tint); color: var(--accent-text); display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--s-2); }
.inspect__here strong { font-size: 13px; }
</style>
