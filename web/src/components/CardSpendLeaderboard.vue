<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue';
import {useI18n} from 'vue-i18n';
import {useSession} from '@/lib/session';
import {useLocalePath} from '@/lib/use-locale';
import {useRoute} from 'vue-router';
import {loginPath} from '@/lib/login-return';
import {wrapTab} from '@/lib/focus-trap';
import {fetchSpendBoard,formatCredits,isAnonymous,type SpendBoard} from '@/lib/spend-leaderboard';
import SpendPlayer from './SpendPlayer.vue';
import SpendAvatar from './SpendAvatar.vue';
import LeaderboardPrivacy from './LeaderboardPrivacy.vue';
const props=defineProps<{cardId:string;playUrl?:string}>();
const {t,locale}=useI18n(),session=useSession(),{lp}=useLocalePath(),route=useRoute();
const board=ref<SpendBoard|null>(null),loading=ref(false),showLoading=ref(false),error=ref(false),moreError=ref(false);
const open=ref(false),privacy=ref(false),dialog=ref<HTMLElement|null>(null);
const podiumWidth=ref(0),mobileTop=ref<HTMLElement|null>(null),mobileTitle=ref<HTMLElement|null>(null),mobileAvatars=ref(0);
let mobileObserver:ResizeObserver|null=null;
const titleId='spend-board-'+crypto.randomUUID();
let generation=0,opener:HTMLElement|null=null,overflow='',background:HTMLElement|null=null,previousInert=false;
let sheetObserver:ResizeObserver|null=null;
const mine=computed(()=>{
 if(!board.value)return t('spendBoard.'+(error.value?'shortError':'shortLoading'));
 const b=board.value;
 return b.self?t('spendBoard.myRank',{rank:b.self.rank}):t('spendBoard.'+({guest:'guest',author:'author',test:'test',ranked:'shortUnranked',unranked:'shortUnranked'}[b.selfState]));
});
const compactMine=computed(()=>board.value&&['author','test'].includes(board.value.selfState)?t('spendBoard.excluded'):mine.value);
function fitMobileAvatars(){
 if(!mobileTop.value||!mobileTitle.value)return;
 const available=mobileTop.value.clientWidth-mobileTitle.value.getBoundingClientRect().width-8;
 mobileAvatars.value=Math.max(0,Math.min(3,Math.floor(available/24)));
}
watch(mobileTop,element=>{mobileObserver?.disconnect();if(element){mobileObserver=new ResizeObserver(fitMobileAvatars);mobileObserver.observe(element);fitMobileAvatars()}});
watch(locale,async()=>{await nextTick();fitMobileAvatars()});
const podium=computed(()=>{
 if(!board.value||board.value.total<3||!dialog.value||!podiumWidth.value)return false;
 const context=document.createElement('canvas').getContext('2d');if(!context)return false;
 context.font=`12px ${getComputedStyle(dialog.value).fontFamily}`;
 const width=(podiumWidth.value-16)/3-8;
 return board.value.list.slice(0,3).every(p=>formatCredits(p.credits,locale.value).length<=16&&context.measureText(t('spendBoard.'+(p.credits==='1'?'pointsAmountOne':'pointsAmount'),{points:formatCredits(p.credits,locale.value)})).width<=width);
});
async function load(more=false){
 const id=props.cardId,current=more?generation:++generation;
 if(!more)board.value=null;
 loading.value=true;error.value=false;moreError.value=false;
 const timer=setTimeout(()=>{if(current===generation)showLoading.value=true},200);
 try{
  const value=await fetchSpendBoard(id,await session.accessToken()??undefined,more?board.value?.nextOffset??0:0);
  if(current!==generation||id!==props.cardId)return;
  board.value=more&&board.value?{...value,list:[...board.value.list,...value.list]}:value;
 }catch{if(current===generation){if(more)moreError.value=true;else error.value=true;}}
 finally{clearTimeout(timer);if(current===generation){loading.value=false;showLoading.value=false;}}
}
async function show(event?:Event){
 opener=event?.currentTarget instanceof HTMLElement?event.currentTarget:document.activeElement instanceof HTMLElement?document.activeElement:null;open.value=true;privacy.value=false;
 document.addEventListener('keydown',keydown);
 overflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';
 background=document.getElementById('app');if(background){previousInert=background.inert;background.inert=true;}
 await nextTick();dialog.value?.querySelector<HTMLButtonElement>('button')?.focus();
 const scroll=dialog.value?.querySelector<HTMLElement>('.spend-sheet__scroll');
 if(scroll){sheetObserver=new ResizeObserver(entries=>{podiumWidth.value=entries[0]?.contentRect.width??0});sheetObserver.observe(scroll);}
 void load();
}
function close(){
 open.value=false;privacy.value=false;document.removeEventListener('keydown',keydown);document.documentElement.style.overflow=overflow;
 sheetObserver?.disconnect();sheetObserver=null;podiumWidth.value=0;
 if(background)background.inert=previousInert;
 opener?.focus();background=null;
}
function keydown(e:KeyboardEvent){
 if(e.defaultPrevented||!open.value)return;
 const modal=e.target instanceof Element?e.target.closest('[aria-modal="true"]'):null;
 if(modal&&modal!==dialog.value)return;
 if(e.key==='Escape'){e.preventDefault();close()}
 else if(e.key==='Tab'&&!dialog.value?.contains(document.activeElement)){e.preventDefault();dialog.value?.querySelector<HTMLButtonElement>('button')?.focus()}
 else wrapTab(e,dialog.value,'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]');
}
watch(()=>[props.cardId,session.me?.accountNumId],()=>{if(open.value)close();void load()},{immediate:true});
onBeforeUnmount(()=>{mobileObserver?.disconnect();generation++;if(open.value)close()});
</script>
<template>
 <section class="panel spend-summary" :aria-label="t('spendBoard.title')">
  <h2>{{ t('spendBoard.title') }}</h2>
  <p v-if="showLoading" role="status">{{ t('spendBoard.load') }}</p>
  <p v-else-if="error">{{ t('spendBoard.shortError') }}</p>
  <ol v-else-if="board?.list.length" class="spend-list"><li v-for="player in board.list.slice(0,3)" :key="player.rank"><SpendPlayer :player="player" /></li></ol>
  <p v-else-if="board">{{ t('spendBoard.shortEmpty') }}</p>
  <p class="spend-summary__mine">{{ mine }}</p>
  <button class="btn btn--lg" type="button" @click="show">{{ t('spendBoard.full') }}</button>
 </section>
 <div class="spend-mobile">
  <div ref="mobileTop" class="spend-mobile__top"><strong ref="mobileTitle">{{ t('spendBoard.title') }}</strong><span v-if="board?.list.length&&mobileAvatars" class="spend-mobile__avatars" aria-hidden="true"><SpendAvatar v-for="player in board.list.slice(0,mobileAvatars)" :key="player.rank" :player="player" /></span></div>
  <span class="spend-mobile__mine">{{ compactMine }}</span><button type="button" class="btn btn--ghost btn--lg" @click="show">{{ t('spendBoard.view') }}</button>
 </div>
 <Teleport to="body"><div v-if="open" class="spend-backdrop" @click.self="close">
  <section ref="dialog" class="spend-sheet panel" role="dialog" aria-modal="true" :aria-labelledby="titleId">
   <header :class="{'spend-sheet__settings-head':privacy}"><button v-if="privacy" type="button" class="btn btn--ghost btn--lg btn--icon" :aria-label="t('spendBoard.back')" @click="privacy=false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><h2 :id="titleId">{{ t('spendBoard.'+(privacy?'privacySettings':'title')) }}</h2><button type="button" class="btn btn--ghost btn--lg btn--icon" :aria-label="t('spendBoard.'+(privacy?'closePrivacy':'close'))" @click="close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
   <div class="spend-sheet__scroll">
    <LeaderboardPrivacy v-if="privacy" :card-id="cardId" @saved="load()" />
    <template v-else>
     <p class="spend-description">{{ t('spendBoard.desc') }} <span>{{ t('spendBoard.totalScope') }}</span></p>
     <p v-if="board" class="spend-meta">{{ t('spendBoard.'+(board.total===1?'countOne':'countMany'),{count:board.total}) }}<span v-if="board.updatedAt">{{ t('spendBoard.updated',{time:new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}).format(new Date(board.updatedAt))}) }}</span></p>
     <div v-if="error" class="notice notice--error" role="alert"><p>{{ t('spendBoard.errorTitle') }}</p><button class="btn btn--lg" @click="load()">{{ t('spendBoard.retry') }}</button></div>
     <div v-else-if="showLoading&&!board" class="spend-skeleton" role="status"><span>{{ t('spendBoard.load') }}</span><div v-for="n in 3" :key="n" class="ghost" /></div>
     <template v-else-if="board">
      <ol v-if="podium" class="spend-podium" :aria-label="t('spendBoard.topThree')"><li v-for="player in board.list.slice(0,3)" :key="player.rank"><SpendPlayer :player="player" podium /></li></ol>
      <ol class="spend-list" :start="podium?4:1"><li v-for="player in board.list.slice(podium?3:0)" :key="player.rank"><SpendPlayer :player="player" /></li></ol>
      <div v-if="!board.total" class="spend-empty"><h3>{{ t('spendBoard.emptyTitle') }}</h3><p>{{ t('spendBoard.emptyDesc') }}</p><a v-if="playUrl" class="btn btn--lg" :href="playUrl">{{ t('spendBoard.play') }}</a></div>
      <p v-if="moreError" role="alert">{{ t('spendBoard.errorTitle') }}</p>
      <button v-if="board.nextOffset!==null" type="button" class="btn btn--lg spend-more" :disabled="loading" @click="load(true)">{{ t('spendBoard.'+(loading?'load':moreError?'retry':'more')) }}</button>
     </template>
     <div class="spend-rules"><p>{{ t('spendBoard.pointsSources') }} {{ t('spendBoard.refundRule') }}</p><p>{{ t('spendBoard.rule') }}</p></div>
    </template>
   </div>
   <footer v-if="!privacy" class="spend-mine" :class="{'spend-mine--wide':board?.self&&formatCredits(board.self.credits,locale).length>12}">
    <div><p>{{ mine }}</p><span v-if="board?.self">{{ t('spendBoard.'+(board.self.credits==='1'?'pointsAmountOne':'pointsAmount'),{points:formatCredits(board.self.credits,locale)}) }}</span></div>
    <button v-if="board?.privacy" type="button" class="btn btn--ghost btn--lg spend-mine__privacy" :aria-label="t('spendBoard.'+(isAnonymous(board.privacy)?'openPrivacyAnonymous':'openPrivacyPublic'))" @click="privacy=true"><span>{{ t('spendBoard.'+(isAnonymous(board.privacy)?'shortAnonymous':'shortPublic')) }}</span><span>{{ t('spendBoard.privacySettings') }}</span></button>
    <a v-else-if="board?.selfState==='guest'" class="btn btn--lg" :href="lp(loginPath(route?.fullPath??'/cards/'+cardId))">{{ t('spendBoard.signin') }}</a>
   </footer>
  </section>
 </div></Teleport>
