<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {useI18n} from 'vue-i18n';
import {useLocalePath} from '@/lib/use-locale';
import {displayName} from '@/lib/display-name';
import {platformPath} from '@/lib/connection-ui';
import {hueFrom,relativeTime} from '@/lib/format';
import {wrapTab} from '@/lib/focus-trap';
import type {ConversationSummary} from '@/lib/library';
import AccountIcon from './AccountIcon.vue';
import CoverImg from './CoverImg.vue';
const props=defineProps<{chats:ConversationSummary[];locked?:boolean}>();
const emit=defineEmits<{remove:[chat:ConversationSummary];hide:[chat:ConversationSummary]}>();
const {t}=useI18n(),{locale,lp}=useLocalePath();
const mobile=ref(false);
const opened=ref<ConversationSummary>(),menu=ref<HTMLElement>(),position=ref({left:'0px',top:'0px'});
let trigger:HTMLElement|undefined;
const title=(c:ConversationSummary)=>c.conversationTitle||displayName(c.roleName,locale.value)||t('library.untitled');
const time=(c:ConversationSummary)=>{const n=Date.parse(c.lastChatTime||c.createTime||'');return Number.isFinite(n)?relativeTime(n):'';};
function close(){opened.value=undefined;trigger?.focus();}
async function open(event:MouseEvent,chat:ConversationSummary){
 if(props.locked)return;
 if(opened.value?.conversationId===chat.conversationId){close();return;}
 trigger=event.currentTarget as HTMLElement;mobile.value=innerWidth<=480;
 const rect=trigger.getBoundingClientRect();
 position.value={left:`${Math.max(12,Math.min(innerWidth-312,rect.right-300))}px`,top:`${Math.max(12,Math.min(innerHeight-250,rect.bottom+8))}px`};
 opened.value=chat;await nextTick();
 if(!mobile.value&&menu.value){position.value.top=`${Math.max(12,Math.min(innerHeight-menu.value.getBoundingClientRect().height-12,rect.bottom+8))}px`;}
 menu.value?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
}
function act(kind:'hide'|'remove'){const chat=opened.value;if(!chat)return;close();if(kind==='hide')emit('hide',chat);else emit('remove',chat);}
function key(e:KeyboardEvent){
 if(!opened.value)return;
 if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
 const items=[...menu.value?.querySelectorAll<HTMLElement>('[role=menuitem]')??[]];
 if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
  e.preventDefault();const i=items.indexOf(document.activeElement as HTMLElement);
  items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();
 }
 wrapTab(e,menu.value??null);
}
function scroll(e:Event){if(opened.value&&!(e.target instanceof Node&&menu.value?.contains(e.target)))close();}
watch(()=>props.locked,locked=>{if(locked)close();});
watch(()=>props.chats,()=>{if(opened.value&&!props.chats.some(c=>c.conversationId===opened.value?.conversationId))close();});
onMounted(()=>{document.addEventListener('keydown',key);window.addEventListener('resize',close);window.addEventListener('scroll',scroll,true);});
onBeforeUnmount(()=>{document.removeEventListener('keydown',key);window.removeEventListener('resize',close);window.removeEventListener('scroll',scroll,true);});
</script>
<template>
 <div class="library__rows">
  <TransitionGroup name="conversation-row">
   <article v-for="chat in chats" :key="chat.conversationId" class="conversation panel" :class="{'conversation--closed':chat.canGenerate===false}">
    <a class="conversation__link" :href="platformPath(lp(`/play/${encodeURIComponent(chat.cardNumber??chat.conversationRoleId)}?resume=${encodeURIComponent(chat.conversationId)}`),chat.provider)" :aria-disabled="locked||undefined" @click="locked&&$event.preventDefault()">
     <CoverImg v-if="chat.roleAvatar" class="conversation__avatar" :src="chat.roleAvatar" loading="lazy" /><span v-else class="conversation__avatar mono" :style="{'--h':hueFrom(chat.roleName)}"><AccountIcon name="cards" /></span>
     <div class="conversation__body"><div class="conversation__heading"><h2>{{title(chat)}}</h2><span v-if="chat.reason==='author_private'" class="chip">{{t('library.historyClosed')}}</span><time v-if="time(chat)" :datetime="chat.lastChatTime||chat.createTime">{{time(chat)}}</time></div><p v-if="chat.conversationTitle" class="conversation__role muted">{{displayName(chat.roleName,locale)}}</p><p class="conversation__preview muted">{{t(chat.canGenerate===false?'library.historyHint':'library.resumeHint')}}</p></div>
     <span class="conversation__continue">{{t(chat.canGenerate===false?'library.viewHistory':'library.resume')}} <AccountIcon name="arrow" /></span>
    </a>
    <button class="btn btn--icon btn--ghost conversation__menu" :data-conversation-menu="chat.conversationId" :disabled="locked" :aria-label="t('library.recent.manage')" aria-haspopup="menu" :aria-expanded="opened?.conversationId===chat.conversationId" @click="open($event,chat)"><AccountIcon name="more" /></button>
   </article>
  </TransitionGroup>
 </div>
 <Teleport to="body">
  <div v-if="opened" class="conversation-menu-backdrop" :role="mobile?'dialog':undefined" :aria-modal="mobile||undefined" :aria-label="mobile?t('library.recent.manage'):undefined" @click.self="close">
   <div ref="menu" class="conversation-menu panel" role="menu" :aria-label="t('library.recent.manage')" :style="position">
    <p class="conversation-menu__subject">{{displayName(opened.roleName,locale)}}<span v-if="opened.conversationTitle"> · {{opened.conversationTitle}}</span></p>
    <button role="menuitem" data-action="hide" @click="act('hide')"><AccountIcon name="eyeOff" /><span><strong>{{t('library.recent.hide')}}</strong><small>{{t('library.recent.hideHint')}}</small></span></button>
    <button role="menuitem" data-action="delete" class="conversation-menu__delete" @click="act('remove')"><AccountIcon name="trash" /><span><strong>{{t('library.recent.delete')}}</strong><small>{{t('library.recent.deleteHint')}}</small></span></button>
    <button class="btn conversation-menu__cancel" @click="close">{{t('dialog.cancel')}}</button>
   </div>
  </div>
 </Teleport>
