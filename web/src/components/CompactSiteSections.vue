<script setup lang="ts">
import { computed } from "vue";
import { useSiteLinks } from "@/lib/site-links";
import SiteLink from "./SiteLink.vue";
defineProps<{ opener?: () => HTMLElement | null }>();
const emit = defineEmits<{ activate: []; appearance: []; language: [] }>();
const { links } = useSiteLinks();
const pick = (ids: string[]) => computed(() => ids.flatMap(id => links.value.filter(link => link.id === id)));
const routes = pick(['routes']);
const community = pick(['guide', 'campaign', 'blog', 'updates', 'discord']);
const developers = pick(['developers']);
const support = pick(['download', 'install', 'github', 'issues']);
const legal = pick(['privacy', 'license']);
</script>
<template>
  <div class="compact-group" data-menu-section="preferences">
    <p class="compact-label">{{ $t('home.preferences') }}</p>
    <button type="button" role="menuitem" @click="emit('appearance')">{{ $t('appearance.title') }}</button>
    <button type="button" role="menuitem" @click="emit('language')">{{ $t('nav.language') }}</button>
    <SiteLink v-for="link in routes" :key="link.id" :link="link" :opener="opener" @activate="emit('activate')" />
    <slot name="settings" />
  </div>
  <div class="compact-group" data-menu-section="community">
    <p class="compact-label">{{ $t('home.createCommunity') }}</p>
    <SiteLink v-for="link in community" :key="link.id" :link="link" :opener="opener" @activate="emit('activate')" />
  </div>
  <details class="compact-other">
    <summary>{{ $t('home.otherInfo') }}</summary>
    <div v-for="group in [{ id: 'developers', title: 'home.developerGroup', links: developers }, { id: 'support', title: 'home.siteSupportGroup', links: support }, { id: 'legal', title: 'home.legalGroup', links: legal }]" :key="group.id" class="compact-group" :data-menu-section="group.id">
      <p class="compact-label">{{ $t(group.title) }}</p>
      <SiteLink v-for="link in group.links" :key="link.id" :link="link" :opener="opener" @activate="emit('activate')" />
    </div>
  </details>
</template>
<style scoped>
.compact-group { display: grid; padding-top: var(--s-2); margin-top: var(--s-2); border-top: 1px solid var(--line); }
.compact-label { margin: var(--s-1) var(--s-2); font-size: 12px; font-weight: 600; color: var(--text-3); }
.compact-group :deep(a), .compact-group :deep(button), .compact-group :slotted(a) { display: flex; align-items: center; gap: var(--s-2); min-height: var(--h-lg); width: 100%; padding: var(--s-2); background: none; border: 0; border-radius: var(--r-sm); color: var(--text); font: inherit; font-size: 14px; text-align: start; cursor: pointer; overflow-wrap: anywhere; }
.compact-group :deep(a:hover), .compact-group :deep(button:hover) { background: var(--surface-2); }
.compact-other { margin-top: var(--s-2); border-top: 1px solid var(--line); }
.compact-other summary { min-height: var(--h-lg); padding: var(--s-3) var(--s-2); cursor: pointer; font-size: 14px; overflow-wrap: anywhere; }
:lang(ko) { word-break: keep-all; overflow-wrap: anywhere; }
</style>
