<script setup lang="ts">
import {ref,watch} from 'vue';
import type {SpendPlayer} from '@/lib/spend-leaderboard';
const props=defineProps<{player:SpendPlayer}>(),failed=ref(false);
watch(()=>props.player.avatarUrl,()=>failed.value=false);
</script>
<template><span class="spend-avatar" aria-hidden="true">
 <svg v-if="player.anonymous" data-anonymous-avatar viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>
 <img v-else-if="player.avatarUrl&&!failed" :src="player.avatarUrl" alt="" @error="failed=true" />
 <span v-else>{{ [...(player.nickname||'?')][0] }}</span>
</span></template>
<style scoped>
.spend-avatar{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;border-radius:var(--r-pill);background:var(--surface-2);color:var(--text-2);overflow:hidden;font-weight:600}.spend-avatar svg{width:65%;height:65%}.spend-avatar img{width:100%;height:100%;object-fit:cover}
</style>
