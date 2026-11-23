<script setup lang="ts">
import {computed,onMounted,ref,watch} from 'vue';
import {useRoute,RouterLink} from 'vue-router';
import {useI18n} from 'vue-i18n';
import {fetchAuthorReviewResult,type AuthorReviewResult} from '@/lib/api';
import {useSession} from '@/lib/session';
import {useLocalePath} from '@/lib/use-locale';
import {dateTime} from '@/lib/format';
import {pageTitle} from '@/lib/i18n';
import {REVIEW_REASONS,hasField,hasOpeningReason,reasonKey} from '@/lib/review-reasons';
import {REVIEW_REQUIRED_CHARACTERS} from '../../../shared/review-length';
import {platformPath} from '@/lib/distribution';
import type {ProviderId} from '@/lib/provider';
const route=useRoute(),{t,te,locale}=useI18n(),{lp}=useLocalePath(),session=useSession();
const data=ref<AuthorReviewResult|null>(null),error=ref(''),loading=ref(true);
/** 主行動：回到編輯器改這張卡（跟「我的卡片」的編輯連結同一條路） */
const editPath=computed(()=>data.value?.cardNumber&&data.value.provider?platformPath(lp(`/cards/${data.value.cardNumber}/edit`),data.value.provider as ProviderId):'');
let sequence=0;
/*
 * 審卡 V2：駁回單帶理由代碼時，這一頁就是作者看修改方向的地方（通知與卡片列都連過來）。
 * 舊的駁回（沒有代碼）、更正、通過、待審照舊只顯示結果與審核員的說明。
 * 只列認得的代碼：語系檔沒有的代碼畫不出卡片，整張單退回舊版面。
 */
