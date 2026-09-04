<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { LOCALES, SOURCE_LOCALE } from "@/lib/i18n";
import { localeOf, withLocale } from "@/router";

const route = useRoute();
const router = useRouter();

/** 換語言就是換網址：連結可以分享，上一頁也回得去。榜單的語區也跟著這裡走。 */
function switchTo(code: string) {
  const current = localeOf(route);
  if (code === current) return;
  const bare = current === SOURCE_LOCALE ? route.path : route.path.replace(`/${current}`, "") || "/";
  router.push({ path: withLocale(bare, code), query: route.query });
}
</script>

<template>
  <div class="lang">
    <svg class="lang__icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M2.75 10h14.5M10 2.75c2.2 2.3 2.2 12.2 0 14.5M10 2.75c-2.2 2.3-2.2 12.2 0 14.5" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
    <!-- 原生 select：小螢幕上有系統原生的選單，也不必自己處理鍵盤與焦點 -->
    <select
      class="lang__select"
      :value="localeOf(route)"
      :aria-label="$t('nav.language')"
      @change="switchTo(($event.target as HTMLSelectElement).value)"
    >
      <!-- 語言名用它自己的語言寫，不翻譯：各語言的使用者都認得自己的 -->
      <option v-for="l in LOCALES" :key="l.code" :value="l.code">{{ l.label }}</option>
    </select>
  </div>
</template>

<style scoped>
.lang { position: relative; display: inline-flex; align-items: center; border-radius: var(--r-pill); }
.lang:hover { background: var(--surface-2); }
.lang__icon { position: absolute; left: 10px; width: 16px; height: 16px; color: var(--text-2); pointer-events: none; }
.lang__select {
  height: 34px; padding: 0 8px 0 32px;
  font: inherit; font-size: 13.5px; font-weight: 500; color: var(--text-2);
  background: transparent; border: 0; border-radius: var(--r-pill);
  cursor: pointer; appearance: none; -webkit-appearance: none;
}
.lang__select:hover { color: var(--text); }
.lang__select option { background: var(--surface); color: var(--text); }
</style>
