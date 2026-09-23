<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { communityRequest } from '@/lib/community';
import { pageTitle } from '@/lib/i18n';
import { BADGE_CATEGORIES, FEATURED_LIMIT, type BadgeCollection } from '../../../shared/community-badges';
import BadgeWall from '@/components/BadgeWall.vue';
import BadgeManager from '@/components/BadgeManager.vue';
import CommunityIcon from '@/components/CommunityIcon.vue';
const {t}=useI18n(),{lp}=useLocalePath(),session=useSession();
const data=ref<BadgeCollection|null>(null),selected=ref<string[]>([]),visible=ref(false),busy=ref(false),loading=ref(false),error=ref(''),saved=ref(false),filter=ref('all');
let generation=0;
const dirty=computed(()=>!!data.value&&(JSON.stringify(selected.value)!==JSON.stringify(data.value.featured)||visible.value!==data.value.public));
const items=computed(()=>data.value?.items.filter(b=>filter.value==='all'||(filter.value==='earned'?b.state==='earned':b.state!=='earned'))??[]);
const earned=computed(()=>data.value?.items.filter(b=>b.state==='earned').length??0);
// Catalog order already groups by category; split it into sections without reordering.
const sections=computed(()=>{const out:{category:string;items:typeof items.value}[]=[];for(const b of items.value){const last=out[out.length-1];if(last&&last.category===b.category)last.items.push(b);else out.push({category:b.category,items:[b]});}return out;});
const categoryLabel=(category:string)=>(BADGE_CATEGORIES as readonly string[]).includes(category)?t('badgeWall.category.'+category):category;
async function request<T>(path='',method='GET',body?:unknown){const token=await session.accessToken();if(!token)throw new Error(t('auth.expired'));return communityRequest<T>('/me/community/badges'+path,token,method,body);}
function apply(result:BadgeCollection){data.value=result;selected.value=[...result.featured];visible.value=!!result.public;}
async function load(keepDraft=false){const n=++generation;loading.value=true;error.value='';try{const result=await request<BadgeCollection>();if(n===generation){if(keepDraft&&dirty.value){const valid=new Set(result.items.filter(b=>b.state==='earned').map(b=>b.key));selected.value=selected.value.filter(key=>valid.has(key));data.value=result;}else apply(result);}}catch{if(n===generation)error.value=t('badgeWall.loadFailed');}finally{if(n===generation)loading.value=false;}}
async function save(){if(busy.value)return;busy.value=true;error.value='';saved.value=false;const n=generation;try{const result=await request<BadgeCollection>('/featured','PATCH',{featured:selected.value,public:visible.value});if(n===generation){apply(result);saved.value=true;}}catch{if(n===generation)error.value=t('badgeWall.saveFailed');}finally{busy.value=false;}}
function reset(){if(data.value)apply(data.value);error.value='';saved.value=false;}
watch(()=>session.profile?.handle,()=>{generation++;data.value=null;selected.value=[];visible.value=false;filter.value='all';saved.value=false;void load();},{immediate:true});
watch(()=>t('badgeWall.title'),value=>{document.title=pageTitle(value);},{immediate:true});
</script>
<template>
 <div class="page badges-page">
  <RouterLink class="badges-back" :to="lp('/me')">← {{ t('community.backToProfile') }}</RouterLink>
  <header class="badges-heading"><span class="badges-heading__icon"><CommunityIcon name="award" /></span><div><h1 class="display">{{ t('badgeWall.title') }}</h1><p class="subtle">{{ t('badgeWall.intro') }}</p></div></header>
  <div v-if="loading&&!data" class="badge-loading" aria-live="polite">{{ t('state.loading') }}<div class="ghost" /><div class="ghost" /></div>
  <div v-if="error" class="notice notice--error" role="alert"><p>{{ error }}</p><button class="btn" :disabled="loading||busy" @click="load()">{{ t('badgeWall.reload') }}</button></div>
  <template v-if="data">
   <section class="badge-curation panel">
    <div><h2>{{ t('badgeWall.featuredTitle') }}</h2><p class="subtle">{{ t('badgeWall.featureHint',{count:selected.length,limit:FEATURED_LIMIT}) }}</p></div>
    <label class="badge-visibility"><input v-model="visible" type="checkbox" :disabled="busy" />{{ t('badgeWall.public') }}</label>
    <p class="subtle">{{ t(visible?'badgeWall.publicHint':'badgeWall.privateHint') }}</p>
    <div class="badge-actions"><button class="btn btn--primary" :disabled="busy||!dirty" @click="save">{{ t(busy?'badgeWall.saving':'badgeWall.save') }}</button><button class="btn" :disabled="busy||!dirty" @click="reset">{{ t('badgeWall.reset') }}</button><RouterLink v-if="session.profile?.handle" :to="lp('/authors/'+session.profile.handle)" class="btn">{{ t('me.publicPage') }}</RouterLink></div>
    <p v-if="saved&&!dirty" role="status" class="subtle">{{ t('badgeWall.saved') }}</p><p v-else-if="dirty" role="status" class="subtle">{{ t('badgeWall.unsaved') }}</p>
   </section>
   <div class="badge-collection-heading"><h2>{{ t('badgeWall.collection',{count:earned,total:data.items.length}) }}</h2><div class="badge-filters" :aria-label="t('badgeWall.filter')"><button v-for="key in ['all','earned','locked']" :key="key" class="btn" :aria-pressed="filter===key" @click="filter=key">{{ t('badgeWall.filter.'+key) }}</button></div></div>
   <section v-for="section in sections" :key="section.category" class="badge-section"><h3 class="badge-section__title">{{ categoryLabel(section.category) }}</h3><BadgeWall :items="section.items" :selected="selected" editable :busy="busy" @change="selected=$event;saved=false" /></section>
   <p v-if="!items.length" class="subtle">{{ t('badgeWall.empty') }}</p>
   <nav class="badge-next"><RouterLink :to="lp('/me/community')" class="btn"><CommunityIcon name="discord" />{{ t('badgeWall.connect') }}</RouterLink><RouterLink :to="lp('/mine')" class="btn">{{ t('badgeWall.create') }}</RouterLink></nav>
   <BadgeManager v-if="data.canManage" @changed="load(true)" />
  </template>
 </div>
