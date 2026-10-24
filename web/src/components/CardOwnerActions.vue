<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError, fetchDraftState, type DraftState, fetchRatingDraft, registerCard, saveRatingDraft } from '@/lib/api';
import { accountToken } from '@/lib/connections';
import { confirmDialog } from '@/lib/confirm';
import { askRating } from '@/lib/rating';
import { currentProvider, type ProviderId } from '@/lib/provider';
import { platformPath } from '@/lib/distribution';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import {useWorkVisibilityCapability} from '@/lib/work-visibility-capability';
import {legacyAuthorStateKey} from '@/lib/legacy-author-state';
import AuthorVisibility from './AuthorVisibility.vue';
import type { WorkVisibility } from '@/lib/work-visibility';
import type { CommunityCard } from '@/lib/types';
const props = defineProps<{card: CommunityCard}>();
const emit = defineEmits<{submitted: []}>();
const session = useSession();
const { t } = useI18n();
const { lp } = useLocalePath();
const provider = computed(() => props.card.provider as ProviderId);
const sourceId = computed(() => props.card.sourceRoleId ?? props.card.roleId);
const owner = computed(() => !!provider.value && (
  session.profile?.identities.some(i => i.provider === provider.value && i.externalId === props.card.author.accountNumId)
  || (currentProvider() === provider.value && session.me?.accountNumId === props.card.author.accountNumId)
));
const busy = ref(false);
const error = ref('');
const visibility=ref<WorkVisibility|null>(null);
const visibilityEnabled=useWorkVisibilityCapability();
const visibilityControl=ref<InstanceType<typeof AuthorVisibility>|null>(null);
const ownerToken=()=>accountToken(provider.value,props.card.author.accountNumId);
const legacyDraft=ref<DraftState|null>(null);
let statusGeneration=0;
watch([owner,visibilityEnabled,sourceId],async([isOwner,enabled])=>{
 const g=++statusGeneration;legacyDraft.value=null;if(!isOwner||enabled)return;
 try{const token=await ownerToken();if(!token)return;const state=await fetchDraftState(sourceId.value,token,provider.value);if(g===statusGeneration)legacyDraft.value=state;}catch{/* Legacy status is read-only and cannot authorize actions. */}
},{immediate:true});
const legacyState=computed(()=>legacyAuthorStateKey(legacyDraft.value,props.card.status));
// 已發布的卡：草稿改了、新版不在審時，可以直接送審更新（跟「我的卡片」的編輯器同一個送審）
const canSubmitUpdate = computed(() => !!visibility.value?.actions.includes('submit_update'));
async function submit(expected=visibility.value) {
  if (busy.value || !owner.value || !expected || !expected.actions.some(a=>a==='submit_review'||a==='submit_update')) return;
  // 每次送審都附分級問卷：先帶出作者存過的評測讓他確認，沒有就從頭填
  let token: string | null = null;
  try { token = await accountToken(provider.value, props.card.author.accountNumId); } catch { token = null; }
  if (!token) { error.value = t('auth.expired'); return; }
  const saved = await fetchRatingDraft(sourceId.value, token, provider.value).catch(() => null);
  const answers = await askRating(saved);
  if (!answers) return;
  const ok = await confirmDialog({
    title: t('mine.consent.title'),
    message: t(provider.value === 'harbor' ? 'workspace.reviewConsent' : 'mine.consent.message'),
    confirmText: t('mine.consent.confirm'),
  });
  if (!ok) return;
  busy.value = true; error.value = '';
  try {
    void saveRatingDraft(sourceId.value, answers, token, provider.value).catch(() => {});
    await registerCard(sourceId.value, token, answers, [], provider.value, undefined, undefined, expected);
    await visibilityControl.value?.reload();
    emit('submitted');
  } catch (err) {
    error.value = err instanceof ApiError && err.code === 'weekly_quota_exceeded'
      ? t('mine.quota.exceeded') : err instanceof Error ? err.message : t('state.actionFailed');
  } finally { busy.value = false; }
}
</script>
<template>
  <div v-if="owner" class="card-owner-actions">
    <p v-if="!visibilityEnabled&&legacyState" class="notice" role="status">{{ t(legacyState) }}</p>
    <AuthorVisibility v-if="visibilityEnabled" ref="visibilityControl" :id="sourceId" :card-id="String(card.num??card.id)" :provider="provider" :actor="String(card.author.accountNumId)" :name="card.name" :token="ownerToken" :disabled="busy" @changed="visibility=$event" @submit="submit" />
    <RouterLink class="btn" :to="platformPath(lp(`/cards/${card.num ?? card.id}/edit`), provider)">{{ t('mine.action.edit') }}</RouterLink>
    <!-- 作者試玩自己的草稿（mode=source）；公開的「遊玩」仍開過審那一版，作者也看得到玩家看到的樣子 -->
    <a class="btn" :href="platformPath(lp(`/play/${card.num ?? card.id}?mode=source`), provider)">{{ t('card.owner.playDraft') }}</a>
    <button v-if="visibilityEnabled&&canSubmitUpdate" class="btn btn--primary" :disabled="busy" @click="submit()">{{ t('card.owner.submitUpdate') }}</button>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.card-owner-actions { display:flex; flex-wrap:wrap; gap:var(--s-2); grid-column:1 / -1; }
.card-owner-actions .btn { min-height:44px; flex:1; }
.card-owner-actions p, .card-owner-actions :deep(.author-visibility) { flex-basis:100%; }
</style>
