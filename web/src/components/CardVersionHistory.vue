<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue';
import {useI18n} from 'vue-i18n';
import {fetchCardVersions,type CardVersion} from '@/lib/api';
const props=defineProps<{cardId:string;target?:string}>();
const {t,locale}=useI18n();
const root=ref<HTMLElement|null>(null),items=ref<CardVersion[]>([]),batches=ref<CardVersion[][]>([]),selected=ref<CardVersion|null>(null);
const busy=ref(false),moreBusy=ref(false),failed=ref(false),moreFailed=ref(false),historyOpen=ref(false),hasMore=ref(false),page=ref(1),opened=ref(new Set<string>());
let generation=0;
const latest=computed(()=>items.value[0]);
type Group={key:string;items:CardVersion[];silent:boolean};
const groups=computed(()=>{
 const result:Group[]=[];
 for(const [index,batch] of batches.value.entries()){
  let previous:Group|undefined;
  for(const item of batch){
   if(item.updateKind==='minor'&&previous?.silent){previous.items.push(item);continue;}
   previous={key:`${index}:${item.versionId}`,items:[item],silent:item.updateKind==='minor'};result.push(previous);
  }
 }
 if(selected.value&&selected.value.versionId!==latest.value?.versionId&&!items.value.some(v=>v.versionId===selected.value!.versionId))result.push({key:'target:'+selected.value.versionId,items:[selected.value],silent:selected.value.updateKind==='minor'});
 return result;
});
function dateLine(v:CardVersion){
 if(v.publishedAt===null||!Number.isFinite(v.publishedAt))return t('cardUpdate.history.dateUnknown');
 const date=new Intl.DateTimeFormat(locale.value,{dateStyle:'medium',timeStyle:'short'}).format(v.publishedAt);
 return t(v.publicationTimeSource==='published'?'cardUpdate.history.publishedAt':'cardUpdate.history.reviewedAt',{date});
}
const dateHint=(v:CardVersion)=>v.publicationTimeSource==='review'?'cardUpdate.history.reviewTimeHint':v.publicationTimeSource==='unknown'?'cardUpdate.history.unknownTimeHint':'';
const iso=(v:CardVersion)=>v.publishedAt===null?undefined:new Date(v.publishedAt).toISOString();
async function load(){
 const g=++generation,id=props.cardId,target=props.target;
 busy.value=true;failed.value=false;moreFailed.value=false;moreBusy.value=false;items.value=[];batches.value=[];selected.value=null;page.value=1;hasMore.value=false;historyOpen.value=false;opened.value=new Set();
 try{
  const response=await fetchCardVersions(id,1,target);if(g!==generation)return;
  items.value=response.items;batches.value=[response.items.slice(1)];hasMore.value=response.hasMore;selected.value=response.target??null;
  if(target&&selected.value){historyOpen.value=selected.value.versionId!==latest.value?.versionId;opened.value.add(target);await nextTick();
   if(g===generation)[...root.value?.querySelectorAll<HTMLElement>('[data-version-id]')??[]].find(el=>el.dataset.versionId===target)?.scrollIntoView?.({block:'nearest'});
  }
 }catch{if(g===generation)failed.value=true;}finally{if(g===generation)busy.value=false;}
}
async function more(){
 if(busy.value||moreBusy.value||!hasMore.value)return;
 const g=generation,id=props.cardId,next=page.value+1;moreBusy.value=true;moreFailed.value=false;
 try{
  const response=await fetchCardVersions(id,next);if(g!==generation)return;
  const known=new Set(items.value.map(v=>v.versionId)),batch=response.items.filter(v=>!known.has(v.versionId));
  items.value.push(...batch);batches.value.push(batch);page.value=next;hasMore.value=response.hasMore;
 }catch{if(g===generation)moreFailed.value=true;}finally{if(g===generation)moreBusy.value=false;}
}
function toggle(id:string,event:Event){if((event.target as HTMLDetailsElement).open)opened.value.add(id);else opened.value.delete(id);}
watch(()=>[props.cardId,props.target,locale.value],()=>{void load();},{immediate:true});
onBeforeUnmount(()=>{generation++;});
</script>
<template>
 <section ref="root" class="version-history" aria-labelledby="version-history-title" :aria-busy="busy">
  <div class="version-history__head">
   <h2 id="version-history-title">{{t('cardUpdate.card.updateNote')}}</h2>
   <button v-if="groups.length||hasMore" type="button" class="link" data-history-toggle :aria-expanded="historyOpen" aria-controls="older-versions" @click="historyOpen=!historyOpen">{{t(historyOpen?'cardUpdate.history.hide':'cardUpdate.history.view')}}</button>
  </div>
  <div v-if="busy" class="ghost version-history__skeleton" :aria-label="t('cardUpdate.history.loading')" />
  <div v-else-if="failed" class="version-history__status" role="status"><p>{{t('cardUpdate.history.loadFailed')}}</p><button type="button" class="btn btn--sm" @click="load">{{t('cardUpdate.history.retry')}}</button></div>
  <div v-else-if="latest" data-current-version :data-version-id="latest.versionId" class="version-history__latest">
   <p class="subtle"><time :datetime="iso(latest)">{{dateLine(latest)}}</time></p>
   <p v-if="dateHint(latest)" class="subtle">{{t(dateHint(latest))}}</p>
   <p v-if="latest.updateKind==='major'" class="version-history__note">{{latest.updateNote}}</p>
  </div>
  <p v-else class="subtle">{{t('cardUpdate.history.empty')}}</p>
  <div v-if="historyOpen&&!busy&&!failed" id="older-versions" class="version-history__older">
   <template v-for="group in groups" :key="group.key">
    <details v-if="group.silent" class="version-history__entry" :open="opened.has(group.key)||group.items.some(v=>v.versionId===target)" @toggle="toggle(group.key,$event)">
     <summary>{{t('cardUpdate.history.silentGroup',{count:group.items.length},group.items.length)}}</summary>
     <div v-for="item in group.items" :key="item.versionId" :data-version-id="item.versionId" class="version-history__date">
      <p class="subtle"><time :datetime="iso(item)">{{dateLine(item)}}</time></p><p v-if="dateHint(item)" class="subtle">{{t(dateHint(item))}}</p>
     </div>
    </details>
    <details v-else class="version-history__entry" :data-version-id="group.items[0]!.versionId" :open="opened.has(group.items[0]!.versionId)" @toggle="toggle(group.items[0]!.versionId,$event)">
     <summary><time :datetime="iso(group.items[0]!)">{{dateLine(group.items[0]!)}}</time><span class="subtle">{{t('cardUpdate.notice.updateLog')}}</span></summary>
     <p v-if="dateHint(group.items[0]!)" class="subtle">{{t(dateHint(group.items[0]!))}}</p><p class="version-history__note">{{group.items[0]!.updateNote}}</p>
    </details>
   </template>
   <p v-if="moreFailed" role="status" class="subtle">{{t('cardUpdate.history.moreFailed')}}</p>
   <button v-if="hasMore" type="button" class="btn btn--sm version-history__more" data-history-more :disabled="moreBusy" @click="more">{{t(moreBusy?'cardUpdate.history.moreLoading':moreFailed?'cardUpdate.history.retryMore':'cardUpdate.history.more')}}</button>
  </div>
 </section>
