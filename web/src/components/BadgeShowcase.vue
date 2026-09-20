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
import BadgeWall from './BadgeWall.vue';
const props=defineProps<{handle:string;own?:boolean;wall?:boolean}>();
const {t}=useI18n(),{lp}=useLocalePath(),session=useSession();
const data=ref<BadgeCollection|null>(null),error=ref(false);let generation=0;
async function load(){const n=++generation;data.value=null;error.value=false;try{const token=props.own?await session.accessToken():undefined;if(props.own&&!token)throw new Error('auth');const result=await communityRequest<BadgeCollection>(props.own?'/me/community/badges':'/community/members/'+encodeURIComponent(props.handle)+'/badges',token);if(n===generation)data.value=result;}catch{if(n===generation)error.value=true;}}
watch(()=>[props.handle,props.own],load,{immediate:true});
</script>
<template>
 <section v-if="wall && data?.items.length" class="badge-showcase">
  <h2>{{ t('badgeWall.title') }}</h2><BadgeWall :items="data.items" :selected="data.featured" />
 </section>
 <template v-else-if="own">
  <CommunityBadgeList v-if="data" :badges="data.featured" :items="data.items" />
  <RouterLink class="badge-collection-link" :to="lp('/me/badges')"><CommunityIcon name="award" /><span>{{ t('badgeWall.title') }}</span><span aria-hidden="true">→</span></RouterLink>
 </template>
 <div v-if="wall && error" class="badge-showcase subtle"><p>{{ t('badgeWall.loadFailed') }}</p><button class="btn" @click="load">{{ t('badgeWall.retry') }}</button></div>
</template>
<style scoped>
.badge-showcase{margin-block:var(--s-6)}.badge-showcase h2{font-size:1.25rem;margin-bottom:var(--s-4)}.badge-collection-link{display:flex;align-items:center;gap:var(--s-3);min-height:2.75rem;padding:var(--s-3) var(--s-4);border:1px solid var(--line);border-radius:var(--r-sm);color:var(--text)}.badge-collection-link:hover{border-color:var(--accent)}.badge-collection-link span:last-child{margin-left:auto}.badge-collection-link svg{color:var(--accent-text)}
</style>
