<script setup lang="ts">
/**
 * 成就榜：作者與成員之間的排名（年度積分、作者成就、綜合成就）。首頁的榜單分頁排的是角色卡，
 * 這裡排的是人，所以獨立成一頁（owner 2026-11-20）；入口在帳號選單與徽章頁。
 */
import { watch } from "vue";
import { useI18n } from "vue-i18n";
import { pageTitle } from "@/lib/i18n";
import AchievementsBoard from "@/components/AchievementsBoard.vue";
import CommunityIcon from "@/components/CommunityIcon.vue";

const { t } = useI18n();
watch(() => t("achievements.title"), (value) => { document.title = pageTitle(value); }, { immediate: true });
</script>

<template>
  <div class="page achievements-page">
    <header class="achievements-page__head">
      <span class="achievements-page__icon"><CommunityIcon name="crown" /></span>
      <div>
        <h1 class="display">{{ t("achievements.title") }}</h1>
        <p class="subtle">{{ t("achievements.pageIntro") }}</p>
      </div>
    </header>
    <AchievementsBoard />
  </div>
</template>

<style scoped>
.achievements-page { max-width: 52rem; display: grid; gap: var(--s-6); }
.achievements-page__head { display: flex; gap: var(--s-4); align-items: center; }
.achievements-page__head h1 { font-size: clamp(1.75rem, 4vw, 2.25rem); margin: 0; }
.achievements-page__head p { margin: var(--s-2) 0 0; line-height: 1.6; max-width: 36rem; }
.achievements-page__icon { display: flex; align-items: center; justify-content: center; flex: none; width: 3.5rem; height: 3.5rem; background: var(--accent-tint); color: var(--accent-text); border-radius: var(--r-lg); }
.achievements-page__icon svg { width: 2rem; height: 2rem; }
.achievements-page__head p:lang(ko) { word-break: keep-all; }
.achievements-page__head p:lang(ja) { word-break: auto-phrase; }
</style>
