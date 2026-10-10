<script setup lang="ts">
/**
 * 成人內容的門（owner 2026-09-08，照 Steam 的做法，不是 404）：
 *   - 沒登入：跟登入的人一樣確認年齡（owner 2026-10-10，遊客憑證見 lib/adult-consent）。
 *     站上沒開託管登入（自架站）發不了遊客憑證，才退回「這張卡片需要登入才能查看」＋登入鍵。
 *   - 登入了、還沒驗過年齡或沒同意目前這一版聲明：按鍵開聲明窗（AdultConsentDialog），
 *     勾同意（沒驗過再填出生日期）才打開開關；一次性的，之後不再問。
 *   - 兩樣都齊了但開關是關的：一顆「顯示成人內容」直接打開。
 * 開關一改，session.profile 跟著變，卡片頁看到就會重讀。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import { ApiError } from "@/lib/api";
import { guestAdult, loadGuestAdult, needsAdultConsent, saveAdult, viewerAdult } from "@/lib/adult-consent";
import { loginPath } from "@/lib/login-return";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import AdultConsentDialog from "./AdultConsentDialog.vue";
import RatingMark from "./RatingMark.vue";

const emit = defineEmits<{ enabled: [] }>();
const session = useSession();
const route = useRoute();
const { lp } = useLocalePath();
const { t } = useI18n();

const busy = ref(false);
const error = ref("");
const asking = ref(false);
const state = computed(() => viewerAdult(session));
const verified = computed(() => !!state.value?.ageVerified);
const needsConsent = computed(() => needsAdultConsent(state.value));
/** 遊客而且站上發得出遊客憑證：照登入的人那樣確認；否則只能請他登入 */
const guestLoginOnly = computed(() => !session.me && guestAdult.loaded && !guestAdult.available);
watch(() => session.ready && !session.me, (guest) => { if (guest) void loadGuestAdult(); }, { immediate: true });

async function enable() {
  if (busy.value) return;
  if (needsConsent.value) { error.value = ""; asking.value = true; return; }
  busy.value = true;
  error.value = "";
  try {
    await saveAdult(session, { showNsfw: true });
    emit("enabled");
  } catch (err) {
    error.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.actionFailed");
  } finally {
    busy.value = false;
  }
}

function consented() {
  asking.value = false;
  emit("enabled");
}
</script>

<template>
  <section class="gate panel">
    <RatingMark rating="R" variant="chip" class="gate__badge" />
    <h1 class="gate__title display">{{ $t("card.gate.title") }}</h1>

    <template v-if="guestLoginOnly">
      <p class="gate__text">{{ $t("card.gate.login") }}</p>
      <RouterLink class="btn btn--primary" :to="lp(loginPath(route.fullPath))">{{ $t("nav.login") }}</RouterLink>
    </template>

    <template v-else-if="!state">
      <p class="subtle">{{ $t("state.loading") }}</p>
    </template>

    <template v-else>
      <p class="gate__text">{{ $t(!verified ? "card.gate.verify" : needsConsent ? "card.gate.consent" : "card.gate.enable") }}</p>
      <button type="button" class="btn btn--primary" :disabled="busy" @click="enable">{{ $t("settings.content.nsfw") }}</button>
    </template>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-if="session.me" class="subtle gate__foot">{{ $t("card.gate.settingsHint") }}</p>
    <AdultConsentDialog v-if="asking" @close="asking = false" @done="consented" />
  </section>
</template>

<style scoped>
.gate { max-width: 480px; margin: var(--s-7) auto; padding: var(--s-6); display: grid; gap: var(--s-3); justify-items: center; text-align: center; }
.gate__badge { margin: 0; }
.gate__title { margin: 0; font-size: clamp(20px, 2.6vw, 24px); }
.gate__text { margin: 0; color: var(--text-2); line-height: 1.7; }
.gate__foot { margin: var(--s-2) 0 0; }
</style>
