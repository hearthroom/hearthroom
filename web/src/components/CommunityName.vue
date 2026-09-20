<script setup lang="ts">
import {computed} from 'vue';
import CommunityIcon from './CommunityIcon.vue';
import {usePublicAppearance,type EffectiveAppearance} from '@/lib/community-appearance';
const props=defineProps<{handle?:string;name:string;appearance?:EffectiveAppearance|null;supporter?:boolean}>();
const identity=usePublicAppearance(()=>props.appearance===undefined?props.handle:undefined);
const style=computed(()=>(props.appearance??identity.value?.appearance)?.nameStyle??'none');
const badge=computed(()=>props.supporter??identity.value?.badges.includes('server_booster'));
</script>
<template><span class="community-name"><span :class="'community-name--'+style">{{ name }}</span><span v-if="badge" class="community-name__supporter" :aria-label="$t('community.badges.server_booster')" :title="$t('community.badges.server_booster')" role="img"><CommunityIcon name="flame" /></span></span></template>
<style scoped>
.community-name{display:inline-flex;align-items:center;gap:var(--s-1);max-width:100%;min-width:0;vertical-align:baseline}
.community-name>span:first-child{min-width:0;overflow-wrap:anywhere}
.community-name--ember{color:var(--accent-text);background:linear-gradient(110deg,var(--accent-text),var(--text));background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.community-name--aurora{color:var(--accent-text);background:linear-gradient(110deg,var(--text),var(--accent-text),var(--text));background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.community-name--glow{color:var(--text);text-shadow:0 0 .4em var(--accent)}
.community-name__supporter{display:inline-flex;align-items:center;justify-content:center;flex:none;color:var(--accent-text)}
.community-name__supporter svg{width:1em;height:1em}
@media(forced-colors:active){.community-name--ember,.community-name--aurora{-webkit-text-fill-color:currentColor;background:none}.community-name--glow{text-shadow:none}}
</style>
