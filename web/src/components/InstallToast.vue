<script setup lang="ts">
/**
 * 「裝到主畫面」的提示卡。什麼時候出現由 lib/pwa.ts 決定，這裡只負責畫與回報按了什麼。
 * 兩種樣子：有原生安裝框的（Chromium 系）給「安裝／以後再說」；iOS Safari 沒有 API，給步驟與「知道了」。
 * 對象是卡片（卡片頁按了「加到主畫面」）時標題換成卡名；步驟一樣。
 */
import { acceptInstall, dismissInstall, installPrompt } from "@/lib/pwa";
import { track } from "@/lib/track";

function onInstall() { track("pwa_install_click"); void acceptInstall(); }
function onLater() { track("pwa_install_later"); dismissInstall(); }
</script>

<template>
  <Transition name="install">
    <section v-if="installPrompt.visible" class="install" role="region" :aria-label="$t('pwa.install.title')">
      <div class="install__row">
        <span class="install__tile" aria-hidden="true">
          <img v-if="installPrompt.target === 'card' && installPrompt.icon" :src="installPrompt.icon" alt="" />
          <svg v-else viewBox="0 0 24 24"><path d="M5 3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-7.5L7 21.5V18H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" /></svg>
        </span>
        <div class="install__text">
          <p class="install__title">{{ installPrompt.target === "card" ? $t("pwa.install.cardTitle", { name: installPrompt.name }) : $t("pwa.install.title") }}</p>
          <p class="install__body">{{ installPrompt.kind === "ios" ? $t("pwa.install.ios") : installPrompt.kind === "android" ? $t("pwa.install.android") : installPrompt.target === "card" ? $t("pwa.install.cardBody") : $t("pwa.install.body") }}</p>
        </div>
        <button type="button" class="btn btn--icon btn--sm btn--ghost install__close" :aria-label="$t('pwa.install.later')" @click="onLater">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" /></svg>
        </button>
      </div>
      <div class="install__actions">
        <template v-if="installPrompt.kind === 'native'">
          <button type="button" class="btn btn--sm btn--ghost" @click="onLater">{{ $t("pwa.install.later") }}</button>
          <button type="button" class="btn btn--sm btn--primary" @click="onInstall">{{ $t("pwa.install.cta") }}</button>
        </template>
        <button v-else type="button" class="btn btn--sm btn--primary" @click="onLater">{{ $t("pwa.install.ok") }}</button>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
/* 手機：貼底、左右留邊；寬螢幕：右下角一張卡。壓在一般提示（.toast，90）之上、確認框（110）之下 */
.install {
  position: fixed; z-index: 95;
  left: var(--s-3); right: var(--s-3); bottom: calc(var(--s-3) + env(safe-area-inset-bottom));
  padding: var(--s-4); border-radius: var(--r-lg);
  background: var(--surface); color: var(--text);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
@media (min-width: 720px) {
  .install { left: auto; width: 380px; right: var(--s-5); bottom: calc(var(--s-5) + env(safe-area-inset-bottom)); }
}
.install__row { display: flex; gap: var(--s-3); align-items: flex-start; }
.install__tile {
  flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; overflow: hidden;
  background: var(--accent-grad); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}
.install__tile svg { width: 22px; height: 22px; fill: var(--on-accent); }
.install__tile img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
.install__text { flex: 1; min-width: 0; }
.install__title { margin: 0 0 2px; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.install__body { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-2); }
.install__close { flex: none; margin: -6px -6px 0 0; }
.install__close svg { width: 16px; height: 16px; }
.install__actions { display: flex; justify-content: flex-end; gap: var(--s-2); margin-top: var(--s-3); }

.install-enter-active, .install-leave-active { transition: opacity var(--dur) var(--ease), transform var(--dur) var(--ease); }
.install-enter-from, .install-leave-to { opacity: 0; transform: translateY(12px); }
</style>
