<script setup lang="ts">
import {useLocalePath} from '@/lib/use-locale';
import {isStandalone} from '@/lib/pwa';
const {lp}=useLocalePath();
const installed=isStandalone();
</script>
<template>
  <aside v-if="!installed" class="download-banner">
    <div><strong>{{ $t('download.bannerTitle') }}</strong><p>{{ $t('download.bannerBody') }}</p></div>
    <RouterLink class="btn btn--primary" :to="lp('/download')">{{ $t('download.bannerAction') }}</RouterLink>
  </aside>
</template>
<style scoped>
.download-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-4); padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface); }
.download-banner div { flex: 1 1 220px; min-width: 0; }
.download-banner strong { font-weight: 600; }
.download-banner p { margin: var(--s-1) 0 0; color: var(--text-2); font-size: .875rem; }
.download-banner a { min-height: 44px; white-space: normal; text-align: center; }
</style>
