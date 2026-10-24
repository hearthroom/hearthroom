<script setup lang="ts">
import {reactive} from 'vue';
import {useI18n} from 'vue-i18n';
import {useSession} from '@/lib/session';
import {libraryRequest,isUnavailableFavorite,type LibraryFavorite} from '@/lib/library';
import CardTile from './CardTile.vue';
import AccountIcon from './AccountIcon.vue';
defineProps<{items:LibraryFavorite[]}>();
const emit=defineEmits<{removed:[bookmarkId:string]}>();
const session=useSession(),{t}=useI18n();
const busy=reactive(new Set<string>()),errors=reactive(new Set<string>());
async function remove(id:string){
 if(busy.has(id))return;
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
  <template v-for="item in items" :key="isUnavailableFavorite(item)?item.bookmarkId:item.id">
   <article v-if="isUnavailableFavorite(item)" class="favorite-placeholder">
    <div class="favorite-placeholder__cover" aria-hidden="true"><AccountIcon name="cards" /></div>
    <span class="chip">{{t('library.historyClosed')}}</span>
    <button class="btn ghost" type="button" :disabled="busy.has(item.bookmarkId)" :aria-busy="busy.has(item.bookmarkId)||undefined" @click="remove(item.bookmarkId)">{{t('library.removeUnavailable')}}</button>
    <p v-if="errors.has(item.bookmarkId)" role="alert">{{t('library.saveFailed')}}</p>
   </article>
   <CardTile v-else :card="item" />
  </template>
 </div>
</template>
<style scoped>
.favorite-grid { display:grid; gap:var(--s-5) var(--s-4); grid-template-columns:repeat(2,minmax(0,1fr)); }
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
