<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {usePublicAppearance,type EffectiveAppearance} from '@/lib/community-appearance';
const props=defineProps<{handle?:string;src?:string|null;name?:string;appearance?:EffectiveAppearance|null}>();
const identity=usePublicAppearance(()=>props.appearance===undefined?props.handle:undefined);
const visual=computed(()=>props.appearance??identity.value?.appearance);
const failed=ref<string[]>([]),decorationFailed=ref('');
const source=computed(()=>visual.value?.avatarUrl&&!failed.value.includes(visual.value.avatarUrl)?visual.value.avatarUrl:props.src&&!failed.value.includes(props.src)?props.src:'');
watch(()=>[props.src,visual.value?.avatarUrl],()=>{failed.value=[];});
</script>
<template>
 <span class="community-avatar" :class="{'community-avatar--hearth':visual?.frame==='hearth'||(visual?.frame==='discord'&&(!visual.decorationUrl||decorationFailed===visual.decorationUrl))}">
  <img v-if="source" :src="source" alt="" class="community-avatar__image" @error="failed.push(source)" />
  <span v-else class="community-avatar__initial" aria-hidden="true">{{ [...(name||'?')][0] }}</span>
  <img v-if="visual?.frame==='discord'&&visual.decorationUrl&&decorationFailed!==visual.decorationUrl" :src="visual.decorationUrl" alt="" class="community-avatar__decoration" aria-hidden="true" @error="decorationFailed=visual.decorationUrl" />
 </span>
</template>
<style scoped>
.community-avatar{display:inline-flex;align-items:center;justify-content:center;position:relative;isolation:isolate;width:2rem;height:2rem;flex:none;border-radius:var(--r-pill);background:var(--surface-2);vertical-align:middle;overflow:visible}
.community-avatar__image,.community-avatar__initial{display:block;width:100%;height:100%;border-radius:inherit;object-fit:cover}
.community-avatar__initial{display:flex;align-items:center;justify-content:center;color:var(--text-2);font-weight:600}
.community-avatar--hearth{outline:2px solid var(--accent-text);outline-offset:2px;box-shadow:0 0 0 5px var(--accent-tint)}
.community-avatar__decoration{position:absolute;width:120%;height:120%;max-width:none;inset:-10%;object-fit:contain;pointer-events:none;z-index:1}
@media(prefers-reduced-motion:reduce){.community-avatar__decoration{display:none}.community-avatar:has(.community-avatar__decoration){outline:2px solid var(--accent-text);outline-offset:2px}}
</style>
