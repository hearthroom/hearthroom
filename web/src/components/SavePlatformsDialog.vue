<script setup lang="ts">
import { ref, onBeforeUnmount, nextTick } from 'vue';
import { PROVIDERS, type ProviderId } from '@/lib/provider';
const open=ref(false);
const selected=ref<ProviderId[]>([]);
const options=ref<ProviderId[]>([]);
const required=ref<ProviderId>();
const publishing=ref(false);
const box=ref<HTMLDialogElement>();
let resolve:((value:ProviderId[]|null)=>void)|undefined;
function finish(ok:boolean) {const value=ok?[...selected.value]:null;box.value?.close();open.value=false;resolve?.(value);resolve=undefined;}
async function choose(providers:ProviderId[], defaults:ProviderId[], source?:ProviderId, publish=false):Promise<ProviderId[]|null> {
 options.value=providers;selected.value=defaults.filter(p=>providers.includes(p));required.value=source;publishing.value=publish;
 if(source&&!selected.value.includes(source))selected.value.unshift(source);
 open.value=true;await nextTick();box.value?.showModal();
 return new Promise(r=>{resolve=r;});
}
onBeforeUnmount(()=>resolve?.(null));
defineExpose({choose});
</script>
<template>
 <dialog v-if="open" ref="box" class="platform-dialog panel" aria-labelledby="platform-dialog-title" @cancel.prevent="finish(false)">
  <h2 id="platform-dialog-title">{{ $t(publishing?'editor.platforms.publishTitle':'editor.platforms.saveTitle') }}</h2>
  <p>{{ $t(publishing?'editor.platforms.publishHint':'editor.platforms.saveHint') }}</p>
  <label v-for="p in options" :key="p"><input v-model="selected" type="checkbox" :value="p" :disabled="p===required"/> {{ PROVIDERS.find(x=>x.id===p)?.name }} <span v-if="p===required" class="subtle">{{ $t('linked.source') }}</span></label>
  <p v-if="required" class="subtle">{{ $t('editor.platforms.sourceHint') }}</p>
  <div class="platform-dialog__actions"><button type="button" class="btn" autofocus @click="finish(false)">{{ $t('editor.platforms.cancel') }}</button><button type="button" class="btn btn--primary" :disabled="!selected.length" @click="finish(true)">{{ $t(publishing?'editor.platforms.publishAction':'editor.platforms.saveAction') }}</button></div>
 </dialog>
</template>
<style scoped>
.platform-dialog{width:min(32rem,calc(100vw - 2rem));max-height:85vh;overflow:auto;padding:var(--s-5);color:var(--text);border:1px solid var(--line)}
.platform-dialog::backdrop{background:#0009}.platform-dialog label{display:flex;gap:var(--s-2);align-items:center;padding:var(--s-3) 0}.platform-dialog__actions{display:flex;gap:var(--s-2);justify-content:flex-end;flex-wrap:wrap;margin-top:var(--s-4)}
</style>
