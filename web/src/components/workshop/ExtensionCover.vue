<script setup lang="ts">
/**
 * 擴充的橫式背景圖（16:9）。沒有圖（草稿）或圖載不了時，用名稱算出的色相畫底色加首字，跟卡片的佔位同一套。
 * 分級高於原卡時右上角疊「R」方塊（同卡片格），讀屏名「限制級」。square：管理列等小縮圖，從橫圖置中裁成方形。
 */
import { computed, ref, watch } from "vue";
import { hueFrom } from "@/lib/format";

const props = defineProps<{ src: string; name: string; adult?: boolean; square?: boolean }>();
const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });
const hue = computed(() => hueFrom(props.name || "?"));
const initial = computed(() => [...(props.name || "?")][0]);
</script>

<template>
  <div class="ext-cover" :class="{ 'ext-cover--square': square }">
    <img v-if="src && !failed" :src="src" alt="" loading="lazy" @error="failed = true" />
    <div v-else class="ext-cover__void" :style="{ background: `linear-gradient(140deg, hsl(${hue} 45% 74%), hsl(${(hue + 40) % 360} 40% 58%))` }" aria-hidden="true"><span>{{ initial }}</span></div>
    <span v-if="adult" class="ext-cover__r" role="img" :aria-label="$t('workshop.badge.adult')">R</span>
  </div>
</template>

<style scoped>
.ext-cover { position: relative; aspect-ratio: 16 / 9; overflow: hidden; background: var(--surface-2); container-type: inline-size; }
.ext-cover--square { aspect-ratio: 1; }
.ext-cover img, .ext-cover__void { width: 100%; height: 100%; object-fit: cover; object-position: center; }
.ext-cover__void { display: flex; align-items: flex-end; justify-content: flex-end; padding: 4cqi 6cqi; }
.ext-cover__void span { font-size: 28cqi; font-weight: 700; line-height: 1; color: rgba(255, 255, 255, 0.42); }
.ext-cover--square .ext-cover__void { align-items: center; justify-content: center; padding: 0; }
.ext-cover--square .ext-cover__void span { font-size: 48cqi; color: rgba(255, 255, 255, 0.9); }
.ext-cover__r {
  position: absolute; top: 8px; right: 8px; display: grid; place-items: center; width: 24px; height: 24px;
  border-radius: var(--r-sm); background: var(--danger); color: var(--on-danger); font-size: 12px; font-weight: 800;
}
.ext-cover--square .ext-cover__r { display: none; }
</style>
