<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { LOCALES, SOURCE_LOCALE } from "@/lib/i18n";
import { localeOf, withLocale } from "@/router";

const route = useRoute();
const router = useRouter();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const current = computed(() => localeOf(route));
const label = computed(() => LOCALES.find((l) => l.code === current.value)?.label ?? current.value);

/** 換語言就是換網址：連結可以分享，上一頁也回得去。榜單的語區也跟著這裡走。 */
function switchTo(code: string) {
  open.value = false;
  if (code === current.value) return;
  const bare = current.value === SOURCE_LOCALE ? route.path : route.path.replace(`/${current.value}`, "") || "/";
  router.push({ path: withLocale(bare, code), query: route.query });
}

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}
onMounted(() => { document.addEventListener("click", onDocClick); document.addEventListener("keydown", onKey); });
onBeforeUnmount(() => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); });
</script>

<template>
  <div ref="root" class="lang">
    <button class="lang__btn" :aria-label="$t('nav.language')" aria-haspopup="menu" :aria-expanded="open" @click="open = !open">
      <svg class="lang__icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M2.75 10h14.5M10 2.75c2.2 2.3 2.2 12.2 0 14.5M10 2.75c-2.2 2.3-2.2 12.2 0 14.5" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
      <span class="lang__label">{{ label }}</span>
      <svg class="lang__chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>

    <ul v-if="open" class="lang__menu panel" role="menu">
      <!-- 語言名用它自己的語言寫，不翻譯：各語言的使用者都認得自己的 -->
      <li v-for="l in LOCALES" :key="l.code" role="none">
        <button class="lang__item" :class="{ 'is-on': l.code === current }" :lang="l.code" role="menuitemradio" :aria-checked="l.code === current" @click="switchTo(l.code)">
          <span>{{ l.label }}</span>
          <svg v-if="l.code === current" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.lang { position: relative; }
.lang__btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 8px 0 10px;
  background: transparent; border: 0; border-radius: var(--r-pill);
  font: inherit; font-size: 13.5px; font-weight: 500; color: var(--text-2);
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.lang__btn:hover, .lang__btn[aria-expanded="true"] { background: var(--surface-2); color: var(--text); }
.lang__icon { width: 16px; height: 16px; }
.lang__chev { width: 12px; height: 12px; color: var(--text-3); transition: transform var(--dur) var(--ease); }
.lang__btn[aria-expanded="true"] .lang__chev { transform: rotate(180deg); }

.lang__menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
  min-width: 168px; margin: 0; padding: 6px; list-style: none;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: pop var(--dur) var(--ease);
}
.lang__item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; padding: 8px 10px;
  background: none; border: 0; border-radius: var(--r-sm);
  font: inherit; font-size: 13.5px; color: var(--text); text-align: left; cursor: pointer;
}
.lang__item:hover { background: var(--surface-2); }
.lang__item.is-on { font-weight: 600; color: var(--accent-text); }
.lang__item svg { width: 14px; height: 14px; flex: none; }
@keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }

@media (max-width: 860px) { .lang__label { display: none; } .lang__btn { padding: 0 8px; } }
</style>
