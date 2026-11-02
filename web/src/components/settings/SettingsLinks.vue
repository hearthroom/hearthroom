<script setup lang="ts">
/**
 * 設定 › 連結與授權：Discord 社群（綁定、身分組、頭像框等裝扮都在那一頁，這裡只連過去）
 * 與卡片、遊玩服務的登入授權（主頁改版 2026-10-19 從「我的」頁右欄搬來）。
 */
import { RouterLink } from "vue-router";
import AccountIcon from "@/components/AccountIcon.vue";
import ConnectedAccounts from "@/components/ConnectedAccounts.vue";
import { useLocalePath } from "@/lib/use-locale";

const { lp } = useLocalePath();
</script>

<template>
  <section class="panel set-card">
    <RouterLink :to="lp('/me/community')" class="content__row content__link">
      <span class="content__text"><strong>{{ $t("community.title") }}</strong><span class="subtle">{{ $t("community.hint") }}</span></span>
      <AccountIcon name="arrow" />
    </RouterLink>
  </section>

  <section id="account" class="panel set-card" :aria-label="$t('settings.account.title')">
    <p class="eyebrow set-card__head">{{ $t("settings.account.title") }}</p>
    <ConnectedAccounts />
  </section>
</template>
