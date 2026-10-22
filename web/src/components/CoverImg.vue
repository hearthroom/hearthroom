<script setup lang="ts">
/**
 * 卡片封面的小圖（首頁面板、對話紀錄）：跟卡片清單同一條退路——
 * 會動的縮圖 → 靜態縮圖（動圖太大轉不了動的）→ 原圖 → 空框。
 * 不直接載原圖：封面常是好幾 MB 的動圖，塞進 32 px 的框也是全尺寸逐格解碼，整塊會閃。
 * class、loading 這些照樣傳到 <img>；全掛了換成同 class 的空 <span>，佔位樣式照用。
 */
import { computed, ref, watch } from "vue";
import { thumbChain } from "@/lib/card-thumb";

const props = defineProps<{ src: string }>();
const urls = computed(() => thumbChain(props.src));
const step = ref(0);
watch(() => props.src, () => { step.value = 0; });
</script>

<template>
  <img v-if="step < urls.length" :key="urls[step]" :src="urls[step]" alt="" @error="step += 1" />
  <span v-else />
</template>
