<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useSiteLinks, petMenuKey } from "@/lib/site-links";
import SiteLink from "./SiteLink.vue";
/**
 * noPetMenu：帳號選單用。登入的人找不到蘇綺時走「使用者設定 › 疑難排解」（settings-ia），偏好設定裡不再放救援鈕；
 * 沒登入的訪客進不了設定頁，網站選單照舊留著這一項。
 */
const props=defineProps<{ opener?: () => HTMLElement | null; noPetMenu?: boolean }>();
const emit = defineEmits<{ activate: []; appearance: []; language: [] }>();
const { links } = useSiteLinks();
const petPage=inject(petMenuKey,computed(()=>false));
const petMenu=computed(()=>!props.noPetMenu&&petPage.value);
const emitPet=()=>{emit("activate");setTimeout(()=>openPetMenu(props.opener?.()??null),0);};
import {openPetMenu, petEnabled} from "@/pet/enabled";
const pick = (ids: string[]) => computed(() => ids.flatMap(id => links.value.filter(link => link.id === id).map(link => link.id === "updates" && "to" in link ? { ...link, query: { ...link.query, from: "menu" } } : link)));
const otherOpen = ref(false);
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
    <button v-if="petMenu" type="button" role="menuitem" data-pet-menu @click="emitPet">{{ $t(petEnabled ? "mascot.pet.openMenu" : "mascot.pet.bringBack") }}</button>
    <SiteLink v-for="link in routes" :key="link.id" :link="link" :opener="opener" @activate="emit('activate')" />
    <slot name="settings" />
  </div>
  <div class="compact-group" data-menu-section="community">
    <p class="compact-label">{{ $t('home.createCommunity') }}</p>
    <SiteLink v-for="link in community" :key="link.id" :link="link" :opener="opener" @activate="emit('activate')" />
  </div>
  <details class="compact-other" @toggle="otherOpen = ($event.target as HTMLDetailsElement).open">
    <summary>{{ $t('home.otherInfo') }}</summary>
    <div v-for="group in [{ id: 'developers', title: 'home.developerGroup', links: developers }, { id: 'support', title: 'home.siteSupportGroup', links: support }, { id: 'legal', title: 'home.legalGroup', links: legal }]" :key="group.id" v-show="otherOpen" class="compact-group" :data-menu-section="group.id">
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
