<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CompactSiteSections from "./CompactSiteSections.vue";
import AppearanceMenu from "./AppearanceMenu.vue";
import LocaleSwitch from "./LocaleSwitch.vue";
import { navigateMenu } from "@/lib/menu-navigation";
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const appearance = ref<InstanceType<typeof AppearanceMenu> | null>(null);
const language = ref<InstanceType<typeof LocaleSwitch> | null>(null);
import { useHeaderOverlay } from "@/lib/site-links";
const open = ref(false), top = ref(0);
useHeaderOverlay(open);
watch(open, async value => { if (value) { await nextTick(); top.value = menu.value?.getBoundingClientRect().top ?? 0; } });
const opener = () => trigger.value;
function menuKey(e: KeyboardEvent) { if (open.value && menu.value) navigateMenu(e, menu.value); }
function preference(which: "appearance" | "language") {
  open.value = false;
  // A microtask can run before the document click listener; hand off after dispatch.
  setTimeout(() => (which === "appearance" ? appearance.value : language.value)?.openFrom(trigger.value), 0);
}
function outside(e: MouseEvent) { if (!root.value?.contains(e.target as Node)) open.value = false; }
function key(e: KeyboardEvent) { if (e.key === "Escape" && open.value) { open.value = false; trigger.value?.focus(); } }
function focusOut(e: FocusEvent) { if (e.relatedTarget && !root.value?.contains(e.relatedTarget as Node)) open.value = false; }
onMounted(() => { document.addEventListener("click", outside); document.addEventListener("keydown", key); });
onBeforeUnmount(() => { document.removeEventListener("click", outside); document.removeEventListener("keydown", key); });
</script>
<template>
  <div ref="root" class="site-menu" @keydown="menuKey">
    <button ref="trigger" class="btn btn--ghost btn--icon" type="button" :aria-label="$t('home.guestMenu')" aria-haspopup="menu" :aria-expanded="open" @click="open = !open">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" /></svg>
    </button>
    <div v-if="open" ref="menu" class="site-menu__panel panel" role="menu" data-discovery-overlay :style="{ '--menu-top': `${top}px` }" @focusout="focusOut">
      <CompactSiteSections :opener="opener" @activate="open = false" @appearance="preference('appearance')" @language="preference('language')" />
    </div>
    <AppearanceMenu ref="appearance" external />
    <LocaleSwitch ref="language" external />
  </div>
</template>
<style scoped>
.site-menu { position: relative; }
.site-menu > .btn { width: var(--h-lg); height: var(--h-lg); }
.site-menu__panel { position: fixed; top: calc(var(--site-header-h, var(--header-h)) + var(--s-2)); right: var(--s-3); z-index: 40; width: min(280px, calc(100vw - 24px)); max-height: calc(100dvh - var(--site-header-h, var(--header-h)) - var(--s-5)); overflow-y: auto; padding: var(--s-2); box-shadow: var(--shadow-md); }
</style>
