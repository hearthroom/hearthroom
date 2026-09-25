<script setup lang="ts">
import {ref} from 'vue';
import {useLocalePath} from '@/lib/use-locale';
import {isStandalone} from '@/lib/pwa';
import {dismissAndroidBanner,readAndroidBannerDismissed,shouldShowAndroidBanner} from '@/lib/download';
const {lp}=useLocalePath();
// 只有 Android 瀏覽器、不在 App／已安裝的 PWA 裡、沒按過關閉才出現（規則在 lib/download.ts）。
const visible=ref(shouldShowAndroidBanner({ua:navigator.userAgent,standalone:isStandalone(),dismissed:readAndroidBannerDismissed()}));
function close(){visible.value=false;dismissAndroidBanner();}
</script>
<template>
  <aside v-if="visible" class="download-banner">
    <div><strong>{{ $t('download.bannerTitle') }}</strong><p>{{ $t('download.bannerBody') }}</p></div>
    <RouterLink class="btn btn--primary" :to="lp('/download')">{{ $t('download.bannerAction') }}</RouterLink>
    <button type="button" class="btn btn--icon btn--sm btn--ghost download-banner__close" :aria-label="$t('dialog.close')" @click="close">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" /></svg>
    </button>
  </aside>
</template>
<style scoped>
.download-banner { position: relative; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-4); padding: var(--s-4) var(--s-5); padding-right: calc(var(--s-5) + 32px); margin-bottom: var(--s-5); border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface); }
.download-banner div { flex: 1 1 220px; min-width: 0; }
.download-banner strong { font-weight: 600; }
.download-banner p { margin: var(--s-1) 0 0; color: var(--text-2); font-size: .875rem; }
.download-banner a { min-height: 44px; white-space: normal; text-align: center; }
.download-banner__close { position: absolute; top: var(--s-2); right: var(--s-2); }
.download-banner__close svg { width: 16px; height: 16px; }
</style>
