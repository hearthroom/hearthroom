<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { LOCALES, SOURCE_LOCALE } from "@/lib/i18n";
import { localeOf, withLocale } from "@/router";

const route = useRoute();
const router = useRouter();

/** 換語言就是換網址：連結可以分享，上一頁也回得去。 */
function switchTo(code: string) {
  const current = localeOf(route);
  if (code === current) return;
  const bare = current === SOURCE_LOCALE ? route.path : route.path.replace(`/${current}`, "") || "/";
  router.push({ path: withLocale(bare, code), query: route.query });
}
</script>

<template>
  <div class="lang">
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
.lang { display: inline-flex; }
.lang__select {
  height: 30px; padding: 0 var(--s-2);
  font: inherit; font-size: 13px; color: var(--text-dim);
  background: transparent; border: 1px solid transparent; border-radius: var(--r-pill);
  cursor: pointer;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.lang__select:hover { color: var(--text); border-color: var(--rule-strong); }
.lang__select option { background: var(--paper-raised); color: var(--text); }
</style>