</template>
<style scoped>
.badges-page{max-width:68rem;display:grid;gap:var(--s-6)}.badges-back{justify-self:start;display:flex;align-items:center;min-height:2.75rem;color:var(--text-2)}.badges-heading{display:flex;gap:var(--s-4);align-items:center}.badges-heading h1{font-size:clamp(1.75rem,4vw,2.25rem);margin:0}.badges-heading p{margin:var(--s-2) 0 0;line-height:1.6}.badges-heading__icon{display:flex;align-items:center;justify-content:center;flex:none;width:3.5rem;height:3.5rem;background:var(--accent-tint);color:var(--accent-text);border-radius:var(--r-lg)}.badges-heading__icon svg{width:2rem;height:2rem}
.badge-curation{padding:var(--s-5);display:grid;gap:var(--s-3)}.badge-curation h2,.badge-collection-heading h2{margin:0;font-size:1.125rem}.badge-curation p{margin:0;line-height:1.6}.badge-visibility{display:flex;align-items:center;gap:var(--s-3);min-height:2.75rem;cursor:pointer}.badge-visibility input{width:1.125rem;height:1.125rem;accent-color:var(--accent)}.badge-actions,.badge-next,.badge-filters{display:flex;gap:var(--s-2);flex-wrap:wrap}.badges-page .btn{min-height:2.75rem;white-space:normal;line-height:1.5}.badge-actions .btn{gap:var(--s-2)}.badge-collection-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--s-4);flex-wrap:wrap}.badge-filters .btn[aria-pressed=true]{border-color:var(--accent);color:var(--accent-text)}.badge-section{display:grid;gap:var(--s-3)}.badge-section__title{margin:0;font-size:.875rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-2)}.badge-next{border-top:1px solid var(--line);padding-top:var(--s-5)}.badge-next .btn{gap:var(--s-2)}.badge-loading{display:grid;gap:var(--s-4)}.badge-loading .ghost{height:12rem;border-radius:var(--r-lg)}
</style>
