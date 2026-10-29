<script setup lang="ts">
import type {SpendPlayer} from '@/lib/spend-leaderboard';
import CommunityAvatar from './CommunityAvatar.vue';
defineProps<{player:SpendPlayer}>();
</script>
<template>
 <span v-if="player.anonymous" class="spend-avatar spend-avatar--anonymous" aria-hidden="true"><svg data-anonymous-avatar viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg></span>
 <CommunityAvatar v-else class="spend-avatar" :handle="player.handle" :src="player.avatarUrl" :name="player.nickname" aria-hidden="true" />
</template>
<style scoped>
.spend-avatar{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;border-radius:var(--r-pill);background:var(--surface-2);color:var(--text-2);font-weight:600}.spend-avatar--anonymous{overflow:hidden}.spend-avatar svg{width:65%;height:65%}
</style>
