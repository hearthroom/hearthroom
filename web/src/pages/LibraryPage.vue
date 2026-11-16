<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,shallowRef,watch} from 'vue';
import {useRoute,useRouter,onBeforeRouteLeave,onBeforeRouteUpdate} from 'vue-router';
import {useI18n} from 'vue-i18n';
import {useSession} from '@/lib/session';
import {useLocalePath} from '@/lib/use-locale';
import {displayName} from '@/lib/display-name';
import {fetchConversations,previewConversationDeletion,deleteConversations,setConversationHidden,restoreFavoriteBookmarks,libraryRequest,isUnavailableFavorite,type LibraryFavorite,type ConversationSummary,type ConversationDeletionPreview} from '@/lib/library';
import {confirmDialog,confirmState,settleConfirm} from '@/lib/confirm';
import {pageAway} from '@/pet/enabled';
import {contentLang,pageTitle} from '@/lib/i18n';
import {hueFrom} from '@/lib/format';
import CardGrid from '@/components/CardGrid.vue';
import FavoriteGrid from '@/components/FavoriteGrid.vue';
import LibraryToggle from '@/components/LibraryToggle.vue';
import AccountIcon from '@/components/AccountIcon.vue';
import MascotSay from '@/components/MascotSay.vue';
import ConversationRows from '@/components/ConversationRows.vue';
import ActionToast from '@/components/ActionToast.vue';
const session=useSession(),route=useRoute(),router=useRouter(),{locale,lp}=useLocalePath(),{t}=useI18n();
const tabs=['conversations','favorites','following'] as const;
const tab=computed(()=>tabs.includes(route.query.tab as typeof tabs[number])?route.query.tab as typeof tabs[number]:'conversations');
const page=computed(()=>Math.max(1,Math.floor(Number(route.query.page)||1)));
const chats=ref<ConversationSummary[]>([]),cards=ref<LibraryFavorite[]>([]),authors=ref<{handle:string;name:string;avatar:string;bio:string}[]>([]);
const loading=ref(true),failed=ref(false),hasNext=ref(false),managing=ref(false),selected=ref<string[]>([]),locked=ref(false);
const notice=ref(''),retry=shallowRef<(()=>Promise<void>)|undefined>();
let feedbackSequence=0;
const toast=shallowRef<{id:number;text:string;action?:()=>Promise<void>;label?:string}>();
const favoriteId=(item:LibraryFavorite)=>isUnavailableFavorite(item)?item.bookmarkId:item.id;
const allSelected=computed(()=>!!cards.value.length&&selected.value.length===cards.value.length);
const empty=computed(()=>!chats.value.length&&!cards.value.length&&!authors.value.length);
let sequence=0;
async function load(quiet=false){
 const seq=++sequence;if(!quiet){loading.value=true;failed.value=false;chats.value=[];cards.value=[];authors.value=[];hasNext.value=false;}
 document.title=pageTitle(t('library.title'));
 try{const token=await session.accessToken();if(!token)throw new Error('auth');
  if(tab.value==='conversations'){const result=await fetchConversations(token,contentLang(locale.value),page.value);if(seq===sequence){chats.value=result.conversations;hasNext.value=result.hasNextPage;}}
  else{const result=await libraryRequest<{items:LibraryFavorite[]|typeof authors.value;hasNext:boolean}>(`${tab.value}?offset=${(page.value-1)*24}&lang=${contentLang(locale.value)}`,token);if(seq===sequence){if(tab.value==='favorites')cards.value=result.items as LibraryFavorite[];else authors.value=result.items as typeof authors.value;hasNext.value=result.hasNext;}}
 }catch{if(seq===sequence){if(quiet){notice.value=t('library.loadFailed');retry.value=()=>load(true);}else failed.value=true;}}
 finally{if(seq===sequence)loading.value=false;}
}
function navigate(next:string,n=1){if(!locked.value)void router.push({query:{tab:next,...(n>1?{page:String(n)}:{})}});}
function feedback(text:string,action?:()=>Promise<void>,label=t('library.recent.undo')){toast.value={id:++feedbackSequence,text,action,label:action?label:undefined};}
function failure(text:string,action:()=>Promise<void>){notice.value=text;retry.value=action;feedback(text,action,t('library.retry'));}
function clearFailure(){notice.value='';retry.value=undefined;}
async function refill(){
 if(!empty.value)return;
 if(page.value>1){const pending=toast.value;const n=page.value-1;await router.push({query:{tab:tab.value,...(n>1?{page:String(n)}:{})}});if(pending)toast.value=pending;}
 else if(hasNext.value)await load(true);
}
async function hide(chat:ConversationSummary){
 if(locked.value)return;locked.value=true;const originalPage=page.value;
 try{const token=await session.accessToken();if(!token)throw new Error('auth');const result=await setConversationHidden(token,chat,true);if(!result.hidden)throw new Error('unconfirmed');
  chats.value=chats.value.filter(c=>c.conversationId!==chat.conversationId);clearFailure();
  feedback(t('library.recent.hidden'),()=>restore(chat,originalPage));
 }catch{failure(t('library.recent.hideFailed'),()=>hide(chat));}finally{locked.value=false;}
 await refill();
}
async function restore(chat:ConversationSummary,originalPage:number){
 if(locked.value)return;locked.value=true;
 try{const token=await session.accessToken();if(!token)throw new Error('auth');const result=await setConversationHidden(token,chat,false);if(result.hidden)throw new Error('unconfirmed');
  clearFailure();locked.value=false;await router.push({query:{tab:'conversations',...(originalPage>1?{page:String(originalPage)}:{})}});await load(true);feedback(t('library.recent.restored'));
 }catch{failure(t('library.recent.restoreFailed'),()=>restore(chat,originalPage));}finally{locked.value=false;}
}
async function remove(chat:ConversationSummary){
 if(locked.value)return;locked.value=true;let preview:ConversationDeletionPreview|undefined;
 const roleName=displayName(chat.roleName,locale.value);
 const subject=roleName?[roleName,chat.conversationTitle||t('library.recent.currentSegment')].join(' · '):chat.conversationTitle||t('library.untitled');
 try{
  const token=await session.accessToken();if(!token)throw new Error('auth');preview=await previewConversationDeletion(token,[chat],'current');
  const ok=await confirmDialog({title:t('library.recent.confirmTitle'),subject,message:t('library.recent.deleteIncludes'),consequences:[t('library.recent.deleteMessages'),t('library.recent.deleteMemory')],warning:t('library.recent.deleteWarning'),hint:t('library.recent.deleteAlternative'),confirmText:t('library.recent.confirmDelete'),cancelText:t('dialog.cancel'),danger:true,dangerAppearance:'subdued',busyText:t('library.manage.deleting'),pendingText:t('library.recent.resultPending'),retryText:t('library.retry'),pendingConfirmText:t('library.recent.checkResult'),onPending:async()=>{await load(true);settleConfirm(false);notice.value=t('library.recent.resultPending');retry.value=()=>load(true);},onConfirm:async()=>{
   // Expiry changes consent, never expand the selected segment silently.
   if(!preview)preview=await previewConversationDeletion(token,[chat],'current');
   let result;
   try{result=await deleteConversations(token,preview.selectionToken);}catch(error){if((error as {code?:string}).code==='selection_expired')preview=undefined;if(error instanceof TypeError||Number((error as {status?:number}).status)>=500)throw new TypeError('uncertain_delete');throw new Error(t('library.recent.deleteFailed'));}
   const outcome=result.results.find(r=>r.conversationId===chat.conversationId);
   if(outcome?.status==='busy')throw new Error(t('library.manage.rowBusy'));
   if(outcome?.status!=='deleted')throw new TypeError('uncertain_delete');
  }});
  if(ok){chats.value=chats.value.filter(c=>c.conversationId!==chat.conversationId);clearFailure();feedback(t('library.recent.deleted'));}
 }catch{failure(t('library.recent.deleteFailed'),()=>remove(chat));}finally{locked.value=false;}
 await refill();
}
function finish(){if(locked.value)return;managing.value=false;selected.value=[];clearFailure();}
function selectAll(){if(!locked.value)selected.value=allSelected.value?[]:cards.value.map(favoriteId);}
function removedFavorite(id:string){cards.value=cards.value.filter(c=>favoriteId(c)!==id);void refill();}
async function pool<T>(items:T[],work:(item:T)=>Promise<void>){let cursor=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(cursor<items.length){const item=items[cursor++];await work(item);}}));}
async function cancelFavorites(){
 if(locked.value||!selected.value.length)return;locked.value=true;
 const targets=cards.value.filter(c=>selected.value.includes(favoriteId(c))),successes=new Set<string>(),tokens:{id:string;token:string}[]=[];
 try{
  const token=await session.accessToken();if(!token)throw new Error('auth');
  await pool(targets,async item=>{try{const id=favoriteId(item),result=await libraryRequest<{active:boolean;restoreToken?:string}>(`favorites/${encodeURIComponent(id)}`,token,'DELETE');if(result.active!==false)throw new Error('unconfirmed');successes.add(id);if(result.restoreToken)tokens.push({id,token:result.restoreToken});}catch{/* Retain only failed items for the explicit retry. */}});
  cards.value=cards.value.filter(c=>!successes.has(favoriteId(c)));selected.value=targets.map(favoriteId).filter(id=>!successes.has(id));
  if(selected.value.length){failure(t(successes.size?'library.favoritesBulk.partial':'library.favoritesBulk.failed',{n:successes.size,failed:selected.value.length}),cancelFavorites);}
  else{finishAfterMutation();feedback(t('library.favoritesBulk.cancelled',{n:successes.size},successes.size),tokens.length?()=>restoreFavorites(tokens):undefined);}
 }catch{failure(t('library.favoritesBulk.failed'),cancelFavorites);}finally{locked.value=false;}
 await refill();
}
function finishAfterMutation(){managing.value=false;selected.value=[];clearFailure();}
async function restoreFavorites(tokens:{id:string;token:string}[]){
 if(locked.value)return;locked.value=true;
 try{const token=await session.accessToken();if(!token)throw new Error('auth');const result=await restoreFavoriteBookmarks(token,tokens.map(v=>v.token));if(!Array.isArray(result.restoredIds))throw new Error('unconfirmed');const missing=tokens.filter(v=>!result.restoredIds.includes(v.id));if(missing.length){notice.value=t(result.restoredIds.length?'library.favoritesBulk.restorePartial':'library.favoritesBulk.restoreUnavailable',{n:result.restoredIds.length,failed:missing.length});retry.value=undefined;feedback(notice.value);}else{clearFailure();feedback(t('library.favoritesBulk.restored'));}await load(true);}
 catch(error){if((error as {code?:string}).code==='restoration_expired'){notice.value=t('library.favoritesBulk.restoreExpired');retry.value=undefined;feedback(notice.value);}else failure(t('library.favoritesBulk.restoreFailed'),()=>restoreFavorites(tokens));}finally{locked.value=false;}
}
function key(e:KeyboardEvent){if(e.key==='Escape'&&managing.value&&!locked.value&&!confirmState.current){e.preventDefault();finish();}}
watch(managing,on=>{pageAway.value+=on?1:-1;},{flush:'sync'});
watch([tab,page],()=>{managing.value=false;selected.value=[];toast.value=undefined;clearFailure();});
watch([tab,page,locale,()=>session.me,()=>session.profile?.showNsfw,()=>session.profile?.hiddenTags?.join(',')],()=>{void load();},{immediate:true});
onMounted(()=>document.addEventListener('keydown',key));onBeforeRouteLeave(()=>!locked.value);onBeforeRouteUpdate(()=>!locked.value);
onBeforeUnmount(()=>{document.removeEventListener('keydown',key);if(managing.value)pageAway.value--;sequence++;});
</script>
<template>
 <div class="page library" :class="{'library--manage':managing}">
  <header class="library__header"><div><p class="eyebrow">{{$t('library.eyebrow')}}</p><h1 class="display">{{$t('library.title')}}</h1><p class="muted">{{$t('library.hint')}}</p></div><RouterLink class="btn library__discover" :to="lp('/')">{{$t('library.discover')}} <AccountIcon name="arrow" /></RouterLink></header>
  <nav class="library__tabs" :inert="locked" :aria-label="$t('library.title')"><RouterLink v-for="item in tabs" :key="item" :to="{path:lp('/library'),query:{tab:item}}" :aria-current="tab===item?'page':undefined" :class="{'library__tab--on':tab===item}">{{$t(`library.${item}`)}}</RouterLink></nav>
  <div class="library__context"><p class="muted">{{$t(`library.${tab}Hint`)}}</p><button v-if="tab==='favorites'&&!loading&&cards.length" class="btn btn--ghost" data-favorite-select :disabled="locked" @click="managing?finish():managing=true">{{$t(managing?'library.favoritesBulk.cancelSelection':'library.favoritesBulk.select')}}</button></div>
  <div v-if="notice" class="notice notice--error library__failure" role="alert"><p>{{notice}}</p><button v-if="retry" class="btn" :disabled="locked" @click="retry()">{{$t('library.retry')}}</button></div>
  <div v-if="failed" class="empty panel" role="alert"><p class="empty__title">{{$t('library.loadFailed')}}</p><button class="btn" @click="load()">{{$t('library.retry')}}</button></div>
  <CardGrid v-else-if="tab==='favorites'&&loading" :cards="[]" loading />
  <FavoriteGrid v-else-if="tab==='favorites'&&!empty" :items="cards" :managing="managing" v-model:selected="selected" :locked="locked" @removed="removedFavorite" />
  <div v-else-if="loading" class="library__rows" aria-hidden="true"><div v-for="n in 4" :key="n" class="ghost library__ghost" /></div>
  <div v-else-if="empty" class="empty panel library__empty"><MascotSay src="/mascot/chuchu-sleep.webp" :size="132" /><h2 class="empty__title">{{$t(`library.${tab}Empty`)}}</h2><p class="empty__hint muted">{{$t(tab==='conversations'?'library.conversationsEmptyHint':`library.${tab}Hint`)}}</p><RouterLink class="btn" :to="lp('/')">{{$t('library.discover')}}</RouterLink></div>
  <ConversationRows v-else-if="tab==='conversations'" :chats="chats" :locked="locked" @remove="remove" @hide="hide" />
  <div v-else class="library__authors"><article v-for="author in authors" :key="author.handle" class="followed panel"><RouterLink class="followed__identity" :to="lp(`/authors/${author.handle}`)"><img v-if="author.avatar" :src="author.avatar" alt="" /><span v-else class="mono" :style="{'--h':hueFrom(author.name)}">{{[...author.name][0]}}</span><div><h2>{{author.name}}</h2><p class="muted">{{author.bio||$t('library.authorHint')}}</p></div></RouterLink><LibraryToggle kind="following" :target="author.handle" :initial-active="true" /></article></div>
  <nav v-if="!loading&&!failed&&(page>1||hasNext)" class="pager" :aria-label="$t('library.title')"><button class="btn" :disabled="page===1||locked" @click="navigate(tab,page-1)">{{$t('pager.prev')}}</button><span class="muted">{{$t('pager.page',{n:page})}}</span><button class="btn" :disabled="!hasNext||locked" @click="navigate(tab,page+1)">{{$t('pager.next')}}</button></nav>
  <div v-if="managing" class="library__bottom"><span role="status">{{$t('library.favoritesBulk.selected',{n:selected.length})}}</span><button class="btn btn--ghost" data-favorite-all :disabled="locked||loading" @click="selectAll">{{$t(allSelected?'library.favoritesBulk.clearAll':'library.favoritesBulk.selectAll')}}</button><button class="btn btn--primary btn--lg" data-favorite-cancel :disabled="!selected.length||locked" @click="cancelFavorites"><span :class="{'library__button-placeholder':locked}">{{$t('library.favoritesBulk.cancelN',{n:selected.length})}}</span><span v-if="locked" class="library__button-busy"><AccountIcon name="refresh" class="library__spinner" />{{$t('library.favoritesBulk.cancelling')}}</span></button></div>
  <ActionToast v-if="toast" :key="toast.id" :message="toast.text" :action-label="toast.label" :busy="locked" @action="toast?.action?.()" @dismiss="toast=undefined" />
 </div>
