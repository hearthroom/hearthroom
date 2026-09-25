<script setup lang="ts">
/**
 * 成人內容聲明窗（owner 2026-09-26）：首頁 R18、卡片頁的門、設定頁三個入口共用這一個。
 *   - 一定要勾「我已年滿 18 歲並同意」才能送；聲明文字對應 shared/adult-consent.ts 的版本，改文字要加版本。
 *   - 年齡沒驗過才問出生日期（伺服器只看一眼、不存）；驗過但聲明是舊版，只要重新勾同意。
 *   - 送出就是「打開成人內容」：成功後寫回 session.profile 並 emit done；取消什麼都不送。
 * 已經驗過也同意過的人不會走到這裡——呼叫端用 needsAdultConsent 判斷，直接一鍵打開。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, updateSiteSettings } from "@/lib/api";
import { applyAdultSettings } from "@/lib/adult-consent";
import { useSession } from "@/lib/session";
import { ADULT_CONSENT_VERSION } from "../../../shared/adult-consent";

const emit = defineEmits<{ (e: "close"): void; (e: "done"): void }>();
const session = useSession();
const { t } = useI18n();

const verified = computed(() => !!session.profile?.ageVerified);
const agreed = ref(false);
const birthdate = ref("");
const busy = ref(false);
const error = ref("");
const today = new Date().toISOString().slice(0, 10);
const box = ref<HTMLFormElement | null>(null);
const ready = computed(() => agreed.value && (verified.value || !!birthdate.value));

async function submit() {
  if (busy.value || !ready.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await updateSiteSettings(
      { showNsfw: true, ...(verified.value ? {} : { birthdate: birthdate.value }), consentVersion: ADULT_CONSENT_VERSION },
      (await session.accessToken()) ?? "",
    );
    applyAdultSettings(session.profile, result);
    emit("done");
  } catch (err) {
    error.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    busy.value = false;
  }
}

function cancel() {
  if (!busy.value) emit("close");
}

/** 開啟前的焦點：關掉時還回去 */
let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); cancel(); }
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.querySelector<HTMLElement>(verified.value ? 'input[type="checkbox"]' : 'input[type="date"]')?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKey);
  restore?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div class="dlg-backdrop" @click.self="cancel">
      <form ref="box" class="dlg panel" role="dialog" aria-modal="true" aria-labelledby="adult-consent-title" @submit.prevent="submit">
        <h2 id="adult-consent-title" class="dlg__title">{{ $t("adultConsent.title") }}</h2>
        <p class="dlg__msg">{{ $t(verified ? "adultConsent.reconfirm" : "adultConsent.intro") }}</p>
        <ul class="dlg__terms">
          <li>{{ $t("adultConsent.offensive") }}</li>
          <li>{{ $t("adultConsent.noMinors") }}</li>
        </ul>
        <label v-if="!verified" class="dlg__field">
          <span>{{ $t("settings.content.birthdate") }}</span>
          <input v-model="birthdate" type="date" class="input" :max="today" required />
          <span class="subtle dlg__hint">{{ $t("settings.content.birthdateHint") }}</span>
        </label>
        <label class="dlg__agree">
          <input v-model="agreed" type="checkbox" />
          <span>{{ $t("adultConsent.agree") }}</span>
        </label>
        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <div class="dlg__actions">
          <button type="button" class="btn" :disabled="busy" @click="cancel">{{ $t("dialog.cancel") }}</button>
          <button type="submit" class="btn btn--primary" :disabled="busy || !ready">{{ $t("adultConsent.confirm") }}</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.dlg-backdrop {
  position: fixed; inset: 0; z-index: 100;
  display: grid; place-items: center; padding: var(--s-5);
  background: rgba(16, 16, 24, 0.45);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.dlg { width: min(420px, 100%); max-height: calc(100dvh - 2 * var(--s-5)); overflow-y: auto; padding: var(--s-5) var(--s-5) var(--s-4); display: grid; gap: var(--s-3); box-shadow: 0 0 0 1px var(--line), var(--shadow-md); text-align: left; }
.dlg__title { font-size: 16px; font-weight: 600; line-height: 1.4; margin: 0; }
.dlg__msg { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-2); }
.dlg__terms { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; font-size: 14px; line-height: 1.6; color: var(--text-2); }
.dlg__field { display: grid; gap: 6px; font-size: 13px; color: var(--text-2); }
.dlg__field .input { width: 100%; }
.dlg__hint { margin: 0; }
.dlg__agree { display: flex; align-items: flex-start; gap: var(--s-2); font-size: 14px; line-height: 1.5; color: var(--text); cursor: pointer; }
.dlg__agree input { margin-top: 3px; flex: none; width: 16px; height: 16px; accent-color: var(--danger); }
.dlg__actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-1); }

@media (max-width: 480px) {
  .dlg-backdrop { place-items: end center; padding: var(--s-3); padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom)); }
  .dlg { max-height: calc(100dvh - 2 * var(--s-3)); }
  .dlg__actions { flex-direction: column-reverse; }
  .dlg__actions .btn { width: 100%; height: var(--h-lg); }
}
</style>
