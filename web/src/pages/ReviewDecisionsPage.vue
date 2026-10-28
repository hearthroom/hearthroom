<script setup lang="ts">
import {onMounted,ref,watch} from 'vue';
import {RouterLink} from 'vue-router';
import {useI18n} from 'vue-i18n';
import {fetchReviewDecisions,type ReviewDecision} from '@/lib/api';
import {useSession} from '@/lib/session';
import {useLocalePath} from '@/lib/use-locale';
import {dateTime} from '@/lib/format';
import {pageTitle} from '@/lib/i18n';
const {t,locale}=useI18n(),{lp}=useLocalePath(),session=useSession();
const items=ref<ReviewDecision[]>([]),loading=ref(false),error=ref(''),next=ref<number|null>(null);
let sequence=0;
async function load(more=false){
 const seq=++sequence;loading.value=true;error.value='';
 try{const token=await session.accessToken();if(!token)throw new Error(t('auth.expired'));
  const result=await fetchReviewDecisions(token,String(locale.value),more?next.value??undefined:undefined);
  if(seq===sequence){items.value=more?[...items.value,...result.items]:result.items;next.value=result.nextCursor;}
 }catch(err){if(seq===sequence)error.value=err instanceof Error?err.message:t('state.loadFailed');}
 finally{if(seq===sequence)loading.value=false;}
}
onMounted(()=>{document.title=pageTitle(t('review.history.title'));void load();});
watch(locale,()=>void load());
</script>
<template>
 <section class="decisions">
  <header class="head"><h2>{{t('review.history.title')}}</h2><RouterLink class="btn btn--sm" :to="lp('/review')">{{t('review.history.toQueue')}}</RouterLink></header>
  <p class="muted">{{t('review.history.hint')}}</p>
  <p v-if="error" class="notice notice--error" role="alert">{{error}} <button class="btn btn--sm" @click="load()">{{t('review.refresh')}}</button></p>
  <div v-if="loading&&!items.length" class="ghost placeholder" aria-busy="true" />
  <div v-else-if="!items.length&&!error" class="panel empty"><h3>{{t('review.history.empty')}}</h3><p class="muted">{{t('review.history.emptyHint')}}</p></div>
  <ul v-else class="list">
   <li v-for="item in items" :key="item.id" class="panel row">
    <div class="row__body">
     <RouterLink class="row__name" :to="lp(`/review/${item.id}`)">{{item.card.name}}</RouterLink>
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
.decisions{display:grid;gap:var(--s-4)}.head,.row{display:flex;gap:var(--s-4);align-items:center;justify-content:space-between}.head h2{font-size:20px}.list{list-style:none;margin:0;padding:0;display:grid;gap:var(--s-3)}.row{padding:var(--s-4)}.row__body{min-width:0;overflow-wrap:anywhere;display:grid;gap:var(--s-2)}.row__body p{margin:0}.row__name{font-weight:600;color:var(--text);font-size:16px}.empty{padding:var(--s-5)}.placeholder{height:160px;border-radius:var(--r-md)}
@media(max-width:640px){.head,.row{align-items:flex-start;flex-wrap:wrap}.row>.btn{min-height:var(--h-lg)}}
</style>
