<script setup lang="ts">
/**
 * 設定 › 內容。
 *
 * 成人內容開關（owner 2026-09-08）：本站自己的設定，住在成員上；第一次開要填出生日期，
 * 伺服器只用它算滿不滿 18、不保存；共用聲明窗用年、月、日三欄直接輸入。
 *
 * 不想看的類型（owner 2026-09-14）：勾起來的類型不會出現在榜單和搜尋裡。不分頁不分區——首頁還是一個池子，
 * 每個人自己拉窗簾。勾一下就存（跟成人開關一樣），存在成員上、換裝置跟著走；榜單排尾的「已隱藏 N 類」帶回這裡（#hidden）。
 *
 * 「國家／地區」一卡排在最上面、成人內容之前（它決定成人內容那張卡在不在），由地區任務接上（ui.md §4.3）。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import AdultConsentDialog from "@/components/AdultConsentDialog.vue";
import { ApiError, updateSiteSettings } from "@/lib/api";
import { applyAdultSettings, needsAdultConsent } from "@/lib/adult-consent";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { TAG_CATALOG, tagLabel } from "../../../../shared/tag-catalog";

const { t } = useI18n();
const { locale } = useLocalePath();
const session = useSession();

async function token(): Promise<string> {
  const value = await session.accessToken();
  if (!value) throw new Error(t("auth.expired"));
  return value;
}

// ---- 成人內容開關 ----
const showNsfw = computed(() => !!session.profile?.showNsfw);
const ageVerified = computed(() => !!session.profile?.ageVerified);
/** 年齡沒驗過或沒同意這一版聲明：打開前先走聲明窗（跟首頁、卡片頁同一個） */
const askingConsent = ref(false);
const nsfwBusy = ref(false);
const nsfwError = ref("");

async function setNsfw(on: boolean, input?: HTMLInputElement) {
  nsfwError.value = "";
  if (on && needsAdultConsent(session.profile)) {
    // 開關還沒真的打開：勾選框退回關著，送出聲明窗才會變
    if (input) input.checked = false;
    askingConsent.value = true;
    return;
  }
  if (nsfwBusy.value) return;
  nsfwBusy.value = true;
  try {
    applyAdultSettings(session.profile, await updateSiteSettings({ showNsfw: on }, await token()));
  } catch (err) {
    if (input) input.checked = showNsfw.value;
    nsfwError.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    nsfwBusy.value = false;
  }
}

// ---- 不想看的類型 ----
const hidden = computed(() => session.profile?.hiddenTags ?? []);
const hiddenBusy = ref(false);
const hiddenError = ref("");
const isHidden = (key: string) => hidden.value.includes(key);
async function toggleHidden(key: string) {
  if (hiddenBusy.value) return;
  hiddenError.value = "";
  const next = isHidden(key) ? hidden.value.filter((k) => k !== key) : [...hidden.value, key];
  hiddenBusy.value = true;
  try {
    const result = await updateSiteSettings({ hiddenTags: next }, await token());
    if (session.profile) session.profile.hiddenTags = result.hiddenTags;
  } catch (err) {
    hiddenError.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    hiddenBusy.value = false;
  }
}
</script>

<template>
  <!-- 國家／地區：這裡（地區任務 2026-11-03-region-cn-limits） -->

  <section class="panel set-card">
    <p class="eyebrow set-card__head">{{ $t("settings.content.title") }}</p>
    <label class="content__row">
      <span class="content__text">
        <strong>{{ $t("settings.content.nsfw") }}</strong>
        <span class="subtle">{{ $t("settings.content.nsfwDesc") }}</span>
        <span v-if="ageVerified" class="subtle content__verified">{{ $t("settings.content.verified") }}</span>
      </span>
      <input type="checkbox" class="content__switch" :checked="showNsfw" :disabled="nsfwBusy" @change="setNsfw(($event.target as HTMLInputElement).checked, $event.target as HTMLInputElement)" />
    </label>
    <AdultConsentDialog v-if="askingConsent" @close="askingConsent = false" @done="askingConsent = false" />
    <p v-if="nsfwError" class="notice notice--error" role="alert">{{ nsfwError }}</p>
  </section>

  <section id="hidden" class="panel set-card">
    <p class="eyebrow set-card__head">{{ $t("settings.hidden.title") }}</p>
    <p class="subtle hidden__desc">{{ $t("settings.hidden.desc") }}</p>
    <div class="hidden__chips" role="group" :aria-label="$t('settings.hidden.title')" :aria-busy="hiddenBusy">
      <button v-for="x in TAG_CATALOG" :key="x.key" type="button" class="tagchip" :class="{ 'is-on': isHidden(x.key) }" :aria-pressed="isHidden(x.key)" :disabled="hiddenBusy" @click="toggleHidden(x.key)">
        {{ tagLabel(x, locale) }}
      </button>
    </div>
    <p class="subtle" role="status">{{ hidden.length ? $t("settings.hidden.count", { n: hidden.length }) : $t("settings.hidden.none") }}</p>
    <p v-if="hiddenError" class="notice notice--error" role="alert">{{ hiddenError }}</p>
  </section>
</template>

<style scoped>
.hidden__desc { margin: 0; }
.hidden__chips { display: flex; flex-wrap: wrap; gap: 6px; }
/* 跟榜單那排長得一樣；勾起來＝反白 */
.tagchip {
  display: inline-flex; align-items: center; gap: 5px;
  height: var(--h-sm); padding: 0 12px; white-space: nowrap;
  background: var(--surface); border: 0; border-radius: var(--r-pill);
  box-shadow: 0 0 0 1px var(--line);
  font-size: 13px; font-weight: 500; color: var(--text-2); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.tagchip:hover { color: var(--text); box-shadow: 0 0 0 1px var(--line-strong); }
.tagchip.is-on { background: var(--text); color: var(--surface); box-shadow: none; }
.tagchip:disabled { cursor: progress; opacity: 0.7; }
</style>
