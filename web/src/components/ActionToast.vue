<script setup lang="ts">
import {onBeforeUnmount,onMounted,watch} from 'vue';
const props=defineProps<{message:string;actionLabel?:string;busy?:boolean}>();
const emit=defineEmits<{action:[];dismiss:[]}>();
let timer:ReturnType<typeof setTimeout>|undefined,remaining=6000,started=0,hover=false,focused=false;
function pause(){if(timer){clearTimeout(timer);timer=undefined;remaining=Math.max(0,remaining-(performance.now()-started));}}
function resume(){if(timer||hover||focused||props.busy)return;started=performance.now();timer=setTimeout(()=>{timer=undefined;emit('dismiss');},remaining);}
function pointer(value:boolean){hover=value;if(value)pause();else resume();}
function focus(e:FocusEvent){focused=!!e.relatedTarget&&(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node);if(!focused)resume();}
watch(()=>[props.message,props.actionLabel],()=>{pause();remaining=6000;resume();});
watch(()=>props.busy,busy=>{if(busy)pause();else resume();});
onMounted(resume);onBeforeUnmount(pause);
</script>
<template><div class="toast action-toast" role="status" @pointerenter="pointer(true)" @pointerleave="pointer(false)" @focusin="focused=true;pause()" @focusout="focus"><span>{{message}}</span><button v-if="actionLabel" class="btn btn--ghost" data-toast-action :disabled="busy" @click="emit('action')">{{actionLabel}}</button></div></template>
<style scoped>
.action-toast{display:flex;gap:var(--s-3);align-items:center;max-width:calc(100vw - var(--s-6));border-radius:var(--r-lg);white-space:normal;padding:var(--s-2) var(--s-4)}.action-toast span{overflow-wrap:anywhere}.action-toast .btn{flex:none;min-height:44px;color:inherit;text-decoration:underline}
</style>
