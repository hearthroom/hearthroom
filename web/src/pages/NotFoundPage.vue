<script setup lang="ts">
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import MascotSay from "@/components/MascotSay.vue";
import { pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { track } from "@/lib/track";

/** 也給卡片頁、作者頁在 404 時直接掛：文案可以換，回榜單的路一樣。 */
const props = defineProps<{ title?: string; hint?: string }>();
const { lp } = useLocalePath();
const { t } = useI18n();
onMounted(() => {
  document.title = pageTitle(props.title ?? t("notFound.title"));
  track("page_404");
});
</script>

<template>
  <div class="page lost">
    <MascotSay src="/mascot/suki-fail.webp" :size="200" />
    <p class="eyebrow">404</p>
    <h1 class="display">{{ title ?? $t("notFound.title") }}</h1>
    <p class="muted">{{ hint ?? $t("notFound.hint") }}</p>
    <p class="lost__say">{{ $t("mascot.say.notFound") }}</p>
    <RouterLink :to="lp('/')" class="btn btn--primary">{{ $t("notFound.back") }}</RouterLink>
  </div>
</template>

<style scoped>
.lost { padding-top: var(--s-7); display: flex; flex-direction: column; align-items: center; text-align: center; }
.lost .eyebrow { margin-top: var(--s-4); }
h1 { margin: 2px 0 var(--s-2); font-size: 24px; }
h1 + .muted { margin: 0; }
.lost__say { margin: var(--s-3) 0 var(--s-6); font-size: 13px; color: var(--text-3); }
</style>
