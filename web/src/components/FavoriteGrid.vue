<script setup lang="ts">
import {reactive} from 'vue';
import {useI18n} from 'vue-i18n';
import {useSession} from '@/lib/session';
import {libraryRequest,isUnavailableFavorite,type LibraryFavorite} from '@/lib/library';
import {useLocalePath} from '@/lib/use-locale';
import {displayName} from '@/lib/display-name';
import CardTile from './CardTile.vue';
import AccountIcon from './AccountIcon.vue';
const props=withDefaults(defineProps<{items:LibraryFavorite[];managing?:boolean;selected?:string[];locked?:boolean}>(),{managing:false,selected:()=>[],locked:false});
const emit=defineEmits<{removed:[bookmarkId:string];'update:selected':[ids:string[]]}>();
const session=useSession(),{t}=useI18n(),{locale}=useLocalePath();
const itemId=(item:LibraryFavorite)=>isUnavailableFavorite(item)?item.bookmarkId:item.id;
const itemName=(item:LibraryFavorite)=>isUnavailableFavorite(item)?t('library.historyClosed'):displayName(item.name,locale.value);
function select(event:Event,item:LibraryFavorite){
 if(!props.managing || (event.target instanceof Element && event.target.closest(".cover-reveal")))return;
 event.preventDefault();event.stopPropagation();
 if(props.locked)return;
 const id=itemId(item),next=new Set(props.selected);
 if(next.has(id))next.delete(id);else next.add(id);
 emit('update:selected',[...next]);
}
function key(event:KeyboardEvent,item:LibraryFavorite){
 if(event.key===' '||event.key==='Enter')select(event,item);
}
const selectors = new Map<string, HTMLElement>();
function rememberSelector(id:string, el:unknown){
 if(el instanceof HTMLElement)selectors.set(id,el);else selectors.delete(id);
}
const busy=reactive(new Set<string>()),errors=reactive(new Set<string>());
async function remove(id:string){
 if(props.locked||props.managing||busy.has(id))return;
 busy.add(id);errors.delete(id);
 try{
  const token=await session.accessToken();if(!token)throw new Error('auth');
  const result=await libraryRequest<{active:boolean}>(`favorites/${encodeURIComponent(id)}`,token,'DELETE');
  if(result.active!==false)throw new Error('unconfirmed');
  emit('removed',id);
 }catch{errors.add(id);}finally{busy.delete(id);}
}
</script>
<template>
 <div class="favorite-grid">
  <div v-for="item in items" :key="itemId(item)" class="favorite-grid__item" :class="{'favorite-grid__item--selectable':managing,'favorite-grid__item--selected':managing&&selected.includes(itemId(item))}"
   @click.capture="select($event,item)">
   <span v-if="managing" :ref="el=>rememberSelector(itemId(item),el)" class="favorite-grid__check" role="checkbox"
     :aria-checked="selected.includes(itemId(item))" :aria-disabled="locked||undefined" :aria-label="itemName(item)"
     :tabindex="locked?-1:0" @keydown="key($event,item)">
     <svg v-if="selected.includes(itemId(item))" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
   </span>
   <div class="favorite-grid__content">
   <article v-if="isUnavailableFavorite(item)" class="favorite-placeholder">
    <div class="favorite-placeholder__cover" aria-hidden="true"><AccountIcon name="cards" /></div>
    <span class="chip">{{t('library.historyClosed')}}</span>
    <button v-if="!managing" class="btn ghost" type="button" :disabled="locked||busy.has(item.bookmarkId)" :aria-busy="busy.has(item.bookmarkId)||undefined" @click="remove(item.bookmarkId)">{{t('library.removeUnavailable')}}</button>
    <p v-if="errors.has(item.bookmarkId)" role="alert">{{t('library.saveFailed')}}</p>
   </article>
   <CardTile v-else :card="item" :select-only="managing" @revealed="selectors.get(itemId(item))?.focus({preventScroll:true})" />
   </div>
  </div>
 </div>
</template>
<style scoped>
.favorite-grid { display:grid; gap:var(--s-5) var(--s-4); grid-template-columns:repeat(2,minmax(0,1fr)); }
.favorite-grid__item { position:relative; min-width:0; border-radius:var(--r-md); }
.favorite-grid__content,.favorite-grid__content :deep(.card) { height:100%; }
.favorite-grid__item--selectable { cursor:pointer; }
.favorite-grid__item--selectable .favorite-grid__content { user-select:none; }
.favorite-grid__item--selected::after { content:''; position:absolute; inset:0; z-index:2; border:3px solid var(--accent); border-radius:inherit; background:color-mix(in srgb,var(--accent) 16%,transparent); pointer-events:none; }
.favorite-grid__check { position:absolute; z-index:3; top:var(--s-2); left:var(--s-2); width:26px; height:26px; display:grid; place-items:center; border:1.5px solid #fff; border-radius:var(--r-pill); color:#fff; background:rgba(16,16,24,.6); box-shadow:var(--shadow-sm); }
.favorite-grid__check svg { width:20px; height:20px; }
.favorite-grid__item--selected .favorite-grid__check { border-color:var(--accent-btn); background:var(--accent-btn); color:var(--on-accent); }
@media(max-width:760px) { .favorite-grid__check { width:28px; height:28px; } }
@media (min-width:600px) { .favorite-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (min-width:820px) { .favorite-grid { grid-template-columns:repeat(4,minmax(0,1fr)); } }
@media (min-width:1080px) { .favorite-grid { grid-template-columns:repeat(6,minmax(0,1fr)); } }
.favorite-placeholder { display:flex; flex-direction:column; align-items:flex-start; gap:var(--s-3); min-width:0; color:var(--text-2); }
.favorite-placeholder__cover { display:grid; place-items:center; width:100%; aspect-ratio:3/4; background:var(--surface-2); border-radius:var(--r-md); color:var(--text-3); }
.favorite-placeholder__cover :deep(svg) { width:var(--s-6); height:var(--s-6); }
.favorite-placeholder .chip { white-space:normal; }
.favorite-placeholder .btn { min-height:var(--h-lg); }
.favorite-placeholder p { color:var(--danger); font-size:13px; overflow-wrap:anywhere; }
</style>
