<script setup lang="ts">
/**
 * 全部徽章。兩種模式同一個頁面：
 *   自己（/me/badges）：展示管理（最多 5 枚）、公開開關、篩選、進度；沒拿過的榜單榮譽收進摺疊區，不攤平 18 枚。
 *   看別人（/authors/:handle/badges）：唯讀，只列已取得（伺服器對外只回已取得、公開的；消費類只在展示時回）。
 * 依類別分組，順序照目錄（shared/community-badges 的 BADGE_CATEGORIES）；榜單榮譽在類別內照清水→綜合、日→週→月、第一→前十排。
 */
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { communityRequest } from '@/lib/community';
import { pageTitle } from '@/lib/i18n';
import { parseHonorKey, sortHonors } from '@/lib/honors';
import { BADGE_CATEGORIES, FEATURED_LIMIT, type BadgeCollection, type CollectedBadge } from '../../../shared/community-badges';
import BadgeWall from '@/components/BadgeWall.vue';
import CommunityIcon from '@/components/CommunityIcon.vue';

/** 榜單榮譽說明句裡的結構常數（和後端結算一致）：日榜在當天結束後 24 小時、週榜在該週結束後 7 天、月榜在該月結束後 30 天頒發；同期不足 10 張只發第一名 */
const RANK_RULE = { dayHours: 24, weekDays: 7, monthDays: 30, minCards: 10 };

