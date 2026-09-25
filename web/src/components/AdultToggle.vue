<script setup lang="ts">
/**
 * 首頁榜單上的 R18 開關（owner 2026-09-25）：設定頁那顆藏太深，大多數成員根本不知道有成人內容。
 * 跟設定頁是同一個帳號設定，改了 session.profile，榜單的 watch 會自己重讀。
 *   - 沒登入不畫：訪客無法確認年齡，對他標示「這裡有成人內容」本身就不該做。
 *   - 沒驗過年齡：先開一個填出生日期的小窗，驗過才真的打開；只問一次。
 *   - 驗過了：點一下就切換。
 */
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError, updateSiteSettings } from "@/lib/api";
import { useSession } from "@/lib/session";

const session = useSession();
const { t } = useI18n();

const on = computed(() => !!session.profile?.showNsfw && !!session.profile?.ageVerified);
const verified = computed(() => !!session.profile?.ageVerified);
const busy = ref(false);
const error = ref("");
const asking = ref(false);
const birthdate = ref("");
const today = new Date().toISOString().slice(0, 10);
const dateInput = ref<HTMLInputElement | null>(null);

async function save(next: boolean) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await updateSiteSettings({ showNsfw: next, ...(next && !verified.value ? { birthdate: birthdate.value } : {}) }, (await session.accessToken()) ?? "");
    if (session.profile) { session.profile.showNsfw = result.showNsfw; session.profile.ageVerified = result.ageVerified; }
    asking.value = false;
    birthdate.value = "";
  } catch (err) {
    error.value = err instanceof ApiError || err instanceof Error ? err.message : t("state.saveFailed");
  } finally {
    busy.value = false;
  }
}

async function toggle() {
  if (on.value) return save(false);
  if (verified.value) return save(true);
  error.value = "";
  asking.value = true;
  await nextTick();
  dateInput.value?.focus();
}

function cancel() {
  if (busy.value) return;
  asking.value = false;
  birthdate.value = "";
  error.value = "";
}
</script>

<template>
  <template v-if="session.me && session.profile">
    <button type="button" class="r18" :class="{ 'r18--on': on }" role="switch" :aria-checked="on" :aria-label="$t('settings.content.nsfw')" :disabled="busy" @click="toggle">
      <span class="r18__label">{{ $t("board.r18") }}</span>
      <span class="r18__track" aria-hidden="true"><span class="r18__thumb" /></span>
    </button>
    <p v-if="error && !asking" class="r18__error" role="alert">{{ error }}</p>

    <Teleport to="body">
      <div v-if="asking" class="dlg-backdrop" @click.self="cancel" @keydown.esc="cancel">
        <form class="dlg panel" role="dialog" aria-modal="true" aria-labelledby="r18-title" @submit.prevent="save(true)">
          <h2 id="r18-title" class="dlg__title">{{ $t("board.r18Age.title") }}</h2>
          <p class="dlg__msg">{{ $t("board.r18Age.desc") }}</p>
          <label class="dlg__field">
            <span>{{ $t("settings.content.birthdate") }}</span>
            <input ref="dateInput" v-model="birthdate" type="date" class="input" :max="today" required />
          </label>
          <p class="subtle dlg__hint">{{ $t("settings.content.birthdateHint") }}</p>
          <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
          <div class="dlg__actions">
            <button type="button" class="btn" :disabled="busy" @click="cancel">{{ $t("dialog.cancel") }}</button>
            <button type="submit" class="btn btn--primary" :disabled="busy || !birthdate">{{ $t("settings.content.confirmAge") }}</button>
          </div>
        </form>
      </div>
    </Teleport>
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

.dlg-backdrop {
  position: fixed; inset: 0; z-index: 100;
  display: grid; place-items: center; padding: var(--s-5);
  background: rgba(16, 16, 24, 0.45);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.dlg { width: min(400px, 100%); padding: var(--s-5) var(--s-5) var(--s-4); display: grid; gap: var(--s-3); box-shadow: 0 0 0 1px var(--line), var(--shadow-md); }
.dlg__title { font-size: 16px; font-weight: 600; line-height: 1.4; margin: 0; }
.dlg__msg { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-2); }
.dlg__field { display: grid; gap: 6px; font-size: 13px; color: var(--text-2); }
.dlg__field .input { width: 100%; }
.dlg__hint { margin: 0; }
.dlg__actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-1); }

@media (max-width: 480px) {
  .dlg-backdrop { place-items: end center; padding: var(--s-3); padding-bottom: calc(var(--s-3) + env(safe-area-inset-bottom)); }
  .dlg__actions { flex-direction: column-reverse; }
  .dlg__actions .btn { width: 100%; height: var(--h-lg); }
}
</style>
