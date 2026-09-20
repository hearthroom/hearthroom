<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSession } from '@/lib/session';
import { useReviewer } from '@/lib/review';
import { currentProvider } from '@/lib/provider';
import { confirmDialog, settleConfirm } from '@/lib/confirm';
import { moderationRequest, type ModerationCase, type ManagedCard, type CardHistory } from '@/lib/moderation';
import { dateTime } from '@/lib/format';
import { pageTitle } from '@/lib/i18n';
const {t,locale}=useI18n();const route=useRoute();const session=useSession();const reviewer=useReviewer();
const tab=computed(() => route.meta.managementTab === 'cards' ? 'cards' : route.meta.managementTab === 'history' ? 'history' : 'cases');const cases=ref<ModerationCase[]>([]);const cards=ref<ManagedCard[]>([]);
const selected=ref<ModerationCase|null>(null);const history=ref<CardHistory|null>(null);const q=ref('');const offset=ref(0);const hasNext=ref(false);
const loading=ref(false);const busy=ref(false);const error=ref('');const done=ref('');const reason=ref('');
const action=ref('delist');const tagText=ref('');const hours=ref(1);const board=ref('day');
const isManager=computed(()=>reviewer.role==='manager'||reviewer.role==='owner');
const actions=computed(()=>history.value?[history.value.card.boardHidden?'restore_listing':'delist',history.value.card.publicBlocked?'restore_public':'suspend']:[]);
const operation=ref(crypto.randomUUID());
const identity=()=>`${currentProvider()}:${session.me?.accountNumId??''}`;
let generation=0, selectionGeneration=0, alive=true;
let ownConfirmation=false;
function clearSelection(){selectionGeneration++;selected.value=null;history.value=null;evidence.value=null;reason.value='';}
function invalidate(){generation++;clearSelection();cases.value=[];cards.value=[];error.value='';done.value='';busy.value=false;loading.value=false;if(ownConfirmation)settleConfirm(false);}
watch(()=>[session.me?.accountNumId,reviewer.reviewer,reviewer.role],()=>{invalidate();if(session.me&&reviewer.reviewer!==false)void load();},{flush:'sync'});
onBeforeUnmount(()=>{alive=false;invalidate();});
async function token(){const value=await session.accessToken();if(!value)throw new Error(t('auth.expired'));return value;}
async function load(){if(busy.value)return;const gen=++generation,who=identity(),requestTab=tab.value;clearSelection();loading.value=true;error.value='';try{
 const path=requestTab==='cards'?`/cards?q=${encodeURIComponent(q.value)}&lang=${locale.value}&offset=${offset.value}`:`/cases?history=${requestTab==='history'?1:0}&offset=${offset.value}`;
 const access=await token();if(!alive||gen!==generation||who!==identity())return;
 const data=await moderationRequest<{items:ModerationCase[]|ManagedCard[];hasNext:boolean}>(path,access);
 if(!alive||gen!==generation||who!==identity())return;
 if(requestTab==='cards')cards.value=data.items as ManagedCard[];else cases.value=data.items as ModerationCase[];hasNext.value=data.hasNext;
 }catch(e){if(gen===generation&&who===identity())error.value=e instanceof Error?e.message:t('state.loadFailed');}finally{if(gen===generation)loading.value=false;}}
watch(tab,()=>{invalidate();offset.value=0;document.title=pageTitle(t('moderation.title'));void load();},{flush:'sync'});
function selectCase(item:ModerationCase){if(busy.value)return;clearSelection();selected.value=item;done.value='';}
const evidence=ref<{cardNumber:number;version:string;names:Record<string,string>;summaries:Record<string,string>;tags:string[];welcome:string;searchText:string;avatarUrl:string|null;nsfw:boolean}|null>(null);
async function readEvidence(){if(!selected.value||busy.value)return;const gen=selectionGeneration,who=identity(),id=selected.value.id;error.value='';try{
 const access=await token();if(gen!==selectionGeneration||who!==identity())return;
 const data=await moderationRequest<NonNullable<typeof evidence.value>>(`/cases/${id}/evidence`,access);
 if(alive&&gen===selectionGeneration&&who===identity())evidence.value=data;
 }catch(e){if(gen===selectionGeneration)error.value=e instanceof Error?e.message:t('state.loadFailed');}}
async function selectCard(item:ManagedCard){if(busy.value)return;clearSelection();const gen=selectionGeneration,who=identity();done.value='';loading.value=true;try{
 const access=await token();if(gen!==selectionGeneration||who!==identity())return;
 const data=await moderationRequest<CardHistory>(`/cards/${item.id}?lang=${locale.value}`,access);
 if(!alive||gen!==selectionGeneration||who!==identity())return;
 history.value=data;tagText.value=data.card.tags.join(', ');action.value=data.card.boardHidden?'restore_listing':'delist';operation.value=crypto.randomUUID();
 }catch(e){if(gen===selectionGeneration)error.value=e instanceof Error?e.message:t('state.loadFailed');}finally{if(gen===selectionGeneration)loading.value=false;}}
