<script setup lang="ts">
/**
 * 設定 › 個人資料：對外顯示什麼（主頁改版 owner 2026-10-19 搬來的主頁數據開關，預設關）與榜單隱私。
 * 暱稱、頭像、簡介在「我的」頁的編輯模式（/me?edit=1），這裡只放一列連過去。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import AccountIcon from "@/components/AccountIcon.vue";
import LeaderboardPrivacy from "@/components/LeaderboardPrivacy.vue";
import { ApiError, updateSiteSettings } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";

const { t } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

const showStats = computed(() => !!session.profile?.showStats);
const statsBusy = ref(false);
const statsError = ref("");
async function setStats(on: boolean, input: HTMLInputElement) {
  if (statsBusy.value) return;
  statsError.value = "";
  statsBusy.value = true;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const result = await updateSiteSettings({ showStats: on }, token);
    if (session.profile) session.profile.showStats = result.showStats ?? on;
  } catch (err) {
    input.checked = showStats.value;
    statsError.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    statsBusy.value = false;
  }
}
</script>

<template>
  <section class="panel set-card">
    <p class="eyebrow set-card__head">{{ $t("settings.profile.title") }}</p>
    <RouterLink :to="{ path: lp('/me'), query: { edit: '1' } }" class="content__row content__link">
      <span class="content__text"><strong>{{ $t("profile.editProfile") }}</strong><span class="subtle">{{ $t("settings.profile.edit") }}</span></span>
      <AccountIcon name="arrow" />
    </RouterLink>
    <label class="content__row">
      <span class="content__text"><strong>{{ $t("settings.profile.stats") }}</strong><span class="subtle">{{ $t("settings.profile.statsHint") }}</span></span>
      <input type="checkbox" class="content__switch" :checked="showStats" :disabled="statsBusy" @change="setStats(($event.target as HTMLInputElement).checked, $event.target as HTMLInputElement)" />
    </label>
    <p v-if="statsError" class="notice notice--error" role="alert">{{ statsError }}</p>
  </section>

  <section id="leaderboard-privacy" class="panel set-card">
    <h3 class="eyebrow set-card__head">{{ $t("spendBoard.privacySettings") }}</h3>
    <LeaderboardPrivacy />
  </section>
</template>
