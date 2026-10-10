<script setup lang="ts">
/**
 * 頁首的 R18 開關（owner 2026-09-25 從設定頁搬到首頁，2026-10-02 再搬進頁首、只在首頁畫）：
 * 設定頁那顆藏太深，大多數成員根本不知道有成人內容。登入的人改的是帳號設定（session.profile），榜單的 watch 會自己重讀。
 *   - 遊客也畫（owner 2026-10-10，取代 2026-10-02「沒登入不畫」）：確認是成人就能看，確認不是成人就不能看，
 *     跟有沒有帳號無關。遊客改的是伺服器發的遊客憑證（lib/adult-consent 的 guestAdult），登入時帶進帳號。
 *     站上沒開託管登入（自架站）時遊客憑證發不出來，照舊不畫。
 *   - 沒驗過年齡、或沒同意目前這一版聲明：先開聲明窗（AdultConsentDialog），送出才真的打開。
 *   - 兩樣都齊了：點一下就切換，不再跳窗。
 *
 * 樣子是一顆跟外觀、語言同尺寸的圓鈕，不是 switch：原本的膠囊（字＋軌道）約 84px，375px 手機的頁首剩不到 50px，
 * 放進去會把字標擠成省略號。關的時候字上畫一道斜線（跟靜音、隱藏眼睛同一個慣例），開的時候紅底白字——
 * 兩個狀態各有自己的訊號，不是「有色／沒色」要比對才知道（owner 2026-10-02）。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ApiError } from "@/lib/api";
import { loadGuestAdult, needsAdultConsent, saveAdult, viewerAdult } from "@/lib/adult-consent";
import { useSession } from "@/lib/session";
import AdultConsentDialog from "./AdultConsentDialog.vue";

const session = useSession();
const { t } = useI18n();

const state = computed(() => viewerAdult(session));
const on = computed(() => !!state.value?.showNsfw && !!state.value?.ageVerified);
// 確定是遊客了才問遊客憑證（登入的人看帳號設定，不必多問一趟）
watch(() => session.ready && !session.me, (guest) => { if (guest) void loadGuestAdult(); }, { immediate: true });
const busy = ref(false);
const error = ref("");
const asking = ref(false);
/** 頁首沒地方長住一行紅字：錯誤用站上一般的提示條（.toast，貼底置中）說，幾秒後自己走，再點一次也會清掉 */
let errorTimer: ReturnType<typeof setTimeout> | undefined;
function showError(message: string) {
  error.value = message;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { error.value = ""; }, 6000);
}
onBeforeUnmount(() => clearTimeout(errorTimer));

async function save(next: boolean) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await saveAdult(session, { showNsfw: next });
  } catch (err) {
    showError(err instanceof ApiError || err instanceof Error ? err.message : t("state.saveFailed"));
  } finally {
    busy.value = false;
  }
}

function toggle() {
  if (on.value) return save(false);
  if (!needsAdultConsent(state.value)) return save(true);
  error.value = "";
  asking.value = true;
}
</script>

<template>
  <div v-if="state" class="r18wrap">
    <button type="button" class="r18" :class="{ 'r18--on': on }" role="switch" :aria-checked="on" :aria-label="$t('settings.content.nsfw')" :title="$t('settings.content.nsfw')" :disabled="busy" @click="toggle">
      <span class="r18__label">{{ $t("board.r18") }}</span>
    </button>
    <Teleport to="body"><p v-if="error" class="toast" role="alert">{{ error }}</p></Teleport>
    <AdultConsentDialog v-if="asking" @close="asking = false" @done="asking = false" />
  </div>
</template>

<style scoped>
.r18wrap { position: relative; flex: none; display: inline-flex; }
.r18 {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; padding: 0;
  border: 1px solid var(--line-strong); border-radius: var(--r-pill);
  background: transparent; color: var(--text-3);
  font-size: 10.5px; font-weight: 700; letter-spacing: 0; line-height: 1; cursor: pointer;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.r18:hover { color: var(--text); border-color: var(--text-3); }
.r18:disabled { opacity: 0.6; cursor: default; }
/* 關：字上一道斜線。畫在鈕上而不是字上，字的寬度跟著語言變，線的位置不該跟著變 */
.r18::after {
  content: ""; position: absolute; left: 7px; right: 7px; top: 50%; height: 1.5px;
  background: currentColor; transform: rotate(-35deg);
  transition: opacity var(--dur) var(--ease);
}
.r18--on { background: var(--danger); border-color: var(--danger); color: var(--on-danger); }
.r18--on:hover { color: var(--on-danger); border-color: var(--danger); }
.r18--on::after { opacity: 0; }
</style>