async function perform(path:string,body:unknown,label:string,effect:string){
 if(busy.value||!reason.value.trim())return;
 const origin=document.activeElement as HTMLElement|null;const who=identity(),gen=selectionGeneration;busy.value=true;ownConfirmation=true;
 try{
 const ok=await confirmDialog({title:label,message:effect,detail:selected.value?.title??history.value?.card.name,confirmText:label,cancelText:t('moderation.cancel'),danger:true});if(alive&&who===identity()&&gen===selectionGeneration)ownConfirmation=false;
 if(!ok||!alive||who!==identity()||gen!==selectionGeneration)return;
 const access=await token();if(!alive||who!==identity()||gen!==selectionGeneration)return;
 error.value='';done.value='';await moderationRequest(path,access,body);
 if(!alive||who!==identity()||gen!==selectionGeneration)return;
 done.value=t('moderation.saved');operation.value=crypto.randomUUID();clearSelection();busy.value=false;await load();await reviewer.refresh();
 }catch(e){if(who===identity()&&gen===selectionGeneration)error.value=e instanceof Error?e.message:t('moderation.error.retry');}finally{if(alive&&who===identity()&&gen===selectionGeneration){ownConfirmation=false;busy.value=false;await nextTick();if(alive&&gen===selectionGeneration)origin?.focus();}}}
