<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError, fetchDraftState, registerCard, type DraftState } from '@/lib/api';
import { accountToken } from '@/lib/connections';
import { confirmChoice } from '@/lib/confirm';
import { currentProvider, type ProviderId } from '@/lib/provider';
import { platformPath } from '@/lib/distribution';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
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
// 草稿狀態（owner 2026-10-08：改了卡、卡片頁沒說，按遊玩玩到的還是過審那一版）。讀不到就不顯示，不擋其他操作。
const draft = ref<DraftState | null>(null);
watch(owner, async (isOwner) => {
  if (!isOwner || draft.value) return;
  try {
    const token = await accountToken(provider.value, props.card.author.accountNumId);
    if (token) draft.value = await fetchDraftState(sourceId.value, token, provider.value);
  } catch { /* 狀態只是提示 */ }
}, { immediate: true });
const approved = computed(() => props.card.status === 'approved');
// 已發布的卡：草稿改了、新版不在審時，可以直接送審更新（跟「我的卡片」的編輯器同一個送審）
const canSubmitUpdate = computed(() => approved.value && !!draft.value?.draftChanged && draft.value.updateStatus !== 'pending');
async function submit() {
  if (busy.value || !owner.value) return;
  const rating = await confirmChoice({
    title: t('mine.consent.title'),
    message: t(provider.value === 'harbor' ? 'workspace.reviewConsent' : 'mine.consent.message'),
    confirmText: t('mine.consent.confirm'), choiceLabel: t('mine.rating.label'),
    choices: [
      {value:'sfw',label:t('mine.rating.sfw'),hint:t('mine.rating.sfwHint')},
      {value:'nsfw',label:t('mine.rating.nsfw'),hint:t('mine.rating.nsfwHint')},
    ],
  });
  if (!rating) return;
  busy.value = true; error.value = '';
  try {
    const token = await accountToken(provider.value, props.card.author.accountNumId);
    if (!token) throw new Error(t('auth.expired'));
    await registerCard(sourceId.value, token, rating === 'nsfw', [], provider.value);
    if (draft.value) draft.value = { ...draft.value, draftChanged: false, updateStatus: 'pending' };
    emit('submitted');
  } catch (err) {
    error.value = err instanceof ApiError && err.code === 'weekly_quota_exceeded'
      ? t('mine.quota.exceeded') : err instanceof Error ? err.message : t('state.actionFailed');
  } finally { busy.value = false; }
}
</script>
<template>
  <div v-if="owner" class="card-owner-actions">
    <RouterLink class="btn" :to="platformPath(lp(`/cards/${card.num ?? card.id}/edit`), provider)">{{ t('mine.action.edit') }}</RouterLink>
    <!-- 作者試玩自己的草稿（mode=source）；公開的「遊玩」仍開過審那一版，作者也看得到玩家看到的樣子 -->
    <a class="btn" :href="platformPath(lp(`/play/${card.num ?? card.id}?mode=source`), provider)">{{ t('card.owner.playDraft') }}</a>
    <button v-if="card.status && !['approved','pending'].includes(card.status)" class="btn" :disabled="busy" @click="submit">{{ t('mine.action.submit') }}</button>
    <button v-if="canSubmitUpdate" class="btn btn--primary" :disabled="busy" @click="submit">{{ t('card.owner.submitUpdate') }}</button>
    <p v-if="draft?.draftChanged" class="notice">{{ t('workspace.draftChanged') }}</p>
    <p v-else-if="approved && draft?.updateStatus === 'pending'" class="notice">{{ t('workspace.updatePending') }}</p>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.card-owner-actions { display:flex; flex-wrap:wrap; gap:var(--s-2); grid-column:1 / -1; }
.card-owner-actions .btn { min-height:44px; flex:1; }
.card-owner-actions p { flex-basis:100%; }
</style>
