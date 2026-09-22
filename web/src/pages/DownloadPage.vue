<script setup lang="ts">
import {watchEffect} from 'vue';
import {useI18n} from 'vue-i18n';
import {pageTitle} from '@/lib/i18n';
import {androidDownloadUrl} from '@/lib/download';
import {SITE} from '@/lib/site';
const {t}=useI18n();
const apkUrl=androidDownloadUrl();
watchEffect(()=>{document.title=pageTitle(t('download.title'))});
</script>

<template>
  <div class="download-page">
    <header class="download-hero">
      <img src="/icons/icon-192.png" alt="" width="72" height="72" />
      <h1>{{ $t('download.title') }}</h1>
      <p>{{ $t('download.intro') }}</p>
      <a class="btn btn--primary download-action" :href="apkUrl">{{ $t('download.android') }}</a>
      <span class="download-requirement">{{ $t('download.requirement') }}</span>
    </header>
    <section class="download-section" aria-labelledby="install-title">
      <h2 id="install-title">{{ $t('download.installTitle') }}</h2>
      <ol>
        <li>{{ $t('download.step1') }}</li>
        <li>{{ $t('download.step2') }}</li>
        <li>{{ $t('download.step3') }}</li>
      </ol>
      <p>{{ $t('download.updates') }}</p>
      <a :href="`${SITE.repoUrl}/releases`" target="_blank" rel="noopener noreferrer">{{ $t('download.notes') }}</a>
    </section>
    <section class="download-section" aria-labelledby="browser-title">
      <h2 id="browser-title">{{ $t('download.browserTitle') }}</h2>
      <p>{{ $t('download.browserIntro') }}</p>
      <p>{{ $t('download.ios') }}</p>
      <p>{{ $t('download.desktop') }}</p>
    </section>
  </div>
</template>

<style scoped>
.download-page { max-width: 680px; margin: 0 auto; padding: var(--s-6) var(--s-5); }
.download-hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--s-4); padding: var(--s-6) 0 var(--s-7); }
.download-hero img { border-radius: var(--r-lg); }
.download-hero h1 { margin: 0; font-size: clamp(1.6rem, 5vw, 2.1rem); line-height: 1.25; }
.download-hero p { margin: 0; max-width: 34rem; color: var(--text-2); line-height: 1.7; }
.download-action { min-height: 48px; max-width: 100%; white-space: normal; text-align: center; }
.download-requirement { color: var(--text-3); font-size: .875rem; }
.download-section { border-top: 1px solid var(--border); padding: var(--s-6) 0; line-height: 1.8; overflow-wrap: anywhere; }
.download-section h2 { margin: 0 0 var(--s-4); font-size: 1.15rem; line-height: 1.5; }
.download-section p { color: var(--text-2); margin: var(--s-3) 0; }
.download-section ol { padding-inline-start: 1.5rem; margin: 0 0 var(--s-4); }
.download-section li { padding-inline-start: var(--s-1); margin: var(--s-3) 0; }
.download-section a { color: var(--accent-text); display: inline-flex; align-items: center; min-height: 44px; }
</style>
