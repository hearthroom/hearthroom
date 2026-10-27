<script setup lang="ts">
import { RouterLink } from "vue-router";
import NewMark from "./NewMark.vue";
import { useLocalePath } from "@/lib/use-locale";
import type { FooterLink } from "@/lib/footer-nav";
import { openInstall } from "@/lib/pwa";
import { openRoutesDialog, routesState } from "@/lib/routes";
const props = defineProps<{ link: FooterLink; opener?: () => HTMLElement | null }>();
const emit = defineEmits<{ activate: [] }>();
const { lp } = useLocalePath();
function action() {
  if (!("action" in props.link)) return;
  if (props.link.action === "install") openInstall();
  else { openRoutesDialog(); if (props.opener) routesState.opener = props.opener(); }
  emit("activate");
}
</script>
<template>
  <RouterLink v-if="'to' in link" :data-site-link="link.id" :to="{ path: lp(link.to), query: link.query }" @click="emit('activate')">{{ $t(link.label, link.labelArgs ?? {}) }}<NewMark v-if="link.newMark" :k="link.newMark" /></RouterLink>
  <button v-else-if="'action' in link" :data-site-link="link.id" type="button" @click="action">{{ $t(link.label) }}<span v-if="link.detail" class="site-link-detail">{{ $t(link.detail) }}<span v-if="link.detailHost">{{ link.detailHost }}</span></span></button>
  <a v-else :data-site-link="link.id" :href="link.href" target="_blank" rel="noopener noreferrer" @click="emit('activate')">{{ $t(link.label, link.labelArgs ?? {}) }}</a>
</template>
<style scoped>
.site-link-detail { display: grid; font-size: 12px; color: var(--text-3); margin-inline-start: auto; overflow-wrap: anywhere; }
</style>
