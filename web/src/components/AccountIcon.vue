<script setup lang="ts">
defineProps<{ name: 'cards' | 'folder' | 'wallet' | 'settings' | 'arrow' | 'external' | 'edit' | 'copy' | 'check' | 'logout' | 'calendar' | 'image' }>();
</script>
<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <template v-if="name === 'cards'"><rect x="7" y="5" width="13" height="16" rx="2"/><path d="M16 5V3H4v15h3M11 10h5M11 14h3"/></template>
    <path v-else-if="name === 'folder'" d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18"/>
    <template v-else-if="name === 'wallet'"><path d="M20 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h15V8H5a3 3 0 0 1-2-3"/><path d="M20 12h-5v5h5"/></template>
    <template v-else-if="name === 'settings'"><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6M16 9v6M10 15v6"/></template>
    <path v-else-if="name === 'arrow'" d="m9 5 7 7-7 7"/>
    <path v-else-if="name === 'external'" d="M14 3h7v7M21 3 11 13M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>
    <path v-else-if="name === 'edit'" d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>
    <template v-else-if="name === 'copy'"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></template>
    <path v-else-if="name === 'check'" d="m5 12 4 4L19 6"/>
    <path v-else-if="name === 'logout'" d="M10 4H4v16h6M9 12h12m-5-5 5 5-5 5"/>
    <template v-else-if="name === 'calendar'"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></template>
    <template v-else-if="name === 'image'"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/></template>
  </svg>
</template>
<style scoped>
svg { width:20px; height:20px; flex:none; display:block; }
</style>