const {t}=useI18n(),{lp}=useLocalePath(),session=useSession(),route=useRoute();
const author=computed(()=>typeof route.params.handle==='string'?route.params.handle:'');
const own=computed(()=>!author.value);
const data=ref<BadgeCollection|null>(null),selected=ref<string[]>([]),visible=ref(false),busy=ref(false),loading=ref(false),error=ref(''),saved=ref(false),filter=ref('all');
let generation=0;
const dirty=computed(()=>own.value&&!!data.value&&(JSON.stringify(selected.value)!==JSON.stringify(data.value.featured)||visible.value!==data.value.public));
const earnedItems=computed(()=>data.value?.items.filter(b=>b.state==='earned')??[]);
const items=computed(()=>(own.value?data.value?.items.filter(b=>filter.value==='all'||(filter.value==='earned'?b.state==='earned':b.state!=='earned')):earnedItems.value)??[]);
const earned=computed(()=>earnedItems.value.length);
const rankOrder=(list:CollectedBadge[])=>{const parsed=list.map(b=>({b,h:parseHonorKey(b.key)}));const honors=parsed.filter(p=>p.h);if(!honors.length)return list;const sorted=sortHonors(honors.map(p=>({...p.h!,b:p.b}))).map(x=>x.b);return [...sorted,...parsed.filter(p=>!p.h).map(p=>p.b)];};
// 切成區塊時類別照第一次出現的順序（伺服器照目錄排）。榜單榮譽裡沒拿過的另外收起來
const sections=computed(()=>{
 const out:{category:string;items:CollectedBadge[];locked:CollectedBadge[];owned:number;total:number}[]=[];
 // 依第一次出現的順序分組，同一類別只有一個區塊（不靠清單本身排好）
 for(const b of items.value){let sec=out.find(x=>x.category===b.category);if(!sec){sec={category:b.category,items:[],locked:[],owned:0,total:0};out.push(sec);}(b.category==='rank'&&b.state!=='earned'?sec.locked:sec.items).push(b);}
 for(const s of out){s.items=rankOrder(s.items);s.locked=rankOrder(s.locked);const all=data.value?.items.filter(b=>b.category===s.category)??[];s.owned=all.filter(b=>b.state==='earned').length;s.total=all.length;}
 return out;
});
const categoryLabel=(category:string)=>(BADGE_CATEGORIES as readonly string[]).includes(category)?t('badgeWall.category.'+category):category;
const hint=(category:string)=>category==='rank'?t('badgeWall.rank.hint',RANK_RULE):category==='spend'?t('badgeWall.spend.hint'):'';
async function request<T>(path='',method='GET',body?:unknown){
 if(!own.value)return communityRequest<T>('/community/members/'+encodeURIComponent(author.value)+'/badges');
 const token=await session.accessToken();if(!token)throw new Error(t('auth.expired'));return communityRequest<T>('/me/community/badges'+path,token,method,body);
}
function apply(result:BadgeCollection){data.value=result;selected.value=[...result.featured];visible.value=!!result.public;}
/** 看別人時，沒有成員資料的作者（伺服器回 404）就是沒有公開徽章，顯示空態而不是錯誤 */
async function fetchCollection():Promise<BadgeCollection>{try{return await request<BadgeCollection>();}catch(e){if(!own.value&&(e as {status?:number})?.status===404)return {items:[],featured:[]};throw e;}}
async function load(keepDraft=false){const n=++generation;loading.value=true;error.value='';try{const result=await fetchCollection();if(n===generation){if(keepDraft&&dirty.value){const valid=new Set(result.items.filter(b=>b.state==='earned').map(b=>b.key));selected.value=selected.value.filter(key=>valid.has(key));data.value=result;}else apply(result);}}catch{if(n===generation)error.value=t('badgeWall.loadFailed');}finally{if(n===generation)loading.value=false;}}
async function save(){if(busy.value||!own.value)return;busy.value=true;error.value='';saved.value=false;const n=generation;try{const result=await request<BadgeCollection>('/featured','PATCH',{featured:selected.value,public:visible.value});if(n===generation){apply(result);saved.value=true;}}catch{if(n===generation)error.value=t('badgeWall.saveFailed');}finally{busy.value=false;}}
function reset(){if(data.value)apply(data.value);error.value='';saved.value=false;}
watch(()=>[author.value,own.value?session.profile?.handle:''],()=>{generation++;data.value=null;selected.value=[];visible.value=false;filter.value='all';saved.value=false;void load();},{immediate:true});
watch(()=>t('badgeWall.title'),value=>{document.title=pageTitle(value);},{immediate:true});
</script>
<template>
 <div class="page badges-page">
  <RouterLink class="badges-back" :to="own?lp('/me'):lp('/authors/'+author)">← {{ own?t('community.backToProfile'):t('badgeWall.public.back') }}</RouterLink>
  <header class="badges-heading"><span class="badges-heading__icon"><CommunityIcon name="award" /></span><div><h1 class="display">{{ t('badgeWall.title') }}</h1><p v-if="data" class="subtle">{{ t('badgeWall.earnedCount',{n:earned}) }}</p></div></header>
  <div v-if="loading&&!data" class="badge-loading" aria-live="polite"><span class="sr-only">{{ t('state.loading') }}</span><div v-for="i in 3" :key="i" class="ghost" /></div>
  <div v-if="error" class="notice notice--error" role="alert"><p>{{ error }}</p><button class="btn" :disabled="loading||busy" @click="load()">{{ t(own?'badgeWall.reload':'badgeWall.retry') }}</button></div>
  <template v-if="data">
   <section v-if="own" class="badge-curation panel">
    <div><h2>{{ t('badgeWall.featuredTitle') }}</h2><p class="subtle">{{ t('badgeWall.featureHint',{count:selected.length,limit:FEATURED_LIMIT}) }}</p></div>
    <label class="badge-visibility"><input v-model="visible" type="checkbox" :disabled="busy" />{{ t('badgeWall.public') }}</label>
    <p class="subtle">{{ t(visible?'badgeWall.publicHint':'badgeWall.privateHint') }}</p>
    <div class="badge-actions"><button class="btn btn--primary" :disabled="busy||!dirty" @click="save">{{ t(busy?'badgeWall.saving':'badgeWall.save') }}</button><button class="btn" :disabled="busy||!dirty" @click="reset">{{ t('badgeWall.reset') }}</button><RouterLink v-if="session.profile?.handle" :to="lp('/authors/'+session.profile.handle)" class="btn">{{ t('me.publicPage') }}</RouterLink></div>
    <p v-if="saved&&!dirty" role="status" class="subtle">{{ t('badgeWall.saved') }}</p><p v-else-if="dirty" role="status" class="subtle">{{ t('badgeWall.unsaved') }}</p>
   </section>
   <div v-if="own" class="badge-collection-heading"><h2>{{ t('badgeWall.collection',{count:earned,total:data.items.length}) }}</h2><div class="badge-filters" :aria-label="t('badgeWall.filter')"><button v-for="key in ['all','earned','locked']" :key="key" class="btn" :aria-pressed="filter===key" @click="filter=key">{{ t('badgeWall.filter.'+key) }}</button></div></div>
   <section v-for="section in sections" :key="section.category" class="badge-section">
    <h3 class="badge-section__title"><span class="badge-section__label">{{ categoryLabel(section.category) }}</span><span v-if="own" class="badge-section__count">{{ t('badgeWall.categoryProgress',{owned:section.owned,total:section.total}) }}</span></h3>
    <p v-if="own&&hint(section.category)" class="subtle badge-section__hint">{{ hint(section.category) }}</p>
    <BadgeWall v-if="section.items.length" :items="section.items" :selected="selected" :editable="own" :busy="busy" @change="selected=$event;saved=false" />
    <details v-if="section.locked.length" class="badge-locked">
     <summary>{{ t('badgeWall.rank.locked',{n:section.locked.length}) }}</summary>
     <BadgeWall :items="section.locked" :selected="selected" :editable="own" :busy="busy" @change="selected=$event;saved=false" />
    </details>
   </section>
   <div v-if="!own&&!items.length" class="badge-empty panel"><p>{{ t('badgeWall.public.empty') }}</p><RouterLink class="btn" :to="lp('/authors/'+author)">{{ t('badgeWall.public.back') }}</RouterLink></div>
   <p v-else-if="!items.length" class="subtle">{{ t('badgeWall.empty') }}</p>
   <nav v-if="own" class="badge-next"><RouterLink :to="lp('/me/community')" class="btn"><CommunityIcon name="discord" />{{ t('badgeWall.connect') }}</RouterLink><RouterLink :to="lp('/mine')" class="btn">{{ t('badgeWall.create') }}</RouterLink></nav>
  </template>
 </div>
