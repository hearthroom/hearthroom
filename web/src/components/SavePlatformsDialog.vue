<script setup lang="ts">
import { ref, onBeforeUnmount, nextTick } from 'vue';
import { PROVIDERS, type ProviderId } from '@/lib/provider';
const open=ref(false);
const selected=ref<ProviderId[]>([]);
const options=ref<ProviderId[]>([]);
const required=ref<ProviderId>();
const preview=ref<{name?:string;avatarUrl?:string}>({});
const box=ref<HTMLDialogElement>();
let resolve:((value:ProviderId[]|null)=>void)|undefined;
function finish(ok:boolean) {const value=ok?[...selected.value]:null;box.value?.close();open.value=false;resolve?.(value);resolve=undefined;}
async function choose(providers:ProviderId[], defaults:ProviderId[], source?:ProviderId, card:{name?:string;avatarUrl?:string}={}):Promise<ProviderId[]|null> {
 preview.value=card;options.value=providers;selected.value=defaults.filter(p=>providers.includes(p));required.value=source;
 if(source&&!selected.value.includes(source))selected.value.unshift(source);
 open.value=true;await nextTick();box.value?.showModal();
 return new Promise(r=>{resolve=r;});
}
onBeforeUnmount(()=>resolve?.(null));
defineExpose({choose});
</script>
<template>
 <dialog v-if="open" ref="box" class="platform-dialog panel" aria-labelledby="platform-dialog-title" @cancel.prevent="finish(false)">
  <p class="platform-dialog__eyebrow">{{ $t("workspace.destinations") }}</p>
  <h2 id="platform-dialog-title">{{ $t('editor.platforms.saveTitle') }}</h2>
  <p>{{ $t('editor.platforms.saveHint') }}</p>
  <div v-if="preview.name" class="platform-dialog__preview"><img v-if="preview.avatarUrl" :src="preview.avatarUrl" alt=""/><strong>{{ preview.name }}</strong></div>
  <div class="platform-dialog__options">
    <label v-for="p in options" :key="p" :class="{'platform-dialog__selected':selected.includes(p)}">
      <span class="platform-dialog__mark" :class="{'platform-dialog__mark--harbor':p==='harbor'}" aria-hidden="true">{{ p==='harbor'?'H':'L' }}</span>
      <span class="platform-dialog__identity"><strong>{{ PROVIDERS.find(x=>x.id===p)?.name }}</strong><small>{{ $t(p===required?'workspace.originalStorage':'workspace.connected') }}</small></span>
      <input v-model="selected" type="checkbox" :value="p" :disabled="p===required"/>
    </label>
  </div>
  <p class="platform-dialog__count">{{ $t('workspace.selected',{n:selected.length}) }}</p>
  <p v-if="required" class="subtle">{{ $t('editor.platforms.sourceHint') }}</p>
  <div class="platform-dialog__actions"><button type="button" class="btn" autofocus @click="finish(false)">{{ $t('editor.platforms.cancel') }}</button><button type="button" class="btn btn--primary" :disabled="!selected.length" @click="finish(true)">{{ $t('editor.platforms.saveAction') }}</button></div>
 </dialog>
</template>
<style scoped>
.platform-dialog{width:min(32rem,calc(100vw - 2rem));max-height:85vh;overflow:auto;padding:var(--s-5);color:var(--text);border:1px solid var(--line)}
.platform-dialog::backdrop{background:#0009}.platform-dialog label{display:flex;gap:var(--s-2);align-items:center;padding:var(--s-3) 0}.platform-dialog__actions{display:flex;gap:var(--s-2);justify-content:flex-end;flex-wrap:wrap;margin-top:var(--s-4)}
.platform-dialog{border-radius:var(--r-lg);padding:var(--s-6);box-shadow:var(--shadow-lg)}
.platform-dialog h2{font-size:24px;margin:var(--s-2) 0}.platform-dialog p{font-size:14px;line-height:1.7;color:var(--text-2)}
.platform-dialog .platform-dialog__eyebrow{font-size:12px;color:var(--text-3)}
.platform-dialog__preview{display:flex;align-items:center;gap:var(--s-3);margin:var(--s-4) 0;overflow-wrap:anywhere}.platform-dialog__preview img{width:48px;height:48px;object-fit:cover;border-radius:var(--r-sm)}
.platform-dialog__options{display:grid;gap:var(--s-3);margin-top:var(--s-5)}
.platform-dialog__options label{padding:var(--s-4);border:1px solid var(--line);border-radius:var(--r-md);gap:var(--s-3);cursor:pointer}
.platform-dialog__options .platform-dialog__selected{border-color:var(--accent);background:var(--accent-tint)}
.platform-dialog__identity{flex:1;min-width:0;display:grid;gap:4px;overflow-wrap:anywhere}.platform-dialog__identity small{color:var(--text-2);font-size:12px}
.platform-dialog__mark{display:grid;place-items:center;flex:none;width:40px;height:40px;border-radius:12px;background:var(--surface-2);font-size:20px}
@font-face{font-family:'HarperHarbor Mark';font-style:italic;font-weight:500;font-display:swap;src:url('../assets/harperharbor-h.ttf') format('truetype')}
.platform-dialog__mark--harbor{background:#F2B84B;color:#1A1204;font-family:'HarperHarbor Mark',Georgia,serif;font-style:italic;font-size:26px}
.platform-dialog__count{margin-top:var(--s-3)}.platform-dialog input{width:18px;height:18px;accent-color:var(--accent)}
.platform-dialog__actions{padding-top:var(--s-4);border-top:1px solid var(--line)}
.platform-dialog__actions .btn{min-height:44px;height:auto;white-space:normal}
@media(max-width:520px){.platform-dialog{padding:var(--s-4)}.platform-dialog__actions .btn{flex:1}}
</style>
