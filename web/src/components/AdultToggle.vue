<script setup lang="ts">
/**
 * 首頁榜單上的 R18 開關（owner 2026-09-25）：設定頁那顆藏太深，大多數成員根本不知道有成人內容。
 * 跟設定頁是同一個帳號設定，改了 session.profile，榜單的 watch 會自己重讀。
 *   - 沒登入不畫：訪客無法確認年齡，對他標示「這裡有成人內容」本身就不該做。
 *   - 沒驗過年齡、或沒同意目前這一版聲明：先開聲明窗（AdultConsentDialog），送出才真的打開。
 *   - 兩樣都齊了：點一下就切換，不再跳窗。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, updateSiteSettings } from "@/lib/api";
import { applyAdultSettings, needsAdultConsent } from "@/lib/adult-consent";
import { useSession } from "@/lib/session";
import AdultConsentDialog from "./AdultConsentDialog.vue";

const session = useSession();
const { t } = useI18n();

const on = computed(() => !!session.profile?.showNsfw && !!session.profile?.ageVerified);
const busy = ref(false);
const error = ref("");
const asking = ref(false);

async function save(next: boolean) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    applyAdultSettings(session.profile, await updateSiteSettings({ showNsfw: next }, (await session.accessToken()) ?? ""));
  } catch (err) {
    error.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    busy.value = false;
  }
}

function toggle() {
  if (on.value) return save(false);
  if (!needsAdultConsent(session.profile)) return save(true);
  error.value = "";
  asking.value = true;
}
</script>

<template>
  <template v-if="session.me && session.profile">
    <button type="button" class="r18" :class="{ 'r18--on': on }" role="switch" :aria-checked="on" :aria-label="$t('settings.content.nsfw')" :disabled="busy" @click="toggle">
      <span class="r18__label">{{ $t("board.r18") }}</span>
      <span class="r18__track" aria-hidden="true"><span class="r18__thumb" /></span>
    </button>
    <p v-if="error" class="r18__error" role="alert">{{ error }}</p>
    <AdultConsentDialog v-if="asking" @close="asking = false" @done="asking = false" />
  </template>
</template>

<style scoped>
.r18 {
  display: inline-flex; align-items: center; gap: 8px;
  height: var(--h-sm); padding: 0 6px 0 12px;
  border: 1px solid var(--line); border-radius: var(--r-pill);
  background: var(--surface); color: var(--text-2);
  font-size: 13px; font-weight: 700; letter-spacing: 0.02em; cursor: pointer;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.r18:hover { color: var(--text); }
.r18:disabled { opacity: 0.6; cursor: default; }
.r18--on { color: var(--danger); border-color: var(--danger); }
.r18__track {
  position: relative; width: 30px; height: 18px; flex: none;
  border-radius: var(--r-pill); background: var(--line);
  transition: background var(--dur) var(--ease);
}
.r18__thumb {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform var(--dur) var(--ease);
}
.r18--on .r18__track { background: var(--danger); }
.r18--on .r18__thumb { transform: translateX(12px); }
.r18__error { flex-basis: 100%; margin: 0; font-size: 13px; color: var(--danger); }

</style>