function vote(vote:'confirm'|'oppose'){if(!selected.value)return;return perform(`/cases/${selected.value.id}/vote`,{vote,reason:reason.value.trim()},t(`moderation.${vote}`),t(vote==='confirm'?`moderation.effect.${selected.value.action}`:'moderation.oppositionEffect'));}
function resolve(decision:'confirm'|'dismiss'){if(!selected.value)return;return perform(`/cases/${selected.value.id}/resolve`,{decision,reason:reason.value.trim()},t(`moderation.${decision}`),t(decision==='confirm'?`moderation.effect.${selected.value.action}`:'moderation.dismissEffect'));}
function propose(){if(!history.value)return;return perform('/cases',{cardId:history.value.card.id,action:action.value,reason:reason.value.trim(),operationId:operation.value},t(`moderation.action.${action.value}`),t(`moderation.proposal.${action.value}`));}
function adjust(kind:'tags'|'compensation'){if(!history.value)return;return perform(`/cards/${history.value.card.id}/${kind}`,{reason:reason.value.trim(),operationId:operation.value,...(kind==='tags'?{tags:tagText.value.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean)}:{board:board.value,hours:hours.value})},t(`moderation.${kind}`),kind==='compensation'?`${t('moderation.compensationEffect')} ${t(`moderation.board.${board.value}`)} · ${t('moderation.hours')}: ${hours.value}`:t('moderation.tagsEffect'));}
function page(delta:number){if(busy.value)return;offset.value=Math.max(0,offset.value+delta*30);selected.value=null;history.value=null;void load();}
function eventValue(item:CardHistory['events'][number]){try{const after=JSON.parse(item.afterValue);if(item.action==='tags')return `${JSON.parse(item.beforeValue).join(', ')} → ${after.join(', ')}`;return `${t(`moderation.board.${after.board}`)} · ${t('moderation.hours')}: ${after.milliseconds/3600000}`;}catch{return '';}}
onMounted(()=>{document.title=pageTitle(t('moderation.title'));void reviewer.refresh();void load();});
</script>
<template>
 <section class="moderation" :aria-label="t(`moderation.tab.${tab}`)">
  <p v-if="error" class="notice notice--error" role="alert">{{error}} <button class="btn btn--sm" :disabled="busy" @click="load">{{t('review.refresh')}}</button></p>
  <p v-if="done" class="notice" role="status">{{done}}</p>
  <form v-if="tab==='cards'" class="work-search" @submit.prevent="offset=0;load()"><input v-model="q" class="input" type="search" :placeholder="t('moderation.search')" :aria-label="t('moderation.search')"/><button class="btn btn--primary" :disabled="loading||busy">{{t('moderation.find')}}</button></form>
  <div class="work-grid">
   <section class="work-list" :aria-busy="loading">
    <template v-if="loading"><div v-for="n in 3" :key="n" class="ghost work-ghost"/></template>
    <template v-else-if="tab==='cards'"><button v-for="card in cards" :key="card.id" class="work-item panel" :disabled="busy" @click="selectCard(card)"><strong>{{card.name}}</strong><span class="subtle">{{t(card.publicBlocked?'moderation.blocked':card.boardHidden?'moderation.unlisted':'moderation.listed')}}</span></button></template>
    <template v-else><button v-for="item in cases" :key="item.id" :data-case="item.id" :disabled="busy" class="work-item panel" :class="{'work-item--urgent':item.action==='suspend'&&item.status==='pending'}" @click="selectCase(item)"><span class="work-line"><strong>{{item.title}}</strong><span class="chip">{{t(`moderation.status.${item.status}`)}}</span></span><span>{{t(`moderation.action.${item.action}`)}}</span><span class="subtle">{{dateTime(item.createdAt)}}</span></button></template>
    <div v-if="!loading&&!(tab==='cards'?cards.length:cases.length)" class="panel work-empty"><p>{{t(tab==='cards'?'moderation.noCards':'moderation.noCases')}}</p><button class="btn btn--sm" @click="q='';offset=0;load()">{{t('review.refresh')}}</button></div>
    <div class="work-pager"><button class="btn btn--sm" :disabled="offset===0||loading||busy" @click="page(-1)">{{t('moderation.previous')}}</button><button class="btn btn--sm" :disabled="!hasNext||loading||busy" @click="page(1)">{{t('moderation.next')}}</button></div>
   </section>
   <section class="panel work-detail">
    <template v-if="selected">
     <h2>{{selected.title}}</h2><p class="subtle">{{t('moderation.cardNumber')}} {{selected.cardNumber}} · {{t('moderation.version')}} {{selected.version}}</p>
     <button class="btn btn--sm" :disabled="busy" @click="readEvidence">{{t('moderation.evidence')}}</button>
     <div v-if="evidence" class="work-evidence"><p class="notice">{{t('moderation.evidenceHint')}}</p><img v-if="evidence.avatarUrl" class="work-art" :src="evidence.avatarUrl" alt=""/><dl><template v-for="(value,key) in evidence.names" :key="`n-${key}`"><dt>{{key}}</dt><dd>{{value}}</dd></template></dl><p v-for="(value,key) in evidence.summaries" :key="key" class="work-reason">{{value}}</p><p>{{evidence.tags.join(', ')}}</p><pre class="work-reason">{{evidence.welcome||evidence.searchText}}</pre></div><p class="notice">{{t(`moderation.effect.${selected.action}`)}}</p><p class="work-reason">{{selected.reason}}</p>
     <ol class="work-timeline"><li v-for="(v,i) in selected.votes" :key="i"><strong>{{t(`moderation.${v.vote}`)}}</strong> · {{dateTime(v.at)}}<p>{{v.reason}}</p></li></ol>
     <p v-if="selected.resolution" class="work-reason">{{selected.resolution.startsWith('moderation.resolution.')?t(selected.resolution):selected.resolution}}</p>
     <template v-if="selected.canVote||selected.canResolve"><label for="case-reason">{{t('moderation.reason')}}</label><textarea id="case-reason" v-model="reason" class="input" rows="4" maxlength="2000" :disabled="busy"/><div class="work-actions"><template v-if="selected.canVote"><button data-vote="oppose" class="btn" :disabled="busy||!reason.trim()" @click="vote('oppose')">{{t('moderation.oppose')}}</button><button data-vote="confirm" class="btn btn--danger" :disabled="busy||!reason.trim()" @click="vote('confirm')">{{t('moderation.confirm')}}</button></template><template v-else><button class="btn" :disabled="busy||!reason.trim()" @click="resolve('dismiss')">{{t('moderation.dismiss')}}</button><button class="btn btn--danger" :disabled="busy||!reason.trim()" @click="resolve('confirm')">{{t('moderation.confirm')}}</button></template></div></template>
     <p v-else class="subtle">{{t('moderation.waitPeer')}}</p>
    </template>
    <template v-else-if="history">
     <h2>{{history.card.name}}</h2><p class="notice">{{t(history.card.publicBlocked?'moderation.blocked':history.card.boardHidden?'moderation.unlisted':'moderation.listed')}}</p>
     <label for="case-action">{{t('moderation.chooseAction')}}</label><select id="case-action" v-model="action" class="input" :disabled="busy"><option v-for="value in actions" :key="value" :value="value">{{t(`moderation.action.${value}`)}}</option></select>
     <p class="subtle">{{t(`moderation.proposal.${action}`)}}</p><label for="card-reason">{{t('moderation.reason')}}</label><textarea id="card-reason" v-model="reason" class="input" rows="4" maxlength="2000" :disabled="busy"/>
     <button class="btn btn--danger work-submit" :disabled="busy||!reason.trim()" @click="propose">{{t(`moderation.action.${action}`)}}</button>
     <details v-if="isManager" class="work-tools"><summary>{{t('moderation.tools')}}</summary><label for="card-tags">{{t('moderation.tagsLabel')}}</label><input id="card-tags" v-model="tagText" class="input" :disabled="busy"/><button class="btn" :disabled="busy||!reason.trim()" @click="adjust('tags')">{{t('moderation.tags')}}</button><label for="comp-board">{{t('moderation.board')}}</label><select id="comp-board" v-model="board" class="input"><option v-for="value in ['day','week','month']" :key="value" :value="value">{{t(`moderation.board.${value}`)}}</option></select><label for="comp-hours">{{t('moderation.hours')}}</label><input id="comp-hours" v-model.number="hours" class="input" type="number" min="0.25" max="720" step="0.25"/><button class="btn" :disabled="busy||!reason.trim()||!hours" @click="adjust('compensation')">{{t('moderation.compensation')}}</button><p class="subtle">{{t('moderation.compensationEffect')}}</p></details>
     <h3>{{t('moderation.tab.history')}}</h3><ol class="work-timeline"><li v-for="item in history.cases" :key="item.id"><strong>{{t(`moderation.action.${item.action}`)}}</strong> · {{t(`moderation.status.${item.status}`)}}<p>{{item.reason}}</p><time>{{dateTime(item.createdAt)}}</time></li><li v-for="item in history.reviews" :key="item.id"><strong>{{t('moderation.reviewQueue')}}</strong> · {{t(`moderation.status.${item.status}`)}}<p>{{item.note}}</p><time>{{dateTime(item.submittedAt)}}</time></li><li v-for="(item,i) in history.events" :key="i"><strong>{{t(`moderation.${item.action}`)}}</strong><p>{{item.reason}}</p><p class="subtle">{{eventValue(item)}}</p><time>{{dateTime(item.at)}}</time></li></ol><p v-if="!history.cases.length&&!history.reviews.length&&!history.events.length" class="subtle">{{t('moderation.noHistory')}}</p>
    </template>
    <div v-else class="work-empty"><h2>{{t('moderation.select')}}</h2><p class="subtle">{{t('moderation.selectHint')}}</p></div>
   </section>
  </div>
 </section>
