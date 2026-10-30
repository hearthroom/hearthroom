<script setup lang="ts">
/**
 * 查看位置：每次回覆前內容照真實順序送出，列出綺夢社帶入的每一份材料與這條條目落在哪裡。
 * 只列材料的名稱與一句說明，不放綺夢社私有的內容；其他自訂條目不列。
 */
import { nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { InspectRow } from "@/lib/st-preset";
import PresetDialog from "./PresetDialog.vue";

defineProps<{ rows: InspectRow[]; name: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const list = ref<HTMLElement | null>(null);
// 清單長的時候（手機），開窗就把「這條在這裡」捲進畫面
onMounted(() => void nextTick(() => list.value?.querySelector(".inspect__here")?.scrollIntoView?.({ block: "nearest" })));
</script>

<template>
  <PresetDialog :title="t('preset.inspect.title')" @close="emit('close')">
    <p class="muted">{{ $t("preset.inspect.lede") }}</p>
    <ol ref="list" class="inspect" data-testid="inspect-rows">
      <li v-for="(row, i) in rows" :key="`${row}:${i}`" :class="{ 'inspect__here': row === 'here' }" :aria-current="row === 'here' ? 'step' : undefined" :data-row="row">
        <template v-if="row === 'here'">
          <span>{{ name }}</span>
          <strong>{{ $t("preset.inspect.here") }}</strong>
        </template>
        <span v-else-if="row === 'history'">{{ $t("preset.inspect.s3") }}</span>
        <span v-else-if="row === 'format'">{{ $t("preset.inspect.s5") }}</span>
        <template v-else>
          <span class="inspect__name">{{ $t(`preset.provided.${row}`) }}</span>
          <span class="inspect__note">{{ $t(`preset.inspect.${row}.note`) }}</span>
        </template>
      </li>
    </ol>
    <template #actions>
      <button type="button" class="btn" @click="emit('close')">{{ $t("preset.inspect.close") }}</button>
    </template>
  </PresetDialog>
</template>

<style scoped>
.inspect { margin: 0; padding-left: var(--s-5); display: grid; gap: var(--s-2); }
.inspect li { padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); display: grid; gap: 2px; }
.inspect li span { overflow-wrap: anywhere; }
.inspect__name { font-weight: 600; }
.inspect__note { font-size: 13px; color: var(--text-2); }
.inspect__here { background: var(--accent-tint); color: var(--accent-text); display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--s-2); }
.inspect__here strong { font-size: 13px; }
</style>
