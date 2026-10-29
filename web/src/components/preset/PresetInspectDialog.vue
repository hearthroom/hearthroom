<script setup lang="ts">
/** 查看位置：每次回覆前內容送出的順序，標出這條落在哪一段。只列分段名稱，不放綺夢社私有的內容。 */
import { useI18n } from "vue-i18n";
import PresetDialog from "./PresetDialog.vue";

const props = defineProps<{ side: "before" | "after" }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const here = (n: number) => (props.side === "before" ? n === 2 : n === 4);
</script>

<template>
  <PresetDialog :title="t('preset.inspect.title')" @close="emit('close')">
    <p class="muted">{{ $t("preset.inspect.lede") }}</p>
    <ol class="inspect">
      <li v-for="n in 5" :key="n" :class="{ 'inspect__here': here(n) }" :aria-current="here(n) ? 'step' : undefined">
        <span>{{ $t(`preset.inspect.s${n}`) }}</span>
        <strong v-if="here(n)">{{ $t("preset.inspect.here") }}</strong>
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