const reasons=computed(()=>{const d=data.value;if(!d||d.status!=='rejected'||d.corrected)return [];return (d.reasons??[]).filter(c=>(REVIEW_REASONS as readonly string[]).includes(c));});
const guided=computed(()=>reasons.value.length>0);
const coaching=computed(()=>guided.value&&!!data.value?.coaching);
const opening=computed(()=>hasOpeningReason(reasons.value));
const has=(code:string,field:Parameters<typeof reasonKey>[1])=>hasField(te,code,field);
// 有效字數那一項的「怎麼改」帶門檻字數；其他代碼用不到這個參數
const say=(code:string,field:Parameters<typeof reasonKey>[1])=>t(reasonKey(code,field),{required:REVIEW_REQUIRED_CHARACTERS});
const fixField=(code:string)=>coaching.value&&has(code,'coachFix')?'coachFix':'fix';
async function load(){
 const seq=++sequence;loading.value=true;error.value='';data.value=null;
 try{const token=await session.accessToken();if(!token)throw new Error(t('auth.expired'));
  const result=await fetchAuthorReviewResult(String(route.params.id),token,String(locale.value));if(seq===sequence)data.value=result;
 }catch(err){if(seq===sequence)error.value=err instanceof Error?err.message:t('state.loadFailed');}
 finally{if(seq===sequence)loading.value=false;}
}
onMounted(()=>{void load();});
watch(()=>[route.params.id,locale.value],()=>void load());
watch([guided,()=>data.value?.corrected,locale],()=>{document.title=pageTitle(t(guided.value?'reviewV2.author.pageTitle':'review.correction.authorTitle'));},{immediate:true});
</script>
<template>
 <section class="page page--narrow result">
  <RouterLink class="link" :to="lp('/mine')">{{t('nav.mine')}}</RouterLink>
  <h1>{{t(guided?'reviewV2.author.pageTitle':data?.corrected?'review.correction.authorTitle':'review.correction.authorOpen')}}</h1>
  <p v-if="error" class="notice notice--error" role="alert">{{error}} <button class="btn" @click="load">{{t('review.correction.reload')}}</button></p>
  <div v-else-if="loading" class="ghost placeholder" aria-busy="true" />
  <template v-else-if="data&&guided">
   <article class="panel record" data-guided>
    <span class="chip result__chip">{{t('reviewV2.author.chip')}}</span>
    <h2>{{data.name}}</h2>
    <p class="subtle">{{t('review.confirm.version')}} · {{dateTime(data.submittedAt)}}</p>
   </article>
   <article v-for="code in reasons" :key="code" class="panel record reason-card" :data-reason="code">
    <h3>{{t(reasonKey(code,'name'))}}</h3>
    <dl class="reason-card__parts">
     <div><dt>{{t('reviewV2.author.problem')}}</dt><dd>{{say(code,'summary')}}</dd></div>
     <div><dt>{{t('reviewV2.author.fix')}}</dt><dd data-fix>{{say(code,fixField(code))}}</dd></div>
     <div v-if="has(code,'example')"><dt>{{t('reviewV2.author.example')}}</dt><dd>{{say(code,'example')}}</dd></div>
     <template v-if="coaching&&has(code,'before')&&has(code,'after')">
      <div data-before><dt>{{t('reviewV2.author.before')}}</dt><dd class="quote">{{say(code,'before')}}</dd></div>
      <div data-after><dt>{{t('reviewV2.author.after')}}</dt><dd class="quote">{{say(code,'after')}}</dd></div>
     </template>
    </dl>
   </article>
   <article v-if="(data.note??'').trim()" class="panel record" data-reviewer-note>
    <h3>{{t('reviewV2.author.reviewerNote')}}</h3><p class="reason">{{data.note}}</p>
   </article>
   <details class="panel record elements" :open="opening" data-elements>
    <summary>{{t('reviewV2.elements.title')}}</summary>
    <ul><li>{{t('reviewV2.elements.scene')}}</li><li>{{t('reviewV2.elements.event')}}</li><li>{{t('reviewV2.elements.hook')}}</li></ul>
    <p class="subtle">{{t('reviewV2.elements.footer')}}</p>
   </details>
   <div v-if="editPath" class="edit">
    <a class="btn btn--primary btn--lg" :href="editPath" data-edit-card>{{t('reviewV2.author.edit')}}</a>
   </div>
   <p class="subtle quota">{{t('reviewV2.author.quota')}}</p>
  </template>
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
.record:lang(ko), .quota:lang(ko) { word-break: keep-all; }
.record:lang(ja), .quota:lang(ja) { word-break: auto-phrase; }
.result,.record{display:grid;gap:var(--s-4)}.result{padding-block:var(--s-5)}.record{padding:var(--s-5);overflow-wrap:anywhere}.reason{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.placeholder{height:160px;border-radius:var(--r-md)}h1{font-size:22px}h2{font-size:18px}h3{font-size:16px}
h2, h3, p, dl, dd, ul { margin: 0; }
/* 結果標：狀態色只用危險色一種（一屏最多兩種強調色：accent 加一個狀態色），chip 本身不可點 */
.result__chip { justify-self: start; cursor: default; background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); }
.result__chip:hover, .result__chip:active { background: color-mix(in srgb, var(--danger) 12%, var(--surface)); color: var(--danger); }
.reason-card { gap: var(--s-3); }
.reason-card__parts { display: grid; gap: var(--s-3); }
.reason-card__parts dt { font-size: 13px; font-weight: 600; color: var(--text-2); }
.reason-card__parts dd { line-height: 1.7; }
.quote { padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); }
.elements summary { cursor: pointer; font-size: 16px; font-weight: 600; min-height: var(--h-sm); display: flex; align-items: center; }
.elements ul { display: grid; gap: var(--s-2); padding-inline-start: var(--s-5); line-height: 1.7; }
.elements:not([open]) { gap: 0; }
.quota { font-size: 13px; }
.edit{display:flex}.edit .btn{min-width:200px}@media (max-width:480px){.edit .btn{width:100%}}
</style>