</template>
<style scoped>
.spend-summary{padding:var(--s-4);min-width:0}.spend-summary h2{font-size:16px;margin:0 0 var(--s-3)}.spend-list,.spend-podium{list-style:none;padding:0;margin:0}.spend-list{display:grid;gap:var(--s-1)}.spend-summary__mine{font-size:13px;line-height:1.6;color:var(--text-2);margin:var(--s-3) 0}.spend-summary>.btn{width:100%;white-space:normal;height:auto;min-height:var(--h-lg)}.spend-mobile{display:none}.spend-backdrop{position:fixed;inset:0;z-index:100;background:color-mix(in srgb,var(--text) 24%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center}.spend-sheet{display:grid;grid-template-rows:auto minmax(0,1fr) auto;width:min(100%,640px);max-height:92vh;max-height:92dvh;border-radius:24px 24px 0 0;box-shadow:var(--shadow-md);overflow:hidden;padding-bottom:env(safe-area-inset-bottom)}.spend-sheet header{display:flex;align-items:center;gap:var(--s-2);padding:var(--s-3) var(--s-4);border-bottom:1px solid var(--line)}.spend-sheet header h2{font-size:18px;font-weight:600;flex:1;min-width:0;margin:0;overflow-wrap:anywhere}.spend-sheet .btn--icon{width:var(--h-lg);flex:none}.spend-sheet__scroll{overflow-y:auto;overscroll-behavior:contain;padding:var(--s-4);min-height:0}.spend-description{font-size:14px;line-height:1.6;margin:0 0 var(--s-2)}.spend-description>span{display:block;color:var(--text-2);font-size:13px}.spend-meta{font-size:12px;line-height:1.6;color:var(--text-3);display:flex;flex-wrap:wrap;gap:var(--s-1) var(--s-3);margin:0 0 var(--s-4)}.spend-podium{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s-2);align-items:end;margin:var(--s-4) 0}.spend-podium>li:first-child{grid-column:2;grid-row:1}.spend-podium>li:nth-child(2){grid-column:1;grid-row:1}.spend-podium>li:nth-child(3){grid-column:3;grid-row:1}.spend-rules{font-size:12px;line-height:1.6;color:var(--text-2);margin-top:var(--s-4)}.spend-rules p{margin:var(--s-2) 0 0}.spend-mine{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--s-3);margin:var(--s-2) var(--s-4);padding:var(--s-1) var(--s-3);border-radius:var(--r-md);background:var(--surface-2);min-height:var(--h-lg)}.spend-mine>div{min-width:min-content;max-width:100%;flex:1 1 auto;overflow-wrap:anywhere}.spend-mine p{font-size:14px;font-weight:600;margin:0;line-height:1.5}.spend-mine>div>span{display:block;white-space:nowrap;font-size:13px;font-variant-numeric:tabular-nums;color:var(--text-2)}.spend-mine__privacy{display:flex;flex-direction:column;align-items:flex-end;gap:var(--s-1);flex:none;height:auto;min-height:var(--h-lg);font-size:12px;line-height:1.3;max-width:50%;white-space:normal;text-align:right}.spend-mine__privacy>span:first-child{color:var(--text-2)}.spend-empty{padding:var(--s-5) 0;text-align:center;line-height:1.6}.spend-empty h3{font-size:16px;margin:0}.spend-empty p{color:var(--text-2)}.spend-more{display:flex;margin:var(--s-4) auto 0}.spend-skeleton{display:grid;gap:var(--s-3)}.spend-skeleton .ghost{height:56px;border-radius:var(--r-sm)}
.spend-sheet header.spend-sheet__settings-head{display:grid;grid-template-columns:44px minmax(0,1fr) 44px}.spend-sheet header.spend-sheet__settings-head h2{overflow-wrap:normal;word-break:normal}.spend-mine--wide{display:grid;grid-template-columns:minmax(0,1fr) auto;row-gap:var(--s-1)}.spend-mine--wide>div{display:contents}.spend-mine--wide>div>p{grid-column:1;grid-row:1}.spend-mine--wide>div>span{grid-column:1/-1;grid-row:2}.spend-mine--wide .spend-mine__privacy{grid-column:2;grid-row:1;max-width:none}
@media(max-width:820px){.spend-summary{display:none}.spend-mobile{grid-area:spend;display:grid;grid-template-columns:minmax(0,1fr) max-content;grid-template-rows:auto auto;align-items:center;column-gap:var(--s-2);row-gap:0;padding:var(--s-2) var(--s-1) var(--s-2) var(--s-3);border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line);width:100%;max-width:100%;font-size:13px}.spend-mobile__top{grid-column:1;grid-row:1;display:flex;align-items:center;gap:var(--s-2);min-width:0}.spend-mobile__top>strong{font-size:14px;flex:none}.spend-mobile__avatars{display:flex;flex:none;padding-left:var(--s-1)}.spend-mobile__avatars>.spend-avatar{width:28px;height:28px;margin-left:calc(-1 * var(--s-1));border:2px solid var(--surface)}.spend-mobile__mine{grid-column:1;grid-row:2;min-width:0;color:var(--text-2);overflow-wrap:anywhere}.spend-mobile>.btn{grid-column:2;grid-row:1/3;font-size:13px;padding-inline:var(--s-2);white-space:nowrap;height:auto;min-height:var(--h-lg)}}
</style>
