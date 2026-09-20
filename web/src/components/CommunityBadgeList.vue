<script setup lang="ts">
import { computed } from "vue";
import CommunityIcon from "./CommunityIcon.vue";
const props = defineProps<{ badges: string[]; level?: number | null }>();
const visibleBadges = computed(() => [...new Set(props.badges)].filter(b => b === "discord_linked" || b === "first_work" || b === "server_booster"));
const validLevel = computed(() => typeof props.level === "number" && Number.isInteger(props.level) && props.level >= 0 ? props.level : null);
const levelIcon = computed(() => validLevel.value === 0 ? "spark" : (validLevel.value ?? 0) < 5 ? "flame" : (validLevel.value ?? 0) < 10 ? "lantern" : (validLevel.value ?? 0) < 20 ? "star" : "crown");
</script>
<template>
  <div v-if="visibleBadges.length || validLevel !== null" class="community-badges" role="list" :aria-label="$t('community.badgeLabel')">
    <span v-if="validLevel !== null" class="community-badge community-badge--level" role="listitem">
      <CommunityIcon :name="levelIcon" /><span>{{ $t('community.level', { level: validLevel }) }}</span>
    </span>
    <span v-for="badge in visibleBadges" :key="badge" class="community-badge" :class="{ 'community-badge--achievement': badge === 'first_work' || badge === 'server_booster' }" role="listitem">
      <CommunityIcon :name="badge === 'discord_linked' ? 'discord' : badge === 'server_booster' ? 'flame' : 'award'" /><span>{{ $t('community.badges.' + badge) }}</span>
    </span>
  </div>
</template>
<style scoped>
.community-badges { display:flex; flex-wrap:wrap; gap:var(--s-2); }
.community-badge { display:inline-flex; align-items:center; justify-content:center; gap:var(--s-2); max-width:100%; min-height:var(--h-sm); padding:var(--s-1) var(--s-3); border:1px solid var(--line-strong); border-radius:var(--r-pill); background:var(--surface-2); color:var(--text-2); font-size:.875rem; font-weight:500; line-height:1.5; }
.community-badge > span { min-width:0; overflow-wrap:anywhere; }
.community-badge--level { color:var(--accent-text); background:var(--accent-tint); border-color:color-mix(in srgb,var(--accent) 25%,var(--line)); }
.community-badge--achievement { color:var(--text); background:var(--gold-soft); }
.community-badge--achievement svg { color:var(--accent-text); }
</style>
