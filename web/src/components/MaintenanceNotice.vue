<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatMaintenanceTime, type MaintenanceMonitor } from '../lib/maintenance';
const props=defineProps<{monitor:MaintenanceMonitor}>();
const {t,locale}=useI18n();
const dialog=ref<HTMLDialogElement|null>(null),manual=ref(false),now=ref(Date.now());
const state=props.monitor.state,busy=props.monitor.busy,failed=props.monitor.failed;
const time=computed(()=>formatMaintenanceTime(state.value.endsAt,locale.value,now.value));
const message=computed(()=>state.value.messages[locale.value as keyof typeof state.value.messages]??'');
let clock:ReturnType<typeof setInterval>;
watch(()=>state.value.enabled,async enabled=>{
 await nextTick();
 if(enabled&&!dialog.value?.open)dialog.value?.showModal();
 else if(!enabled&&dialog.value?.open)dialog.value.close();
},{immediate:true});
onMounted(()=>{clock=setInterval(()=>{now.value=Date.now();},1000);if(state.value.enabled&&!dialog.value?.open)dialog.value?.showModal();});
onBeforeUnmount(()=>{clearInterval(clock);dialog.value?.close();});
async function check(){manual.value=true;await props.monitor.check();}
</script>
<template>
 <dialog ref="dialog" class="maintenance" aria-labelledby="maintenance-title" aria-describedby="maintenance-body" @cancel.prevent>
  <main class="panel maintenance__panel">
   <img class="maintenance__art" src="/mascot/suki-fail.webp" alt="" width="168" height="168" />
   <h1 id="maintenance-title" class="display">{{ t('maintenance.title') }}</h1>
   <p id="maintenance-body" class="muted">{{ t('maintenance.body') }}</p>
   <p class="maintenance__eta">{{ time ? t('maintenance.eta',{time}) : t('maintenance.etaPending') }}</p>
   <p v-if="message" class="muted">{{ message }}</p>
   <p class="subtle">{{ t('maintenance.autoResume') }}</p>
   <button class="btn btn--primary btn--lg" type="button" :disabled="busy" :aria-busy="busy" @click="check">{{ t(busy?'maintenance.checking':'maintenance.check') }}</button>
   <p class="maintenance__result muted" role="status" aria-live="polite">{{ failed ? t('maintenance.checkFailed') : manual && !busy ? t('maintenance.stillActive') : '' }}</p>
  </main>
 </dialog>
</template>
<style scoped>
.maintenance { position: fixed; inset: 0; width: 100%; height: 100vh; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: max(var(--s-5),env(safe-area-inset-top)) max(var(--s-4),env(safe-area-inset-right)) max(var(--s-5),env(safe-area-inset-bottom)) max(var(--s-4),env(safe-area-inset-left)); border: 0; color: var(--text); background: var(--bg); overflow: auto; }
.maintenance[open] { display: flex; align-items: center; justify-content: center; }
.maintenance::backdrop { background: var(--bg); }
.maintenance__panel { width: 100%; max-width: 480px; margin: auto; padding: var(--s-6) var(--s-5); text-align: center; overflow-wrap: anywhere; }
.maintenance__art { display: block; margin: 0 auto var(--s-4); max-width: 40vw; height: auto; }
h1 { font-size: clamp(22px, 5vw, 28px); margin: 0 0 var(--s-3); }
p { margin: 0 0 var(--s-4); }
.maintenance__eta { font-weight: 600; }
.maintenance__result { min-height: 3em; margin: var(--s-4) 0 0; font-size: 13px; }
:lang(ko) .maintenance__panel { word-break: keep-all; }
</style>
