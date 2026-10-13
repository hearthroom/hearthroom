<script setup lang="ts">
/**
 * 首頁給新訪客的歡迎橫幅：看板娘蘇綺（設定集 docs/design/hearthroom-mascot）。
 *
 * 誰看得到跟新手引導同一套（lib/onboarding.ts）：沒登入的訪客，或成為成員不滿七天的人；
 * 按過關閉或走完引導就不再出現。「看入門卡」直接帶到入門卡，引導在那一頁會自己接上（CoachTour）。
 * 橫幅自帶粉色底與深色字：圖是固定配色，不跟站台主題換色，深淺模式都一樣。
 */
import { useI18n } from "vue-i18n";
import { starterFor } from "@/lib/onboarding";
import { useLocalePath } from "@/lib/use-locale";
import { track } from "@/lib/track";
import { useMascotWelcome } from "@/lib/mascot-home";
import { computed } from "vue";

const { locale } = useI18n();
const { lp } = useLocalePath();
const { visible, dismiss } = useMascotWelcome();
const starter = computed(() => starterFor(locale.value, false));

function close(source: "close" | "browse") {
  dismiss();
  track("mascot_welcome", { detail: source });
}
</script>

<template>
  <aside v-if="visible" class="welcome" :aria-label="$t('mascot.name')">
    <img class="welcome__art" src="/mascot/suki-banner.webp" alt="" width="1500" height="600" decoding="async" />
    <div class="welcome__text">
      <h2 class="welcome__title">{{ $t("mascot.welcome.title") }}</h2>
      <p class="welcome__body">{{ $t("mascot.welcome.body") }}</p>
      <div class="welcome__actions">
        <RouterLink v-if="starter" class="btn btn--primary welcome__start" :to="lp(`/cards/${starter}`)" @click="track('mascot_welcome', { detail: 'start' })">{{ $t("mascot.welcome.start") }}</RouterLink>
        <button type="button" class="btn welcome__browse" @click="close('browse')">{{ $t("mascot.welcome.browse") }}</button>
      </div>
    </div>
    <button type="button" class="welcome__close" :aria-label="$t('mascot.welcome.close')" @click="close('close')">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" /></svg>
    </button>
  </aside>
</template>

<style scoped>
/* 配色取自設定集：底 #f8d6df，字 #2a1d24／#5c4650；不吃 --bg、--text，深色模式下也是同一張粉色卡 */
.welcome {
  --welcome-bg: #f8d6df;
  position: relative; overflow: hidden; isolation: isolate;
  min-height: 220px; margin-bottom: var(--s-5);
  border-radius: var(--r-lg); background: var(--welcome-bg);
  box-shadow: 0 0 0 1px var(--line);
  color: #2a1d24;
}
.welcome__art {
  position: absolute; z-index: -2; top: 0; right: 0; height: 100%; width: auto; max-width: none;
}
/* 左邊留給字：粉色從左往右淡出，圖的人物在右三分之一 */
.welcome::before {
  content: ""; position: absolute; inset: 0; z-index: -1;
  background: linear-gradient(90deg, var(--welcome-bg) 0%, var(--welcome-bg) 42%, color-mix(in srgb, var(--welcome-bg) 0%, transparent) 64%);
}
.welcome__text { max-width: 460px; padding: var(--s-6) var(--s-6) var(--s-5); display: grid; gap: var(--s-2); }
.welcome__title { margin: 0; font-size: 24px; font-weight: 800; line-height: 1.35; }
.welcome__body { margin: 0; font-size: 15px; line-height: 1.6; color: #5c4650; }
.welcome__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-3); }
.welcome__start { height: var(--h-lg); padding: 0 var(--s-5); font-size: 15px; font-weight: 600; }
.welcome__browse {
  height: var(--h-lg); padding: 0 var(--s-5); font-size: 15px;
  background: rgba(255, 255, 255, 0.72); border-color: transparent; color: #2a1d24;
}
.welcome__browse:hover { background: rgba(255, 255, 255, 0.92); }
.welcome__close {
  position: absolute; top: var(--s-3); right: var(--s-3);
  width: var(--h-sm); height: var(--h-sm); display: grid; place-items: center;
  border: 0; border-radius: var(--r-pill); cursor: pointer;
  background: rgba(255, 255, 255, 0.75); color: #2a1d24;
}
.welcome__close:hover { background: #fff; }
.welcome__close svg { width: 14px; height: 14px; }

/* 手機：字縮一階、人物往右推，臉留在右邊三分之一 */
@media (max-width: 640px) {
  .welcome { min-height: 176px; }
  .welcome__art { right: -150px; }
  .welcome::before { background: linear-gradient(90deg, var(--welcome-bg) 0%, var(--welcome-bg) 50%, color-mix(in srgb, var(--welcome-bg) 0%, transparent) 76%); }
  .welcome__text { max-width: 62%; padding: var(--s-4); gap: var(--s-1); }
  .welcome__title { font-size: 18px; }
  .welcome__body { font-size: 13px; }
  .welcome__actions { margin-top: var(--s-2); }
  .welcome__start { height: var(--h-md); padding: 0 var(--s-4); font-size: 14px; }
  .welcome__browse { display: none; }
}
</style>
