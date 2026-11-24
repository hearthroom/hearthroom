<script setup lang="ts">
/**
 * 全部徽章。兩種模式同一個頁面：
 *   自己（/authors/<自己>/badges；舊網址 /me/badges 換成這裡）：展示管理（最多 5 枚）、公開開關、篩選、進度；沒拿過的榜單榮譽收進摺疊區，不攤平 18 枚。
 *   看別人（/authors/:handle/badges）：唯讀，只列已取得（伺服器對外只回已取得、公開的；消費類只在展示時回）。
 * 一個網址：別人看到公開內容，本人看到同一頁多了管理與進度（成就設計 V2 §4）。
 * 依類別分組，順序照目錄（shared/community-badges 的 BADGE_CATEGORIES）；榜單榮譽在類別內照清水→綜合、日→週→月、第一→前十排。
 */
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { communityRequest } from '@/lib/community';
import { pageTitle } from '@/lib/i18n';
import { parseHonorKey, sortHonors } from '@/lib/honors';
import { BADGE_CATEGORIES, FEATURED_LIMIT, type BadgeCollection, type CollectedBadge } from '../../../shared/community-badges';
import BadgeWall from '@/components/BadgeWall.vue';
import CommunityIcon from '@/components/CommunityIcon.vue';

/** 榜單榮譽說明句裡的結構常數（和後端結算一致）：每張卡比 24 小時／7 天／30 天的熱度，同期最後一張比滿的隔天頒發；同期有熱度的卡不足 10 張只發第一名 */
const RANK_RULE = { dayHours: 24, weekDays: 7, monthDays: 30, minCards: 10 };
/** 邀請與消費的數字由 Harbor 分批同步（src/badge-stats.ts 每輪 8 人，約兩天一輪），最慢約 3 天才計入 */
const STATS_SYNC = { days: 3 };

