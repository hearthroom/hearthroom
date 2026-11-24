<script setup lang="ts">
/**
 * 誰看得到這一塊（ui-two-stage.md「揭曉區分欄」）：鎖頭＋「只有審核員看得到」、眼睛＋「作者會看到」。
 * 文字是主要標示，圖示只是輔助，不單靠顏色或圖示分辨。
 */
import { useI18n } from "vue-i18n";
import AccountIcon from "./AccountIcon.vue";

defineProps<{ who: "reviewers" | "author" }>();
const { t } = useI18n();
</script>

<template>
  <span class="vis" :class="`vis--${who}`" :data-visibility="who">
    <AccountIcon :name="who === 'author' ? 'eye' : 'lock'" class="vis__icon" />
    <span class="vis__text">{{ t(who === "author" ? "reviewAi.two.visibility.authorSees" : "reviewAi.two.visibility.reviewerOnly") }}</span>
  </span>
</template>

<style scoped>
.vis { display: inline-flex; align-items: center; gap: var(--s-1); min-width: 0; font-size: 12px; font-weight: 600; line-height: 1.4; color: var(--text-2); }
.vis--author { color: var(--accent-text); }
.vis__icon { width: 14px; height: 14px; }
.vis__text { overflow-wrap: anywhere; }
.vis__text:lang(ko) { word-break: keep-all; }
</style>
