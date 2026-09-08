<script setup lang="ts">
/**
 * 成人內容的門（owner 2026-09-08，照 Steam 的做法，不是 404）：
 *   - 沒登入：「這張卡片需要登入才能查看」＋登入鍵（登入後回到這張卡）。
 *   - 登入了、還沒驗過年齡：就地填出生日期，驗過就順手把開關打開——一次性的，之後不再問。
 *   - 登入了、驗過年齡但開關是關的：一顆「顯示成人內容」把開關打開。
 * 開關一改，session.profile 跟著變，卡片頁看到就會重讀。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import { ApiError, updateSiteSettings } from "@/lib/api";
import { loginPath } from "@/lib/login-return";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";

const session = useSession();
const route = useRoute();
const { lp } = useLocalePath();
const { t } = useI18n();

const birthdate = ref("");
const busy = ref(false);
const error = ref("");
const today = new Date().toISOString().slice(0, 10);
const verified = computed(() => !!session.profile?.ageVerified);

async function enable() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await updateSiteSettings({ showNsfw: true, ...(verified.value ? {} : { birthdate: birthdate.value }) }, (await session.accessToken()) ?? "");
    if (session.profile) { session.profile.showNsfw = result.showNsfw; session.profile.ageVerified = result.ageVerified; }
  } catch (err) {
    error.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="gate panel">
    <span class="nsfw-badge gate__badge">{{ $t("card.nsfw") }}</span>
    <h1 class="gate__title display">{{ $t("card.gate.title") }}</h1>

    <template v-if="!session.me">
      <p class="gate__text">{{ $t("card.gate.login") }}</p>
      <RouterLink class="btn btn--primary" :to="lp(loginPath(route.fullPath))">{{ $t("nav.login") }}</RouterLink>
    </template>

    <template v-else-if="!session.profile">
      <p class="subtle">{{ $t("state.loading") }}</p>
    </template>

    <form v-else-if="!verified" class="gate__form" @submit.prevent="enable">
      <p class="gate__text">{{ $t("card.gate.verify") }}</p>
      <label for="gate-birthdate">{{ $t("settings.content.birthdate") }}</label>
      <input id="gate-birthdate" v-model="birthdate" type="date" class="input" :max="today" required />
      <p class="subtle">{{ $t("settings.content.birthdateHint") }}</p>
      <button type="submit" class="btn btn--primary" :disabled="busy || !birthdate">{{ $t("settings.content.confirmAge") }}</button>
    </form>

    <template v-else>
      <p class="gate__text">{{ $t("card.gate.enable") }}</p>
      <button type="button" class="btn btn--primary" :disabled="busy" @click="enable">{{ $t("settings.content.nsfw") }}</button>
    </template>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p class="subtle gate__foot">{{ $t("card.gate.settingsHint") }}</p>
  </section>
</template>

<style scoped>
.gate { max-width: 480px; margin: var(--s-7) auto; padding: var(--s-6); display: grid; gap: var(--s-3); justify-items: center; text-align: center; }
.gate__badge { margin: 0; }
.gate__title { margin: 0; font-size: clamp(20px, 2.6vw, 24px); }
.gate__text { margin: 0; color: var(--text-2); line-height: 1.7; }
.gate__form { display: grid; gap: var(--s-2); width: 100%; max-width: 320px; justify-items: center; }
.gate__form .input { width: 100%; }
.gate__foot { margin: var(--s-2) 0 0; }
</style>
