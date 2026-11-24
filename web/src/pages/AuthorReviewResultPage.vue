<script setup lang="ts">
import {computed,onMounted,ref,watch} from 'vue';
import {useRoute,RouterLink} from 'vue-router';
import {useI18n} from 'vue-i18n';
import {fetchAuthorReviewResult,type AuthorReviewResult} from '@/lib/api';
import {useSession} from '@/lib/session';
import {useLocalePath} from '@/lib/use-locale';
import {dateTime} from '@/lib/format';
import {pageTitle} from '@/lib/i18n';
import {REVIEW_REASONS,declineReply,hasField,hasOpeningReason,hasOptions,isDeclineReason,reasonKey,reasonOptionKey} from '@/lib/review-reasons';
import ReviewReasonOptions from '@/components/ReviewReasonOptions.vue';
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
const known=(codes:string[]|undefined)=>(codes??[]).filter(c=>(REVIEW_REASONS as readonly string[]).includes(c));
/** 通過並附改進建議（owner 2026-11-23）：卡已通過上架，這一頁列「可以更好的地方」，一律用輔導版的完整改法 */
const suggest=computed(()=>{const d=data.value;return !!d&&d.status==='approved'&&!d.corrected&&known(d.suggestions).length>0;});
const reasons=computed(()=>{const d=data.value;if(!d||d.corrected)return [];if(suggest.value)return known(d.suggestions);if(d.status!=='rejected')return [];return known(d.reasons);});
const guided=computed(()=>reasons.value.length>0);
/**
 * 婉拒（ui-decline.md）：一張「給你的回覆」卡放最前面，只有溫和的回覆正文（不列問題／怎麼改／範例）；
 * 同時勾了其他理由時接一句連接語，其他理由的卡片接在下面。只勾婉拒：標題「審核結果」，沒有好開場要素，按鈕只有返回我的卡片。
 */