</template>
<style scoped>
.library__rows{display:grid;gap:var(--s-3)}
.conversation{display:flex;align-items:center;gap:var(--s-2);padding-right:var(--s-3);min-width:0}
.conversation__link{display:flex;align-items:center;gap:var(--s-4);padding:var(--s-4);flex:1;min-width:0}
.conversation:hover{border-color:var(--border-strong)}
.conversation--closed .conversation__avatar{filter:grayscale(1);opacity:.7}
.conversation__avatar{width:72px;height:80px;border-radius:var(--r-sm);object-fit:cover;flex:none;display:grid;place-items:center}
.conversation__body{flex:1;min-width:0}.conversation__heading{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-3)}
.conversation h2{font-size:1rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.conversation time{color:var(--text-3);font-size:13px;white-space:nowrap}.conversation__role{font-size:13px;margin-top:var(--s-1)}
.conversation__preview{margin-top:var(--s-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;overflow-wrap:anywhere}
.conversation__continue{display:flex;align-items:center;gap:var(--s-2);color:var(--accent-text);font-size:14px;flex:none}
.conversation__menu{width:44px;min-height:44px;flex:none}
.conversation-menu-backdrop{position:fixed;inset:0;z-index:40}
.conversation-menu{position:fixed;width:300px;max-height:calc(100dvh - var(--s-6));overflow-y:auto;padding:var(--s-2);border-radius:var(--r-md);box-shadow:var(--shadow-md)}
.conversation-menu__subject{font-size:13px;color:var(--text-2);padding:var(--s-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.conversation-menu [role=menuitem]{width:100%;display:flex;align-items:flex-start;gap:var(--s-3);padding:var(--s-3);min-height:64px;text-align:left;background:transparent;border:0;border-radius:var(--r-sm);font:inherit;color:var(--text);cursor:pointer}
.conversation-menu [role=menuitem]:hover{background:var(--surface-2)}.conversation-menu [role=menuitem] span{min-width:0}.conversation-menu strong{display:block;font-size:14px;overflow-wrap:anywhere;font-weight:600}.conversation-menu small{display:block;margin-top:var(--s-1);font-size:12px;color:var(--text-2);overflow-wrap:anywhere}
.conversation-menu .conversation-menu__delete{color:var(--danger);border-top:1px solid var(--line);border-radius:0}.conversation-menu__cancel{display:none}
.conversation-row-leave-active{max-height:240px;transition:max-height var(--dur) var(--ease),opacity var(--dur) var(--ease)}.conversation-row-leave-to{max-height:0;opacity:0}
@media(max-width:700px){.conversation__continue{display:none}.conversation__avatar{width:52px;height:64px}.conversation__link{gap:var(--s-3)}.conversation__heading{flex-wrap:wrap;gap:var(--s-1)}.conversation time{font-size:12px}}
@media(max-width:480px){.conversation-menu-backdrop{background:color-mix(in srgb,var(--text) 24%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}.conversation-menu{left:0!important;top:auto!important;bottom:0;width:100%;border-radius:24px 24px 0 0;padding:var(--s-4) var(--s-4) calc(var(--s-4) + env(safe-area-inset-bottom))}.conversation-menu__cancel{display:flex;width:100%;min-height:44px;margin-top:var(--s-3)}}
@media(prefers-reduced-motion:reduce){.conversation-row-leave-active{transition:none}}
</style>