const {t,locale}=useI18n(),{lp}=useLocalePath(),session=useSession(),route=useRoute(),router=useRouter();
const author=computed(()=>typeof route.params.handle==='string'?route.params.handle:'');
const own=computed(()=>!author.value||(!!session.profile?.handle&&author.value===session.profile.handle));
// 舊網址 /me/badges：知道自己的公開 ID 後換成作者頁那一頁，連結與分享都只有一個網址
watch(()=>!author.value&&session.profile?.handle,handle=>{if(handle)void router.replace({path:lp('/authors/'+handle+'/badges'),hash:route.hash});},{immediate:true});
const claimable=computed(()=>own.value?(data.value?.items.filter(b=>b.state==='earned'&&b.reward&&!b.claim)??[]):[]);
const claimTotal=computed(()=>new Intl.NumberFormat(locale.value).format(claimable.value.reduce((n,b)=>n+(b.reward??0),0)));
const claiming=ref(''),claimError=ref('');
/** 領積分：一個請求領完（伺服器自己判斷值多少、先記下再在背景發點）；全部領取不帶 keys，單枚帶那一枚 */
async function claim(keys:string[]|null){if(claiming.value||!own.value)return;claimError.value='';mutations++;const n=generation;claiming.value=keys?.[0]??'*';try{const result=await request<BadgeCollection>('/claim','POST',keys?{keys}:{});if(n!==generation)return;const keep=selected.value,keepVisible=visible.value;data.value=result;selected.value=keep;visible.value=keepVisible;}catch{if(n===generation)claimError.value=t('badgeWall.claimFailed');}finally{claiming.value='';}}
const apTotal=computed(()=>data.value?.ap?new Intl.NumberFormat(locale.value).format(data.value.ap):'');
const data=ref<BadgeCollection|null>(null),selected=ref<string[]>([]),visible=ref(false),busy=ref(false),loading=ref(false),error=ref(''),saved=ref(false),filter=ref('all');
let generation=0;
const dirty=computed(()=>own.value&&!!data.value&&(JSON.stringify(selected.value)!==JSON.stringify(data.value.featured)||visible.value!==data.value.public));
const earnedItems=computed(()=>data.value?.items.filter(b=>b.state==='earned')??[]);
const items=computed(()=>(own.value?data.value?.items.filter(b=>filter.value==='all'||(filter.value==='earned'?b.state==='earned':b.state!=='earned')):earnedItems.value)??[]);
const earned=computed(()=>earnedItems.value.length);
const rankOrder=(list:CollectedBadge[])=>{const parsed=list.map(b=>({b,h:parseHonorKey(b.key)}));const honors=parsed.filter(p=>p.h);if(!honors.length)return list;const sorted=sortHonors(honors.map(p=>({...p.h!,b:p.b}))).map(x=>x.b);return [...sorted,...parsed.filter(p=>!p.h).map(p=>p.b)];};
/** 本人頁：同一系列（同一個計數）的徽章收在一起，在該組第一枚的位置前加小標與說明；其他徽章照原順序 */
function seriesGroups(list:CollectedBadge[]):{series:string;items:CollectedBadge[]}[]{
 if(!own.value)return [{series:'',items:list}];
 const groups:{series:string;items:CollectedBadge[]}[]=[];
 for(const b of list){const series=b.series??'';const found=series?groups.find(g=>g.series===series):undefined;if(found){found.items.push(b);continue;}const last=groups[groups.length-1];if(!series&&last&&!last.series)last.items.push(b);else groups.push({series,items:[b]});}
 return groups;
}
// 切成區塊時類別照第一次出現的順序（伺服器照目錄排）。榜單榮譽裡沒拿過的另外收起來
const sections=computed(()=>{
 const out:{category:string;items:CollectedBadge[];locked:CollectedBadge[];owned:number;total:number;groups:{series:string;items:CollectedBadge[]}[]}[]=[];
 // 依第一次出現的順序分組，同一類別只有一個區塊（不靠清單本身排好）
 for(const b of items.value){let sec=out.find(x=>x.category===b.category);if(!sec){sec={category:b.category,items:[],locked:[],owned:0,total:0,groups:[]};out.push(sec);}(b.category==='rank'&&b.state!=='earned'?sec.locked:sec.items).push(b);}
 for(const s of out){s.items=rankOrder(s.items);s.locked=rankOrder(s.locked);const all=data.value?.items.filter(b=>b.category===s.category)??[];s.owned=all.filter(b=>b.state==='earned').length;s.total=all.length;s.groups=seriesGroups(s.items);}
 return out;
});
const categoryLabel=(category:string)=>(BADGE_CATEGORIES as readonly string[]).includes(category)?t('badgeWall.category.'+category):category;
const hint=(category:string)=>category==='rank'?t('badgeWall.rank.hint',RANK_RULE):category==='spend'?t('badgeWall.spend.hint',STATS_SYNC):category==='invite'?t('badgeWall.invite.hint',STATS_SYNC):'';
async function request<T>(path='',method='GET',body?:unknown){
 if(!own.value)return communityRequest<T>('/community/members/'+encodeURIComponent(author.value)+'/badges');
 const token=await session.accessToken();if(!token)throw new Error(t('auth.expired'));return communityRequest<T>('/me/community/badges'+path,token,method,body);
}
function apply(result:BadgeCollection){data.value=result;selected.value=[...result.featured];visible.value=!!result.public;}
/** 看別人時，沒有成員資料的作者（伺服器回 404）就是沒有公開徽章，顯示空態而不是錯誤 */
/** 本人頁只在換到自己的作者頁網址後才要求刷新（舊網址 /me/badges 會先換網址再讀一次，這一次不占刷新額度） */
async function fetchCollection():Promise<BadgeCollection>{try{return await request<BadgeCollection>(own.value&&author.value?'?refresh=1':'');}catch(e){if(!own.value&&(e as {status?:number})?.status===404)return {items:[],featured:[]};throw e;}}
/** 收下新的一份收藏；編輯中的展示選擇保留（只拿掉已經不是已取得的） */
function receive(result:BadgeCollection,keepDraft:boolean){if(keepDraft&&dirty.value){const valid=new Set(result.items.filter(b=>b.state==='earned').map(b=>b.key));selected.value=selected.value.filter(key=>valid.has(key));data.value=result;}else apply(result);}
async function load(keepDraft=false){const n=++generation;loading.value=true;error.value='';try{const result=await fetchCollection();if(n===generation){receive(result,keepDraft);if(own.value&&result.refreshing)void followRefresh(n);}}catch{if(n===generation)error.value=t('badgeWall.loadFailed');}finally{if(n===generation)loading.value=false;}}
/**
 * 本人打開成就頁：伺服器先回已存的數字，同時在背景向 Harbor 刷新自己（10 分鐘一次，帶 refreshing）。
 * 這裡隔幾秒重讀（不帶 refresh，不再觸發），數字變了才寫「進度已更新」；沒變、失敗、逾時、換頁或使用者動了展示與領取，都直接收起，不出錯誤。
 */
