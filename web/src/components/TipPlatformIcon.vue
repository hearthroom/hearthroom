<script setup lang="ts">
import { computed } from "vue";
import type { TipPlatformId } from "../../../shared/tip-links";
import { TIP_ICONS } from "@/lib/tip-icons";

const props = defineProps<{ platform: TipPlatformId }>();
const icon = computed(() => TIP_ICONS[props.platform]);
</script>

<template>
  <img v-if="icon.kind === 'img'" class="tip-icon" :src="icon.src" alt="" aria-hidden="true" />
  <span v-else class="tip-icon tip-icon--svg" :style="{ background: icon.bg, color: icon.fg }" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path :d="icon.path" fill="currentColor" /></svg>
  </span>
</template>

<style scoped>
/* 大小由用的地方給（width/height）；圖示本身只負責裁圓與置中 */
.tip-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; border-radius: var(--r-pill); object-fit: cover; box-shadow: 0 0 0 1px var(--line); }
.tip-icon--svg svg { width: 56%; height: 56%; }
</style>
