<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import DiscordCommunity from '@/components/DiscordCommunity.vue';
import CommunityIcon from '@/components/CommunityIcon.vue';
import AccountIcon from '@/components/AccountIcon.vue';
import { useLocalePath } from '@/lib/use-locale';
import { useSession } from '@/lib/session';
import { pageTitle } from '@/lib/i18n';
const { lp } = useLocalePath();
const { t } = useI18n();
const session = useSession();
onMounted(() => { document.title = pageTitle(t('community.title')); });
</script>
<template>
  <div v-if="session.me" class="page page--narrow community-page">
    <RouterLink :to="lp('/me')" class="community-page__back"><AccountIcon name="arrow" />{{ t('community.backToProfile') }}</RouterLink>
    <RouterLink :to="lp('/me/badges')" class="btn"><CommunityIcon name="award" />{{ t('badgeWall.title') }}</RouterLink>
    <DiscordCommunity :key="session.profile?.handle" />
  </div>
</template>
<style scoped>
.community-page {display:grid;gap:var(--s-4)}
.community-page__back {display:inline-flex;align-items:center;justify-self:start;gap:var(--s-2);min-height:var(--h-lg);color:var(--text-2)}
.community-page__back:hover {color:var(--accent-text)}
.community-page__back svg {width:1rem;height:1rem;transform:rotate(180deg)}
</style>
