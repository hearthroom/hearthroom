<script setup lang="ts">
import {onBeforeUnmount, ref} from 'vue';
import {useI18n} from 'vue-i18n';
import {useSession} from '@/lib/session';
import {updateSiteProfile} from '@/lib/api';
const session=useSession();
const {t}=useI18n();
const editing=ref(false),busy=ref(false),error=ref(''),saved=ref(false);
const name=ref(''),bio=ref(''),file=ref<File|null>(null),preview=ref(''),removeAvatar=ref(false);
let objectUrl='';
function clearPreview(){if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl='';file.value=null;}
function begin(){clearPreview();name.value=session.displayName;bio.value=session.profile?.bio??'';preview.value=session.avatarUrl;removeAvatar.value=false;editing.value=true;saved.value=false;error.value='';}
function selectAvatar(event:Event){
 const input=event.target as HTMLInputElement;const selected=input.files?.[0];if(!selected)return;
 error.value='';
 if(!['image/jpeg','image/png','image/webp'].includes(selected.type)||selected.size>2*1024*1024){error.value=t('community.avatarInvalid');input.value='';return;}
 clearPreview();file.value=selected;objectUrl=URL.createObjectURL(selected);preview.value=objectUrl;removeAvatar.value=false;
}
function remove(){clearPreview();preview.value='';removeAvatar.value=true;}
function cancel(){clearPreview();editing.value=false;error.value='';}
async function save(){
 if(busy.value)return;busy.value=true;error.value='';
 try {
  const token=await session.accessToken();if(!token)throw new Error('expired');
  session.profile=await updateSiteProfile(token,{displayName:name.value,bio:bio.value,avatar:file.value,removeAvatar:removeAvatar.value});
  clearPreview();editing.value=false;saved.value=true;
 }catch {error.value=t('community.failed');}finally{busy.value=false;}
}
onBeforeUnmount(clearPreview);
</script>
<template>
 <div class="community-profile" :class="{'community-profile--editing':editing}">
  <template v-if="!editing"><button class="btn" @click="begin">{{ $t('community.edit') }}</button><p v-if="saved" role="status">{{ $t('community.saved') }}</p></template>
  <form v-else @submit.prevent="save" :aria-busy="busy">
   <h2>{{ $t('community.edit') }}</h2>
   <div class="profile-avatar">
    <img v-if="preview" :src="preview" :alt="$t('community.avatarPreview')" />
    <div class="profile-avatar__controls">
     <label class="avatar-picker">{{ $t('community.chooseAvatar') }}<input type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="selectAvatar" aria-describedby="avatar-hint" /></label>
     <button v-if="preview" type="button" class="btn btn--ghost" :disabled="busy" @click="remove">{{ $t('community.removeAvatar') }}</button>
    </div>
   </div>
   <p id="avatar-hint" class="subtle">{{ $t('community.avatarHint') }}</p>
   <label>{{ $t('community.name') }}<input v-model="name" required maxlength="60" autocomplete="nickname" :disabled="busy" /></label>
   <label>{{ $t('community.bio') }}<textarea v-model="bio" maxlength="500" rows="4" :disabled="busy" :placeholder="$t('community.bioHint')" /></label>
   <p class="subtle">{{ $t('community.publicHint') }}</p>
   <p v-if="error" role="alert" class="notice notice--error">{{ error }}</p>
   <div class="actions"><button class="btn btn--primary" :disabled="busy||!name.trim()">{{ busy?$t('community.saving'):$t('community.save') }}</button><button type="button" class="btn btn--ghost" :disabled="busy" @click="cancel">{{ $t('linked.cancel') }}</button></div>
  </form>
 </div>
</template>
<style scoped>
.community-profile {min-width:0;display:flex;align-items:center;gap:var(--s-3);flex-wrap:wrap}
.community-profile--editing {width:100%}
form {width:100%}
form,label {display:grid;gap:var(--s-2)}
form {gap:var(--s-4);border-top:1px solid var(--line);padding-top:var(--s-5)}
h2,p {margin:0}
h2 {font-size:1.125rem}
input,textarea {width:100%;min-width:0;padding:var(--s-3);border:1px solid var(--line-strong);border-radius:var(--r-sm);background:var(--surface-2);color:var(--text);font:inherit}
textarea {resize:vertical}
input[type=file] {max-width:100%;font-size:.875rem}
.profile-avatar {display:flex;align-items:center;gap:var(--s-4);flex-wrap:wrap}
.profile-avatar img {width:calc(var(--s-6)*3);height:calc(var(--s-6)*3);object-fit:cover;border-radius:var(--r-pill)}
.profile-avatar__controls {display:grid;gap:var(--s-2);min-width:0;flex:1}
.actions {display:flex;gap:var(--s-2);flex-wrap:wrap}
.btn {min-height:var(--h-lg);height:auto;white-space:normal}
</style>
