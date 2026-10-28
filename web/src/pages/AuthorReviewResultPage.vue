<script setup lang="ts">
import {onMounted,ref,watch} from 'vue';
import {useRoute,RouterLink} from 'vue-router';
import {useI18n} from 'vue-i18n';
import {fetchAuthorReviewResult,type AuthorReviewResult} from '@/lib/api';
import {useSession} from '@/lib/session';
import {useLocalePath} from '@/lib/use-locale';
import {dateTime} from '@/lib/format';
import {pageTitle} from '@/lib/i18n';
const route=useRoute(),{t,locale}=useI18n(),{lp}=useLocalePath(),session=useSession();
const data=ref<AuthorReviewResult|null>(null),error=ref(''),loading=ref(true);
let sequence=0;
async function load(){
 const seq=++sequence;loading.value=true;error.value='';data.value=null;
 try{const token=await session.accessToken();if(!token)throw new Error(t('auth.expired'));
  const result=await fetchAuthorReviewResult(String(route.params.id),token,String(locale.value));if(seq===sequence)data.value=result;
 }catch(err){if(seq===sequence)error.value=err instanceof Error?err.message:t('state.loadFailed');}
 finally{if(seq===sequence)loading.value=false;}
}
onMounted(()=>{document.title=pageTitle(t('review.correction.authorTitle'));void load();});
watch(()=>[route.params.id,locale.value],()=>void load());
</script>
<template>
 <section class="page page--narrow result">
  <RouterLink class="link" :to="lp('/mine')">{{t('nav.mine')}}</RouterLink>
  <h1>{{t(data?.corrected?'review.correction.authorTitle':'review.correction.authorOpen')}}</h1>
  <p v-if="error" class="notice notice--error" role="alert">{{error}} <button class="btn" @click="load">{{t('review.correction.reload')}}</button></p>
  <div v-else-if="loading" class="ghost placeholder" aria-busy="true" />
  <article v-else-if="data" class="panel record">
   <h2>{{data.name}}</h2>
   <p>{{t('review.confirm.version')}} · {{dateTime(data.submittedAt)}}</p>
   <p v-if="data.corrected">{{t('review.correction.authorBody')}}</p>
   <p v-if="data.rewardKept">{{t('review.correction.rewardKept')}}</p>
   <p v-else>{{t(data.status==='approved'?'review.done.approved':data.status==='pending'?'review.history.pending':'review.done.rejected')}}</p>
   <p v-if="data.correctedAt" class="subtle">{{t('review.correction.at')}} · {{dateTime(data.correctedAt)}}</p>
   <h3>{{t('review.correction.authorReason')}}</h3><p class="reason">{{data.note}}</p>
  </article>
 </section>
</template>
<style scoped>
.link { display: inline-flex; align-items: center; min-height: var(--h-lg); }
.link, .link:hover { color: var(--accent-text); }
.record:lang(ko) { word-break: keep-all; }
.result,.record{display:grid;gap:var(--s-4)}.result{padding-block:var(--s-5)}.record{padding:var(--s-5);overflow-wrap:anywhere}.reason{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.placeholder{height:160px;border-radius:var(--r-md)}h1{font-size:22px}h2{font-size:18px}h3{font-size:16px}
</style>
