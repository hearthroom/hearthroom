<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { BADGE_ICONS, badgeText, type CollectedBadge } from "../../../shared/community-badges";
const { locale, t } = useI18n();
import CommunityIcon from "./CommunityIcon.vue";
const props = defineProps<{ badges: string[]; level?: number | null; items?: CollectedBadge[] }>();
const visibleBadges = computed(() => [...new Set(props.badges)].filter(b => b === "discord_linked" || b === "first_work" || b === "server_booster" || props.items?.some(item=>item.key===b && BADGE_ICONS.includes(item.icon))));
const metadata=(key:string)=>props.items?.find(item=>item.key===key);
const badgeIcon=(key:string)=>metadata(key)?.icon ?? (key==='discord_linked'?'discord':key==='server_booster'?'flame':'award');
const badgeLabel=(key:string)=>metadata(key)?badgeText(metadata(key)!.titles,locale.value):t('community.badges.'+key);
const validLevel = computed(() => typeof props.level === "number" && Number.isInteger(props.level) && props.level >= 0 ? props.level : null);
const levelIcon = computed(() => validLevel.value === 0 ? "spark" : (validLevel.value ?? 0) < 5 ? "flame" : (validLevel.value ?? 0) < 10 ? "lantern" : (validLevel.value ?? 0) < 20 ? "star" : "crown");
</script>
<template>
  <div v-if="visibleBadges.length || validLevel !== null" class="community-badges" role="list" :aria-label="$t('community.badgeLabel')">
    <span v-if="validLevel !== null" class="community-badge community-badge--level" role="listitem">
      <CommunityIcon :name="levelIcon" /><span>{{ $t('community.level', { level: validLevel }) }}</span>
    </span>
    <span v-for="badge in visibleBadges" :key="badge" class="community-badge" :class="{ 'community-badge--achievement': badge === 'first_work' || badge === 'server_booster' }" role="listitem">
      <CommunityIcon :name="badgeIcon(badge)" /><span>{{ badgeLabel(badge) }}</span>
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
