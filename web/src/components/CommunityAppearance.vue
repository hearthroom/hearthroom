<script setup lang="ts">
import {computed,reactive,ref} from 'vue';
import {useSession} from '@/lib/session';
import type {AppearanceView,AppearancePreferences,EffectiveAppearance} from '@/lib/community-appearance';
import CommunityAvatar from './CommunityAvatar.vue';
import CommunityName from './CommunityName.vue';
import CommunityIcon from './CommunityIcon.vue';
const props=defineProps<{appearance:AppearanceView;linked:boolean;busy?:boolean;error?:string}>();
const emit=defineEmits<{save:[value:AppearancePreferences]}>();
const session=useSession(),editing=ref(false),draft=reactive({...props.appearance.preferences});
function begin(){Object.assign(draft,props.appearance.preferences);editing.value=true;}
const preview=computed<EffectiveAppearance>(()=>{
 const a=props.appearance.available,active=props.appearance.supporter.active;
 const decoration=draft.avatarSource==='guild'?(a.guildDecoration??a.discordDecoration):a.discordDecoration;
 return {avatarUrl:draft.avatarSource==='site'?null:draft.avatarSource==='guild'?(a.guildAvatar??a.discordAvatar??null):(a.discordAvatar??null),nameStyle:active?draft.nameStyle:'none',frame:active?(draft.frame==='discord'&&!decoration?'hearth':draft.frame):'none',decorationUrl:active&&draft.frame==='discord'?(decoration??null):null};
});
const changed=computed(()=>JSON.stringify(draft)!==JSON.stringify(props.appearance.preferences));
function save(){emit('save',{...draft});}
</script>
<template>
 <section class="appearance" aria-labelledby="appearance-heading">
  <div class="appearance-heading"><div><h3 id="appearance-heading"><CommunityIcon name="flame" />{{ $t('communityAppearance.title') }}</h3><p class="muted">{{ $t(appearance.supporter.active?'communityAppearance.active':'communityAppearance.hint') }}</p></div><button v-if="!editing" type="button" class="btn" data-action="edit-appearance" @click="begin">{{ $t('communityAppearance.edit') }}</button></div>
  <p v-if="appearance.supporter.stale" role="status" class="notice">{{ $t('communityAppearance.stale') }}</p>
  <form v-if="editing" @submit.prevent="save" :aria-busy="busy">
   <div class="appearance-preview" :aria-label="$t('communityAppearance.preview')"><CommunityAvatar :src="session.avatarUrl" :name="session.displayName" :appearance="preview" /><div><CommunityName :name="session.displayName" :appearance="preview" :supporter="appearance.supporter.active" /><p class="muted">{{ $t('communityAppearance.preview') }}</p></div></div>
   <div class="appearance-fields">
    <label>{{ $t('communityAppearance.avatar') }}<select v-model="draft.avatarSource" name="avatarSource" :disabled="busy"><option value="site">{{ $t('communityAppearance.avatarSite') }}</option><option value="discord" :disabled="!linked">{{ $t('communityAppearance.avatarDiscord') }}</option><option value="guild" :disabled="!linked">{{ $t('communityAppearance.avatarGuild') }}</option></select></label>
    <label>{{ $t('communityAppearance.name') }}<select v-model="draft.nameStyle" name="nameStyle" :disabled="busy||!appearance.supporter.active"><option v-for="style in ['none','ember','aurora','glow']" :key="style" :value="style">{{ $t('communityAppearance.styles.'+style) }}</option></select></label>
    <label>{{ $t('communityAppearance.frame') }}<select v-model="draft.frame" name="frame" :disabled="busy||!appearance.supporter.active"><option v-for="frame in ['none','hearth','discord']" :key="frame" :value="frame">{{ $t('communityAppearance.frames.'+frame) }}</option></select></label>
   </div>
   <p class="muted appearance-help">{{ $t('communityAppearance.syncHint') }}</p>
   <label class="appearance-toggle"><input v-model="draft.publicAppearance" type="checkbox" :disabled="busy" />{{ $t('communityAppearance.public') }}</label>
   <p v-if="error" role="alert" class="notice notice--error">{{ error }}</p>
   <p v-if="!changed&&!busy" role="status" class="muted">{{ $t('communityAppearance.current') }}</p>
   <div class="appearance-actions"><button class="btn btn--primary" :disabled="busy||!changed">{{ $t(busy?'community.saving':'community.save') }}</button><button type="button" class="btn btn--ghost" data-action="cancel-appearance" :disabled="busy" @click="editing=false">{{ $t('linked.cancel') }}</button><button type="button" class="btn btn--ghost" :disabled="busy" @click="Object.assign(draft,{avatarSource:'site',nameStyle:'none',frame:'none',publicAppearance:false})">{{ $t('communityAppearance.reset') }}</button></div>
  </form>
 </section>
</template>
<style scoped>
.appearance{border-top:1px solid var(--line);padding-top:var(--s-5);margin-top:var(--s-5)}
.appearance-heading{display:flex;align-items:center;justify-content:space-between;gap:var(--s-4);flex-wrap:wrap}
.appearance h3{display:flex;align-items:center;gap:var(--s-2);margin:0;font-size:1.125rem}.appearance p{margin:var(--s-2) 0;line-height:1.6}.appearance form{display:grid;gap:var(--s-4);margin-top:var(--s-4)}
.appearance-preview{display:flex;align-items:center;gap:var(--s-5);padding:var(--s-5);border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface-2);min-width:0}.appearance-preview>.community-avatar{width:4rem;height:4rem}.appearance-preview>div{min-width:0}.appearance-preview .community-name{font-size:1.25rem;font-weight:600}
.appearance-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));gap:var(--s-4)}.appearance-fields label{display:grid;gap:var(--s-2);min-width:0;color:var(--text-2)}.appearance select{min-height:44px;max-width:100%;width:100%;padding:var(--s-2) var(--s-3);border:1px solid var(--line-strong);border-radius:var(--r-sm);color:var(--text);background:var(--surface)}.appearance select:disabled{opacity:.65}.appearance-help{font-size:.875rem}.appearance-toggle{display:flex;align-items:center;gap:var(--s-2);min-height:44px}.appearance-toggle input{flex:none;width:1.125rem;height:1.125rem;accent-color:var(--accent)}.appearance-actions{display:flex;flex-wrap:wrap;gap:var(--s-2)}.appearance .btn{min-height:44px}
</style>
