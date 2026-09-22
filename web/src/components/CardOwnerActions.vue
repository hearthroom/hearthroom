<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError, registerCard } from '@/lib/api';
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
    emit('submitted');
  } catch (err) {
    error.value = err instanceof ApiError && err.code === 'weekly_quota_exceeded'
      ? t('mine.quota.exceeded') : err instanceof Error ? err.message : t('state.actionFailed');
  } finally { busy.value = false; }
}
</script>
<template>
  <div v-if="owner" class="card-owner-actions">
    <RouterLink class="btn" :to="platformPath(lp(`/cards/${sourceId}/edit`), provider)">{{ t('mine.action.edit') }}</RouterLink>
    <button v-if="card.status && !['approved','pending'].includes(card.status)" class="btn" :disabled="busy" @click="submit">{{ t('mine.action.submit') }}</button>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.card-owner-actions { display:flex; flex-wrap:wrap; gap:var(--s-2); grid-column:1 / -1; }
.card-owner-actions .btn { min-height:44px; flex:1; }
.card-owner-actions p { flex-basis:100%; }
</style>
