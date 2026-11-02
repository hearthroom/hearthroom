<script setup lang="ts">
import { ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { communityRequest } from '@/lib/community';
import type { BadgeCollection } from '../../../shared/community-badges';
import CommunityBadgeList from './CommunityBadgeList.vue';
import CommunityIcon from './CommunityIcon.vue';
const props=defineProps<{handle:string;own?:boolean}>();
const {t}=useI18n(),{lp}=useLocalePath(),session=useSession();
const data=ref<BadgeCollection|null>(null);let generation=0;
async function load(){const n=++generation;data.value=null;try{const token=props.own?await session.accessToken():undefined;if(props.own&&!token)throw new Error('auth');const result=await communityRequest<BadgeCollection>(props.own?'/me/community/badges':'/community/members/'+encodeURIComponent(props.handle)+'/badges',token);if(n===generation)data.value=result;}catch{/* 讀不到就只留入口連結 */}}
watch(()=>[props.handle,props.own],load,{immediate:true});
</script>
<template>
 <template v-if="own">
  <CommunityBadgeList v-if="data" :badges="data.featured" :items="data.items" />
  <RouterLink class="badge-collection-link" :to="lp('/me/badges')"><CommunityIcon name="award" /><span>{{ t('badgeWall.title') }}</span><span aria-hidden="true">→</span></RouterLink>
 </template>
</template>
<style scoped>
.badge-collection-link{display:flex;align-items:center;gap:var(--s-3);min-height:2.75rem;padding:var(--s-3) var(--s-4);border:1px solid var(--line);border-radius:var(--r-sm);color:var(--text)}.badge-collection-link:hover{border-color:var(--accent)}.badge-collection-link span:last-child{margin-left:auto}.badge-collection-link svg{color:var(--accent-text)}
</style>