</template>
<style scoped>
.version-history { min-width:0; display:grid; gap:var(--s-3); padding:var(--s-5) 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); scroll-margin-top:calc(var(--header-h) + var(--s-4)); }
.version-history__head { display:flex; align-items:baseline; justify-content:space-between; gap:var(--s-3); }
.version-history__head h2 { font-size:18px; font-weight:600; }
.version-history__head button { color:var(--accent-text); min-height:var(--h-lg); flex-shrink:0; font-size:13px; }
.version-history__latest,.version-history__date,.version-history__status { display:grid; gap:var(--s-2); }
.version-history__note { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.7; font-size:14px; }
.version-history__older { display:grid; gap:var(--s-3); }
.version-history__entry { border-top:1px solid var(--line); padding-top:var(--s-2); scroll-margin-top:calc(var(--header-h) + var(--s-4)); }
.version-history__entry summary { min-height:var(--h-lg); cursor:pointer; font-size:13px; line-height:1.7; overflow-wrap:anywhere; }
.version-history__entry summary span { margin-inline-start:var(--s-3); }
.version-history__entry > p,.version-history__date { margin:var(--s-2) 0; }
.version-history__more { justify-self:start; min-width:12em; }
.version-history__skeleton { height:72px; border-radius:var(--r-sm); }
@media(max-width:480px){.version-history__head{align-items:flex-start;}.version-history__head h2{padding-top:var(--s-3);}.version-history__head button{max-width:50%;text-align:end;overflow-wrap:anywhere;}}
</style>