</template>
<style scoped>
.work-actions,.work-search,.work-pager{display:flex;gap:var(--s-2);flex-wrap:wrap;align-items:center;}
.work-search{margin-bottom:var(--s-4);}.work-search .input{flex:1;min-width:180px;}
.work-grid{display:grid;grid-template-columns:minmax(240px,0.85fr) minmax(0,1.4fr);gap:var(--s-4);align-items:start;}
.work-list{display:grid;gap:var(--s-3);}.work-item{display:grid;gap:var(--s-2);padding:var(--s-4);width:100%;text-align:start;color:var(--text);font:inherit;cursor:pointer;border:1px solid var(--line);}
.work-item:hover,.work-item:focus-visible{border-color:var(--accent);background:var(--surface-2);}.work-item--urgent{border-inline-start:3px solid var(--danger);}
.work-line{display:flex;gap:var(--s-2);justify-content:space-between;align-items:start;flex-wrap:wrap;}.work-detail{padding:var(--s-5);display:grid;gap:var(--s-3);min-width:0;overflow-wrap:anywhere;}
.work-detail h2{font-size:22px;}.work-detail h3{font-size:17px;margin-top:var(--s-4);}.work-detail label{font-size:13px;font-weight:600;}.work-detail .input{width:100%;}.work-reason{white-space:pre-wrap;}.work-submit{justify-self:start;}
.work-timeline{padding-inline-start:var(--s-5);margin:0;display:grid;gap:var(--s-4);font-size:14px;}.work-timeline p{white-space:pre-wrap;margin:var(--s-1) 0;}.work-timeline time{color:var(--text-3);font-size:12px;}
.work-art{max-width:160px;border-radius:var(--r-md);}.work-evidence{min-width:0;}.work-evidence pre{overflow-wrap:anywhere;font:inherit;}.work-evidence dd{margin:0 0 var(--s-2);}.work-item:disabled{cursor:default;opacity:.6;}.work-empty{padding:var(--s-5);display:grid;gap:var(--s-3);}.work-ghost{height:110px;border-radius:var(--r-md);}.work-tools{border-top:1px solid var(--line);padding-top:var(--s-4);}.work-tools summary{cursor:pointer;font-weight:600;margin-bottom:var(--s-3);}.work-tools[open]>:not(summary){margin-bottom:var(--s-3);}.work-tools label{display:block;}
@media(max-width:760px){.moderation .btn,.moderation input,.moderation select{min-height:44px;}.work-tools summary{min-height:44px;display:flex;align-items:center;}.work-grid{grid-template-columns:minmax(0,1fr);}.work-detail{padding:var(--s-4);}.work-actions .btn{flex:1;}.work-list{max-height:45vh;overflow:auto;padding:2px;}}
</style>