</template>
<style scoped>
.library{max-width:1120px}.library__header{display:flex;align-items:center;justify-content:space-between;gap:var(--s-5);padding-block:var(--s-5) var(--s-6)}.library__header h1{font-size:clamp(1.75rem,4vw,2.25rem);margin-block:var(--s-2)}.library__header p{max-width:48ch}.library__discover{flex:none;min-height:44px}
.library__tabs{display:flex;gap:var(--s-5);border-bottom:1px solid var(--border)}.library__tabs a{display:flex;align-items:center;min-height:48px;padding:var(--s-3) var(--s-1);font-weight:600;color:var(--text-2);border-bottom:2px solid transparent;text-align:center}.library__tabs .library__tab--on{color:var(--accent-text);border-color:var(--accent)}
.library__context{display:flex;align-items:center;gap:var(--s-3);justify-content:space-between;padding-block:var(--s-5);font-size:14px}.library__context p{min-width:0}.library__context .btn{flex:none;min-height:44px}
.library__failure{display:flex;align-items:center;justify-content:space-between;gap:var(--s-3);margin-bottom:var(--s-4)}.library__failure p{overflow-wrap:anywhere}.library__failure .btn{flex:none}
.library__rows{display:grid;gap:var(--s-3)}.library__ghost{min-height:112px;border-radius:var(--r-lg)}.library__authors{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-4)}.followed{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:var(--s-4);padding:var(--s-5)}.followed__identity{display:flex;align-items:center;gap:var(--s-3);min-width:0;flex:1}.followed__identity>img,.followed__identity>span{width:48px;height:48px;border-radius:var(--r-pill);object-fit:cover;flex:none}.followed__identity div{min-width:0}.followed h2{font-size:1rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.followed__identity p{font-size:.875rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:var(--s-1)}
.library__empty{display:grid;justify-items:center;gap:var(--s-3);padding:var(--s-7) var(--s-5)}.empty .btn{min-height:44px;margin-top:var(--s-3)}
.library__bottom{position:sticky;bottom:var(--s-3);z-index:15;display:flex;align-items:center;gap:var(--s-3);padding:var(--s-3);margin-top:var(--s-5);background:color-mix(in srgb,var(--bg) 84%,transparent);backdrop-filter:blur(16px) saturate(1.2);-webkit-backdrop-filter:blur(16px) saturate(1.2);border:1px solid var(--line);border-radius:var(--r-lg);box-shadow:var(--shadow-md)}.library__bottom>span{flex:1;font-size:14px}.library__bottom .btn--primary{position:relative}.library__button-placeholder{visibility:hidden}.library__button-busy{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:var(--s-2)}.library__spinner{animation:library-spin var(--dur-slow) linear infinite}@keyframes library-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.library__spinner{animation:none}}
@media(max-width:700px){.library__header{align-items:flex-start}.library__discover{display:none}.library__tabs{gap:var(--s-4)}.library__tabs a{flex:1;justify-content:center}.library__authors{grid-template-columns:minmax(0,1fr)}.library__context p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.library__bottom{position:fixed;bottom:0;left:0;right:0;border-radius:0;padding:var(--s-3) max(var(--s-3),env(safe-area-inset-right)) calc(var(--s-3) + env(safe-area-inset-bottom)) max(var(--s-3),env(safe-area-inset-left));flex-wrap:wrap}.library__bottom .btn{min-height:44px}.library__bottom .btn--primary{flex:1}.library--manage{padding-bottom:calc(140px + env(safe-area-inset-bottom))}}
:lang(ko) .library__failure,:lang(ko) .library__bottom{word-break:keep-all}
</style>
