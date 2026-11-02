<script setup lang="ts">
/**
 * /review/decisions — 我處理過的審核，新的在前。
 *
 * 搜尋（2026-11-02）：卡名部分比對、純數字是卡號精確比對，由伺服器搜全部紀錄——
 * 只在前端過濾已載入的那一頁，會漏掉更早的卡。條件放在網址 ?q=，從詳情返回時還在。
 */
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {RouterLink,useRoute,useRouter} from 'vue-router';
import {useI18n} from 'vue-i18n';
import {fetchReviewDecisions,type ReviewDecision} from '@/lib/api';
import {useSession} from '@/lib/session';
import {useLocalePath} from '@/lib/use-locale';
import {useReviewer} from '@/lib/review';
import {dateTime} from '@/lib/format';
import {pageTitle} from '@/lib/i18n';
import ReviewListTabs from '@/components/ReviewListTabs.vue';
const {t,locale}=useI18n(),{lp}=useLocalePath(),session=useSession(),route=useRoute(),router=useRouter(),reviewer=useReviewer();
const items=ref<ReviewDecision[]>([]),loading=ref(false),error=ref(''),next=ref<number|null>(null);
const typed=ref(String(route.query.q??''));
/** 實際拿去查的條件（網址上那一份）；輸入框停下 300ms 才更新 */
const query=computed(()=>String(route.query.q??'').trim());
let sequence=0,debounce:ReturnType<typeof setTimeout>|undefined;
async function load(more=false){
 const seq=++sequence;loading.value=true;error.value='';
 try{const token=await session.accessToken();if(!token)throw new Error(t('auth.expired'));
  const result=await fetchReviewDecisions(token,String(locale.value),more?next.value??undefined:undefined,query.value||undefined);
  if(seq===sequence){items.value=more?[...items.value,...result.items]:result.items;next.value=result.nextCursor;}
 }catch(err){if(seq===sequence)error.value=err instanceof Error?err.message:t('state.loadFailed');}
 finally{if(seq===sequence)loading.value=false;}
}
function setQuery(value:string){
 const q=value.trim();
 if(q===query.value)return;
 void router.replace({query:{...route.query,q:q||undefined}});
}
function onInput(){clearTimeout(debounce);debounce=setTimeout(()=>setQuery(typed.value),300);}
function submitSearch(){clearTimeout(debounce);setQuery(typed.value);}
function clearSearch(){clearTimeout(debounce);typed.value='';setQuery('');}
onMounted(()=>{document.title=pageTitle(t('review.history.title'));void reviewer.refresh();void load();});
onBeforeUnmount(()=>clearTimeout(debounce));
watch(locale,()=>void load());
watch(query,(q)=>{if(q!==typed.value.trim())typed.value=q;void load();});
</script>
<template>
 <section class="decisions">
  <header class="head"><ReviewListTabs active="history" :pending="reviewer.pendingReviews" /></header>
  <form class="history-search" role="search" @submit.prevent="submitSearch">
   <input v-model="typed" class="input history-search__input" type="search" enterkeyhint="search" autocomplete="off" :placeholder="t('review.history.search.placeholder')" :aria-label="t('review.history.search.placeholder')" @input="onInput" />
  </form>
  <p v-if="!query" class="muted">{{t('review.history.hint')}}</p>
  <p v-if="error" class="notice notice--error" role="alert">{{error}} <button class="btn btn--sm" @click="load()">{{t('review.refresh')}}</button></p>
  <ul v-if="loading&&!items.length" class="list" aria-busy="true"><li v-for="i in 4" :key="i" class="ghost placeholder" /></ul>
  <div v-else-if="!items.length&&!error&&query" class="panel empty" data-search-empty>
   <h3>{{t('review.history.search.emptyTitle')}}</h3><p class="muted">{{t('review.history.search.emptyHint')}}</p>
   <button class="btn" @click="clearSearch">{{t('review.history.search.clear')}}</button>
  </div>
  <div v-else-if="!items.length&&!error" class="panel empty"><h3>{{t('review.history.empty')}}</h3><p class="muted">{{t('review.history.emptyHint')}}</p></div>
  <ul v-else class="list">
   <li v-for="item in items" :key="item.id" class="panel row">
    <div class="row__body">
     <p class="row__title"><RouterLink class="row__name" :to="lp(`/review/${item.id}`)">{{item.card.name}}</RouterLink> <span class="subtle num">#{{item.card.id}}</span></p>
     <p>{{t('review.confirm.version')}} · {{dateTime(item.submittedAt)}}</p>
     <p>{{t('review.history.myDecision')}} · {{t(`review.action.${item.verdict}`)}}</p>
     <p>{{t('review.history.currentResult')}} · {{item.corrected?t('review.history.corrected'):item.status==='pending'?t('review.history.pending'):t(`review.done.${item.status==='approved'?'approved':'rejected'}`)}}</p>
     <p class="subtle">{{t('review.history.reviewedAt')}} · {{dateTime(item.at)}}</p>
    </div>
    <RouterLink class="btn btn--sm" :to="lp(`/review/${item.id}`)">{{t(item.canCorrect?'review.correction.action':'review.history.open')}}</RouterLink>
   </li>
  </ul>
  <button v-if="next" class="btn" :disabled="loading" @click="load(true)">{{t('res.more')}}</button>
 </section>
</template>
<style scoped>
.decisions{display:grid;gap:var(--s-4)}.head,.row{display:flex;gap:var(--s-4);align-items:center;justify-content:space-between}.list{list-style:none;margin:0;padding:0;display:grid;gap:var(--s-3)}.row{padding:var(--s-4)}.row__body{min-width:0;overflow-wrap:anywhere;display:grid;gap:var(--s-2)}.row__body p{margin:0}.row__name{font-weight:600;color:var(--text);font-size:16px}.num{font-variant-numeric:tabular-nums}.empty{padding:var(--s-5);display:grid;gap:var(--s-2);justify-items:start}.placeholder{height:132px;border-radius:var(--r-md)}
.history-search__input{width:100%;min-height:var(--h-lg)}
@media(max-width:640px){.head,.row{align-items:flex-start;flex-wrap:wrap}.row>.btn{min-height:var(--h-lg)}}
</style>