const decline=computed(()=>suggest.value?'':declineReply(t,reasons.value));
const cards=computed(()=>decline.value?reasons.value.filter(c=>!isDeclineReason(c)):reasons.value);
const declineOnly=computed(()=>!!decline.value&&!cards.value.length);
const titleKey=computed(()=>suggest.value?'reviewV2.author.suggestTitle':declineOnly.value?'reviewV2.author.declinePageTitle':guided.value?'reviewV2.author.pageTitle':data.value?.corrected?'review.correction.authorTitle':'review.correction.authorOpen');
const coaching=computed(()=>guided.value&&(suggest.value||!!data.value?.coaching));
const opening=computed(()=>hasOpeningReason(reasons.value));
const has=(code:string,field:Parameters<typeof reasonKey>[1])=>hasField(te,code,field);
// 有效字數那一項的「怎麼改」帶門檻字數；其他代碼用不到這個參數
const say=(code:string,field:Parameters<typeof reasonKey>[1])=>t(reasonKey(code,field),{required:REVIEW_REQUIRED_CHARACTERS});
const fixField=(code:string)=>coaching.value&&has(code,'coachFix')?'coachFix':'fix';
// 有兩種改後的代碼（沒有接話點：問題／選項），小標由該代碼自己帶；其他代碼照通用的「改後」
const afterLabel=(code:string)=>has(code,'afterLabel')?say(code,'afterLabel'):t('reviewV2.author.after');
async function load(){
 const seq=++sequence;loading.value=true;error.value='';data.value=null;
 try{const token=await session.accessToken();if(!token)throw new Error(t('auth.expired'));
  const result=await fetchAuthorReviewResult(String(route.params.id),token,String(locale.value));if(seq===sequence)data.value=result;
 }catch(err){if(seq===sequence)error.value=err instanceof Error?err.message:t('state.loadFailed');}
 finally{if(seq===sequence)loading.value=false;}
}
onMounted(()=>{void load();});
watch(()=>[route.params.id,locale.value],()=>void load());
watch([guided,suggest,declineOnly,()=>data.value?.corrected,locale],()=>{document.title=pageTitle(t(suggest.value?'reviewV2.author.suggestTitle':declineOnly.value?'reviewV2.author.declinePageTitle':guided.value?'reviewV2.author.pageTitle':'review.correction.authorTitle'));},{immediate:true});
</script>
<template>
 <section class="page page--narrow result">
  <RouterLink class="link" :to="lp('/mine')">{{t('nav.mine')}}</RouterLink>
  <h1>{{t(titleKey)}}</h1>
  <p v-if="error" class="notice notice--error" role="alert">{{error}} <button class="btn" @click="load">{{t('review.correction.reload')}}</button></p>
  <div v-else-if="loading" class="ghost placeholder" aria-busy="true" />
  <template v-else-if="data&&guided">
   <article class="panel record" data-guided>
    <!-- 通過附建議：標題與結果永遠是「已通過」，建議在後面，語氣是建議不是問題清單 -->
    <span class="chip result__chip" :class="{'result__chip--ok':suggest}" :data-suggest="suggest?'':undefined">{{t(suggest?'reviewV2.author.chipApproved':'reviewV2.author.chip')}}</span>
    <h2>{{data.name}}</h2>
    <p class="subtle">{{t('review.confirm.version')}} · {{dateTime(data.submittedAt)}}</p>
    <p v-if="suggest" data-suggest-intro>{{t('reviewV2.author.suggestIntro')}}</p>
   </article>
   <article v-if="decline" class="panel record" data-decline-reply>
    <h3>{{t('reviewV2.author.declineReplyTitle')}}</h3><p class="reason">{{decline}}</p>
   </article>
   <p v-if="decline&&cards.length" data-decline-lead>{{t('reviewV2.author.declineWithOthersLead')}}</p>
   <article v-for="code in cards" :key="code" class="panel record reason-card" :data-reason="code">
    <h3>{{t(reasonKey(code,'name'))}}</h3>
    <dl class="reason-card__parts">
     <div><dt>{{t(suggest?'reviewV2.author.suggestPoint':'reviewV2.author.problem')}}</dt><dd>{{say(code,'summary')}}</dd></div>
     <div><dt>{{t('reviewV2.author.fix')}}</dt><dd data-fix>{{say(code,fixField(code))}}</dd></div>
     <div v-if="has(code,'example')"><dt>{{t('reviewV2.author.example')}}</dt><dd>{{say(code,'example')}}</dd></div>
     <div v-if="hasOptions(te,code)" data-reason-options><dt>{{t(reasonOptionKey(code,'title'))}}</dt><dd><ReviewReasonOptions :code="code" /></dd></div>
     <template v-if="coaching&&has(code,'before')&&has(code,'after')">
      <div data-before><dt>{{t('reviewV2.author.before')}}</dt><dd class="quote">{{say(code,'before')}}</dd></div>
      <div data-after><dt>{{afterLabel(code)}}</dt><dd class="quote">{{say(code,'after')}}</dd></div>
      <div v-if="has(code,'afterChoices')" data-after-choices><dt>{{say(code,'afterChoicesLabel')}}</dt><dd class="quote">{{say(code,'afterChoices')}}</dd></div>
     </template>
    </dl>
   </article>
   <article v-if="(data.note??'').trim()" class="panel record" data-reviewer-note>
    <h3>{{t('reviewV2.author.reviewerNote')}}</h3><p class="reason">{{data.note}}</p>
   </article>
   <details v-if="!declineOnly" class="panel record elements" :open="opening" data-elements>
    <summary>{{t('reviewV2.elements.title')}}</summary>
    <ul><li>{{t('reviewV2.elements.scene')}}</li><li>{{t('reviewV2.elements.event')}}</li><li>{{t('reviewV2.elements.hook')}}</li></ul>
    <p class="subtle">{{t('reviewV2.elements.footer')}}</p>
   </details>
   <div v-if="declineOnly" class="edit">
    <RouterLink class="btn btn--lg btn--primary" :to="lp('/mine')" data-back-to-mine>{{t('reviewV2.author.backToMine')}}</RouterLink>
   </div>
   <div v-else-if="editPath" class="edit">
    <a class="btn btn--lg" :class="{'btn--primary':!suggest}" :href="editPath" data-edit-card>{{t('reviewV2.author.edit')}}</a>
   </div>
   <p v-if="!declineOnly" class="subtle quota">{{t(suggest?'reviewV2.author.suggestQuota':'reviewV2.author.quota')}}</p>
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
.result__chip--ok, .result__chip--ok:hover, .result__chip--ok:active { background: var(--success-soft); color: var(--success); }
.reason-card { gap: var(--s-3); }
.reason-card__parts { display: grid; gap: var(--s-3); min-width: 0; }
.reason-card__parts > div, .reason-card__parts dd { min-width: 0; }
.reason-card__parts dt { font-size: 13px; font-weight: 600; color: var(--text-2); }
.reason-card__parts dd { line-height: 1.7; }
.quote { padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); }
/* 改後（選項）的編號選項之間在英韓是兩個空白，照原樣保留 */
[data-after-choices] .quote { white-space: pre-wrap; }
.elements summary { cursor: pointer; font-size: 16px; font-weight: 600; min-height: var(--h-sm); display: flex; align-items: center; }
.elements ul { display: grid; gap: var(--s-2); padding-inline-start: var(--s-5); line-height: 1.7; }
.elements:not([open]) { gap: 0; }
.quota { font-size: 13px; }
.edit{display:flex}.edit .btn{min-width:200px}@media (max-width:480px){.edit .btn{width:100%}}
</style>