</template>
<style scoped>
.badges-page{max-width:68rem;display:grid;gap:var(--s-6)}.badges-back{justify-self:start;display:flex;align-items:center;min-height:2.75rem;color:var(--text-2)}.badges-heading{display:flex;gap:var(--s-4);align-items:center}.badges-heading h1{font-size:clamp(1.75rem,4vw,2.25rem);margin:0}.badges-heading p{margin:var(--s-2) 0 0;line-height:1.6}.badges-heading__icon{display:flex;align-items:center;justify-content:center;flex:none;width:3.5rem;height:3.5rem;background:var(--accent-tint);color:var(--accent-text);border-radius:var(--r-lg)}.badges-heading__icon svg{width:2rem;height:2rem}
.badge-curation{padding:var(--s-5);display:grid;gap:var(--s-3)}.badge-curation h2,.badge-collection-heading h2{margin:0;font-size:1.125rem}.badge-curation p{margin:0;line-height:1.6}.badge-visibility{display:flex;align-items:center;gap:var(--s-3);min-height:2.75rem;cursor:pointer}.badge-visibility input{width:1.125rem;height:1.125rem;accent-color:var(--accent)}.badge-actions,.badge-next,.badge-filters{display:flex;gap:var(--s-2);flex-wrap:wrap}.badges-page .btn{min-height:2.75rem;white-space:normal;line-height:1.5}.badge-actions .btn{gap:var(--s-2)}.badge-collection-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--s-4);flex-wrap:wrap}.badge-filters .btn[aria-pressed=true]{border-color:var(--accent);color:var(--accent-text)}
.badge-section{display:grid;gap:var(--s-3)}.badge-section__title{display:flex;align-items:baseline;gap:var(--s-2);margin:0;font-size:13px;font-weight:600;color:var(--text-2)}.badge-section__count{font-weight:500;color:var(--text-3);font-variant-numeric:tabular-nums}.badge-section__hint{margin:0;line-height:1.6;max-width:44rem}
.badge-locked{display:grid;gap:var(--s-3)}.badge-locked summary{display:flex;align-items:center;min-height:2.75rem;cursor:pointer;color:var(--text-2);font-size:14px;font-weight:600}.badge-locked[open] summary{margin-bottom:var(--s-3)}
.badge-next{border-top:1px solid var(--line);padding-top:var(--s-5)}.badge-next .btn{gap:var(--s-2)}.badge-loading{display:grid;gap:var(--s-4)}.badge-loading .ghost{height:84px;border-radius:var(--r-lg)}
.badge-empty{padding:var(--s-5);display:grid;gap:var(--s-3);justify-items:start}.badge-empty p{margin:0}
</style>
