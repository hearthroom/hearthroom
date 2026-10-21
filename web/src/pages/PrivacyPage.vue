<script setup lang="ts">
import { watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { pageTitle } from "@/lib/i18n";
const { t } = useI18n();
watchEffect(() => { document.title = pageTitle(t("privacy.analytics.title")); });
</script>

<template>
  <article class="page page--narrow privacy-page">
    <h1>{{ t("privacy.analytics.title") }}</h1>
    <p v-for="n in 7" :key="n">{{ t(`privacy.analytics.p${n}`) }}</p>
  </article>
</template>

<style scoped>
.privacy-page { padding-block: var(--s-6); overflow-wrap: anywhere; }
.privacy-page h1 { font-size: 22px; line-height: 1.4; }
.privacy-page p { margin-block: var(--s-5); line-height: 1.8; }
.privacy-page:lang(ko) { word-break: keep-all; }
</style>