const REREAD={delayMs:4000,attempts:2,shownMs:3000};
const refresh=ref<''|'updating'|'updated'>('');
/** 儲存展示或領積分之後，背景重讀不能再蓋回畫面（重讀可能在寫入前就讀了） */
let mutations=0;
const signature=(c:BadgeCollection)=>c.items.map(b=>`${b.key}:${b.state}:${b.progress?.value??''}:${b.pausedMet?1:0}`).join('|');
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function followRefresh(n:number){
 refresh.value='updating';const before=data.value?signature(data.value):'',edits=mutations;
 const current=()=>n===generation&&edits===mutations;
 try{
  for(let i=0;i<REREAD.attempts;i++){
   await wait(REREAD.delayMs);if(!current())return;
   const result=await request<BadgeCollection>();if(!current())return;
   if(signature(result)!==before){receive(result,true);refresh.value='updated';await wait(REREAD.shownMs);break;}
  }
 }catch{/* 失敗靜默：頁面照舊 */}
 finally{if(n===generation)refresh.value='';}
}
async function save(){if(busy.value||!own.value)return;busy.value=true;error.value='';saved.value=false;mutations++;const n=generation;try{const result=await request<BadgeCollection>('/featured','PATCH',{featured:selected.value,public:visible.value});if(n===generation){apply(result);saved.value=true;}}catch{if(n===generation)error.value=t('badgeWall.saveFailed');}finally{busy.value=false;}}
function reset(){if(data.value)apply(data.value);error.value='';saved.value=false;}
watch(()=>[author.value,own.value?session.profile?.handle:''],()=>{generation++;refresh.value='';data.value=null;selected.value=[];visible.value=false;filter.value='all';saved.value=false;void load();},{immediate:true});
watch(()=>t('badgeWall.title'),value=>{document.title=pageTitle(value);},{immediate:true});
</script>
<template>
 <div class="page badges-page">
  <RouterLink class="badges-back" :to="own&&!author?lp('/me'):lp('/authors/'+author)">← {{ own?t('community.backToProfile'):t('badgeWall.public.back') }}</RouterLink>
  <header class="badges-heading"><span class="badges-heading__icon"><CommunityIcon name="award" /></span><div><h1 class="display">{{ t('badgeWall.title') }}</h1><p v-if="data" class="subtle">{{ apTotal?t('badgeWall.earnedCountPoints',{n:earned,ap:apTotal,level:data.level??1}):t('badgeWall.earnedCount',{n:earned}) }}<template v-if="data.authorRank"> · <RouterLink :to="lp('/achievements?board=author&period=all')">{{ t('achievements.authorRank',{n:data.authorRank}) }}</RouterLink></template></p></div><p v-if="own&&data" class="badges-refresh"><span v-if="refresh==='updating'" class="badges-refresh__dot" aria-hidden="true" /><span v-if="refresh==='updating'">{{ t('badgeWall.updating') }}</span><span aria-live="polite">{{ refresh==='updated'?t('badgeWall.updated'):'' }}</span></p></header>
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
   <section v-if="claimable.length" class="badge-claims panel" aria-live="polite">
    <p>{{ t('badgeWall.claimable',{n:claimable.length}) }}</p>
    <button class="btn btn--primary" :disabled="!!claiming" @click="claim(null)">{{ claiming?t('badgeWall.claiming'):t('badgeWall.claimAll',{total:claimTotal}) }}</button>
   </section>
   <p v-if="claimError" class="notice notice--error" role="alert">{{ claimError }}</p>
   <div v-if="own" class="badge-collection-heading"><h2>{{ t('badgeWall.collection',{count:earned,total:data.items.length}) }}</h2><div class="badge-filters" :aria-label="t('badgeWall.filter')"><button v-for="key in ['all','earned','locked']" :key="key" class="btn" :aria-pressed="filter===key" @click="filter=key">{{ t('badgeWall.filter.'+key) }}</button></div></div>
   <section v-for="section in sections" :key="section.category" class="badge-section">
    <h3 class="badge-section__title"><span class="badge-section__label">{{ categoryLabel(section.category) }}</span><span v-if="own" class="badge-section__count">{{ t('badgeWall.categoryProgress',{owned:section.owned,total:section.total}) }}</span></h3>
    <p v-if="own&&hint(section.category)" class="subtle badge-section__hint">{{ hint(section.category) }}</p>
    <template v-for="group in section.groups" :key="group.series||group.items[0]?.key">
     <div v-if="group.series" class="badge-series"><h4 class="badge-series__title">{{ t('badgeWall.series.'+group.series+'.title') }}</h4><p class="badge-series__note">{{ t('badgeWall.series.'+group.series+'.note') }}</p></div>
     <BadgeWall :items="group.items" :selected="selected" :editable="own" :busy="busy" :claiming="claiming" @change="selected=$event;saved=false" @claim="claim([$event])" />
    </template>
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
.badges-page{max-width:68rem;display:grid;gap:var(--s-6)}.badges-back{justify-self:start;display:flex;align-items:center;min-height:2.75rem;color:var(--text-2)}.badges-heading{display:flex;flex-wrap:wrap;gap:var(--s-4);align-items:center}.badges-heading h1{font-size:clamp(1.75rem,4vw,2.25rem);margin:0}.badges-heading p{margin:var(--s-2) 0 0;line-height:1.6}.badges-heading__icon{display:flex;align-items:center;justify-content:center;flex:none;width:3.5rem;height:3.5rem;background:var(--accent-tint);color:var(--accent-text);border-radius:var(--r-lg)}.badges-heading__icon svg{width:2rem;height:2rem}
.badge-curation{padding:var(--s-5);display:grid;gap:var(--s-3)}.badge-curation h2,.badge-collection-heading h2{margin:0;font-size:1.125rem}.badge-curation p{margin:0;line-height:1.6}.badge-visibility{display:flex;align-items:center;gap:var(--s-3);min-height:2.75rem;cursor:pointer}.badge-visibility input{width:1.125rem;height:1.125rem;accent-color:var(--accent)}.badge-actions,.badge-next,.badge-filters{display:flex;gap:var(--s-2);flex-wrap:wrap}.badges-page .btn{min-height:2.75rem;white-space:normal;line-height:1.5}.badge-actions .btn{gap:var(--s-2)}.badge-collection-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--s-4);flex-wrap:wrap}.badge-filters .btn[aria-pressed=true]{border-color:var(--accent);color:var(--accent-text)}
.badge-section{display:grid;gap:var(--s-3)}.badge-section__title{display:flex;align-items:baseline;gap:var(--s-2);margin:0;font-size:13px;font-weight:600;color:var(--text-2)}.badge-section__count{font-weight:500;color:var(--text-3);font-variant-numeric:tabular-nums}.badge-section__hint{margin:0;line-height:1.6;max-width:44rem}
.badge-locked{display:grid;gap:var(--s-3)}.badge-locked summary{display:flex;align-items:center;min-height:2.75rem;cursor:pointer;color:var(--text-2);font-size:14px;font-weight:600}.badge-locked[open] summary{margin-bottom:var(--s-3)}
.badge-claims{padding:var(--s-4) var(--s-5);display:flex;align-items:center;justify-content:space-between;gap:var(--s-3);flex-wrap:wrap}.badge-claims p{margin:0;line-height:1.6}
.badge-next{border-top:1px solid var(--line);padding-top:var(--s-5)}.badge-next .btn{gap:var(--s-2)}.badge-loading{display:grid;gap:var(--s-4)}.badge-loading .ghost{height:84px;border-radius:var(--r-lg)}
.badge-empty{padding:var(--s-5);display:grid;gap:var(--s-3);justify-items:start}.badge-empty p{margin:0}
.badge-section__hint:lang(ko),.badge-empty p:lang(ko){word-break:keep-all}
.badges-refresh{margin:0 0 0 auto;align-self:center;display:flex;align-items:center;gap:var(--s-2);min-height:1.5rem;font-size:.875rem;color:var(--text-2);white-space:nowrap}.badges-refresh__dot{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:var(--r-pill);animation:badges-spin var(--dur-slow) linear infinite}@keyframes badges-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.badges-refresh__dot{animation:none}}
.badge-series{display:grid;gap:var(--s-1);padding:var(--s-3) var(--s-4);border-radius:var(--r-md);background:var(--surface-2)}.badge-series__title{margin:0;font-size:.9375rem;font-weight:600}.badge-series__note{margin:0;font-size:.8125rem;line-height:1.6;color:var(--text-2)}.badge-series__note:lang(ko){word-break:keep-all}
</style>
