<script setup lang="ts">
/**
 * 「我的」＝我的主頁：別人看得到的名片，加上只有自己看得到的分區與工具（owner 2026-10-19 改版）。
 *
 *   資料頭（封面、頭像、名字、徽章、簡介；右邊積分卡）→ 活動與我的資源 → 分區（作品／收藏／最近對話／關注／徽章）＋右欄入口
 *
 * 原本這頁的每個入口都還在：通知、積分與會員、邀請獎勵、活動中心、社區管理、用戶設定、退出、Discord 社區、
 * 徽章收藏、查看公開頁、複製成員 ID、編輯資料。卡片與遊玩服務的授權搬到設定頁「登入與授權」。
 *
 * Discord 社區的狀態只在進頁時讀一次，不再每 15 秒輪詢（那是 /me/community 管理頁的事）——
 * 輪詢回來就換掉整份資料，資料頭跟著重畫，是這頁一直「閃」的來源之一。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import ProfileHero from '@/components/profile/ProfileHero.vue';
import ProfileWallet from '@/components/profile/ProfileWallet.vue';
import ProfileCreatorBand from '@/components/profile/ProfileCreatorBand.vue';
import ProfileTabs from '@/components/profile/ProfileTabs.vue';
import ProfileRail from '@/components/profile/ProfileRail.vue';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { pageTitle } from '@/lib/i18n';
import { communityRequest, type CommunityView } from '@/lib/community';
import { fetchAuthor } from '@/lib/api';
import type { Author } from '@/lib/types';
import type { BadgeCollection } from '../../../shared/community-badges';

const session = useSession();
const route = useRoute(), router = useRouter();
const { t } = useI18n();
const { lp } = useLocalePath();

const handle = computed(() => session.profile?.handle ?? '');
const community = ref<CommunityView | null>(null);
const badges = ref<BadgeCollection | null>(null);
const author = ref<Author | null>(null);
const hero = ref<InstanceType<typeof ProfileHero> | null>(null);
const tabs = ref<InstanceType<typeof ProfileTabs> | null>(null);

// 舊的回報卡片連結（/me?reportCard=）一律帶到 Discord 社區頁的回報表單
watch(() => route.query.reportCard, (value) => {
  if (typeof value === 'string' && value) void router.replace({ path: lp('/me/community'), query: route.query });
}, { immediate: true });

async function loadCommunity() {
  try {
    const token = await session.accessToken();
    if (!token) return;
    const [view, collection] = await Promise.all([
      communityRequest<CommunityView>('/me/community', token).catch(() => null),
      communityRequest<BadgeCollection>('/me/community/badges', token).catch(() => null),
    ]);
    community.value = view; badges.value = collection;
  } catch { /* 社區服務暫時讀不到：資料頭照樣顯示，只是沒有等級與徽章 */ }
}
async function loadAuthor(h: string) {
  if (!h) return;
  try { author.value = await fetchAuthor(h); } catch { author.value = null; }
}
watch(handle, (h) => { community.value = null; badges.value = null; author.value = null; if (h) { void loadCommunity(); void loadAuthor(h); } }, { immediate: true });

const startEditing = computed(() => route.query.edit === '1');
function saved() {
  if (route.query.edit) void router.replace({ query: { ...route.query, edit: undefined } });
  void loadAuthor(handle.value);
}
onMounted(() => { document.title = pageTitle(t('me.title')); });
</script>

<template>
  <div v-if="session.me" class="page me">
    <ProfileHero ref="hero" :community="community" :badges="badges" :author="author" :start-editing="startEditing" @saved="saved" @tab="(k) => tabs?.go({ tab: k as 'works' | 'following' })">
      <template #aside><ProfileWallet /></template>
    </ProfileHero>
    <ProfileCreatorBand />
    <div class="me__grid">
      <ProfileTabs ref="tabs" class="me__main" :badges="badges" :counts="{ works: author?.cardCount ?? null, following: session.profile?.following ?? null }" />
      <ProfileRail class="me__rail" :community="community" :author="author" @edit="hero?.begin()" />
    </div>
  </div>
</template>

<style scoped>
.me { display: grid; gap: var(--s-4); padding-top: var(--s-5); }
.me__grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--s-5); align-items: start; margin-top: var(--s-2); }
.me__rail { position: sticky; top: calc(var(--header-h) + 16px); }
@media (max-width: 960px) {
  .me__grid { grid-template-columns: minmax(0, 1fr); }
  .me__rail { position: static; order: -1; }
}
</style>
