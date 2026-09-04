<script setup lang="ts">
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";

/** 也給卡片頁、作者頁在 404 時直接掛：文案可以換，回榜單的路一樣。 */
defineProps<{ title?: string; hint?: string }>();
const { lp } = useLocalePath();
const { t } = useI18n();
onMounted(() => { document.title = pageTitle(t("notFound.title")); });
</script>

<template>
  <div class="page lost">
    <p class="eyebrow">404</p>
    <h1 class="display">{{ title ?? $t("notFound.title") }}</h1>
    <p class="muted">{{ hint ?? $t("notFound.hint") }}</p>
    <RouterLink :to="lp('/')" class="btn">← {{ $t("notFound.back") }}</RouterLink>
  </div>
</template>

<style scoped>
.lost { padding-top: var(--s-8); }
h1 { margin: 2px 0 var(--s-2); font-size: 24px; }
h1 + .muted { margin: 0 0 var(--s-6); }
</style>
