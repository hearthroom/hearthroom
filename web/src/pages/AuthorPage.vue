<script setup lang="ts">
import CommunityAvatar from "@/components/CommunityAvatar.vue";
import CommunityName from "@/components/CommunityName.vue";
import CommunityBadgeList from "@/components/CommunityBadgeList.vue";
import WornBadges from "@/components/WornBadges.vue";
import { usePublicAppearance } from "@/lib/community-appearance";
import LibraryToggle from "@/components/LibraryToggle.vue";
import TipPlatformIcon from "@/components/TipPlatformIcon.vue";
import { tipPlatform } from "../../../shared/tip-links";
import { profileCover, profileCoverUrl } from "../../../shared/profile-covers";
import { track } from "@/lib/track";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import CardGrid from "@/components/CardGrid.vue";
import NotFoundPage from "@/pages/NotFoundPage.vue";
import { ApiError, fetchAuthor, fetchBoard } from "@/lib/api";
import { compact, hueFrom, relativeTime } from "@/lib/format";
import { contentLang, pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import type { Author, CardPage } from "@/lib/types";

const route = useRoute();
const router = useRouter();
const { locale } = useLocalePath();
const session = useSession();
const { t } = useI18n();
const author = ref<Author | null>(null);
const page = ref<CardPage | null>(null);
const loading = ref(true);
const missing = ref(false);
const error = ref("");
const offset = computed(() => Number(route.query.offset ?? 0) || 0);
const LIMIT = 24;
/** 社群等級（綁了 Discord 才有）：放在名字下面那一行，跟展示徽章分開 */
const identity = usePublicAppearance(() => author.value?.handle ?? undefined);
const level = computed(() => identity.value?.level ?? null);

async function load() {
  loading.value = !page.value;
  missing.value = false;
  error.value = "";
  const handle = String(route.params.handle ?? "");
  try {
    const [profile, board] = await Promise.all([
      fetchAuthor(handle),
      fetchBoard({ author: handle, sort: "new", limit: LIMIT, offset: offset.value,...(typeof route.query.cursor==='string'?{cursor:route.query.cursor}:{}), lang: contentLang(locale.value) }),
    ]);
    author.value = profile;
    page.value = board;
    document.title = pageTitle(profile.name);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) missing.value = true;
    else error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}
function go(offset: number,cursor?:string) {
  router.push({ query: {...(offset>0?{offset:String(offset)}:{}),...(cursor?{cursor}:{})} });
}
watch(() => route.params.handle, () => { author.value = null; page.value = null; load(); }, { immediate: true });
watch([() => route.query.offset,() =>route.query.cursor], load);
function reloadViewer(){if(route.query.cursor!==undefined||offset.value)go(0);else void load();}
watch(locale,reloadViewer);
// 開關改了要重讀；身分剛載好、發現本來就開著（undefined → true）也要——第一次讀多半比身分早到
watch(() => session.profile?.showNsfw, (now, before) => { if (now !== before && (now === true || before !== undefined)) reloadViewer(); });
</script>

<template>
  <NotFoundPage v-if="missing" :title="$t('author.notFound.title')" :hint="$t('author.notFound.hint')" />

  <div v-else class="page">
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <!-- 作者選的主頁封面（站內場景圖），往下淡出成同色系，跟「我的」主頁同一張臉 -->
    <div v-if="author && !error" class="cover" :style="{ '--hue': profileCover(author.cover).hue }" aria-hidden="true">
      <img :src="profileCoverUrl(author.cover)" alt="" />
    </div>
    <header v-if="!error && author" class="who panel rise">
      <CommunityAvatar :handle="author.handle ?? undefined" :src="author.avatar" :name="author.name" class="who__face" />
      <div class="who__text">
        <p class="eyebrow">{{ $t("author.eyebrow") }}</p>
        <h1 class="who__name display"><CommunityName :handle="author.handle ?? undefined" :name="author.name" :official="author.official" /></h1>
        <p class="subtle who__id">
          <span class="mono">@{{ author.handle }}</span>
          <CommunityBadgeList v-if="level !== null" :badges="[]" :level="level" class="who__level" />
        </p>
        <!-- 名字旁只放作者選來展示的徽章；全部徽章在獨立的徽章頁，主頁主體是卡片 -->
        <WornBadges v-if="author.handle" :key="author.handle" :handle="author.handle" class="who__worn" />
        <p v-if="author.bio" class="who__bio">{{ author.bio }}</p>
        <!-- 打賞連結：每一條直接連到那個平台，錢在那邊付 -->
        <ul v-if="author.tips?.length" class="who__tips" :aria-label="$t('tips.title')">
          <li v-for="tip in author.tips" :key="tip.url">
            <a :href="tip.url" target="_blank" rel="noopener noreferrer nofollow" class="who__tip" @click="track('tip_click', { subject: tip.platform })">
              <TipPlatformIcon :platform="tip.platform" class="who__tip-icon" />{{ tipPlatform(tip.platform).name }}
            </a>
          </li>
        </ul>
      </div>
      <LibraryToggle v-if="author.handle && author.handle !== session.profile?.handle" kind="following" :target="author.handle" />
      <dl class="who__stats">
        <div class="stat"><dt>{{ $t("author.stat.cards") }}</dt><dd>{{ author.cardCount }}</dd></div>
        <div class="stat"><dt>{{ $t("author.stat.talk") }}</dt><dd>{{ compact(author.talkTotal) }}</dd></div>
        <div class="stat"><dt>{{ $t("author.stat.joined") }}</dt><dd>{{ relativeTime(author.joinedAt) }}</dd></div>
      </dl>
    </header>
    <div v-else-if="!error" class="ghost who--ghost" aria-hidden="true" />

    <CardGrid
      :cards="page?.items ?? []"
      :loading="loading && !page"
      :busy="loading"
      show-zone
      :empty-title="$t('author.empty.title')"
      :empty-hint="$t('author.empty.hint')"
    />
    <nav v-if="page && (page.offset > 0 || page.hasNext)" class="pager">
      <button class="btn btn--sm" :disabled="page.offset === 0" @click="go(Math.max(0, page.offset - page.limit),page.previousCursor)">← {{ $t("pager.prev") }}</button>
      <span class="subtle">
        {{ page.total === null
          ? $t("pager.page", { n: Math.floor(page.offset / page.limit) + 1 })
          : $t("pager.pageOf", { n: Math.floor(page.offset / page.limit) + 1, total: Math.ceil(page.total / page.limit) }) }}
      </span>
      <button class="btn btn--sm" :disabled="!page.hasNext" @click="go(page.offset + page.limit,page.nextCursor)">{{ $t("pager.next") }} →</button>
    </nav>
  </div>
</template>

<style scoped>
.who {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-5);
  padding: var(--s-5); margin-bottom: var(--s-5);
}
.who--ghost { height: 112px; border-radius: var(--r-lg); margin-bottom: var(--s-5); }
.who__face { width: 64px; height: 64px; border-radius: var(--r-pill); object-fit: cover; flex: none; font-size: 24px; }
/* 簡介兩行截斷：頭部再長，第一排卡片也要在手機首屏內（徽章第一期 ui.md §3.1） */
.who__bio {white-space:pre-wrap;overflow-wrap:anywhere;max-width:40rem;margin:var(--s-2) 0 0;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* 展示列是子元件的根節點（不帶這一頁的 scope），選擇器要用 :deep */
:deep(.who__worn) { margin-top: 2px; }
.who__level { display: inline-flex; vertical-align: middle; margin-left: var(--s-2); }
.who__tips { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-3) 0 0; padding: 0; list-style: none; }
.who__tip {
  display: inline-flex; align-items: center; gap: var(--s-2); height: var(--h-md); padding: 0 var(--s-3) 0 4px;
  border: 1px solid var(--line-strong); border-radius: var(--r-pill); background: var(--surface);
  font-size: 13px; font-weight: 600; color: var(--text); transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.who__tip:hover { border-color: var(--accent); background: var(--accent-tint); }
.who__tip-icon { width: 28px; height: 28px; }
.who__text { min-width: 0; margin-right: auto; flex: 1 1 20rem; }
.who__name { font-size: clamp(20px, 2.6vw, 26px); }
.who__id { margin: 4px 0 0; }
.who__stats { display: flex; gap: var(--s-6); }
.cover { position: relative; height: 160px; margin-bottom: calc(var(--s-6) * -1); border-radius: var(--r-lg) var(--r-lg) 0 0; overflow: hidden; }
.cover img { width: 100%; height: 100%; object-fit: cover; object-position: right 40%; }
.cover::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, color-mix(in srgb, hsl(var(--hue) 44% 89%) 85%, transparent) 90%, hsl(var(--hue) 44% 89%)); }
:root[data-mode="dark"] .cover::after { background: linear-gradient(180deg, transparent 40%, color-mix(in srgb, hsl(var(--hue) 24% 19%) 85%, transparent) 90%, hsl(var(--hue) 24% 19%)); }
.cover + .who { position: relative; }
@media (max-width: 640px) {
  .cover { height: 96px; }
  /* 手機：頭像｜名字＋@handle，其下展示列、簡介、關注、數字各佔滿一列；「作者」小標省掉 */
  .who { display: grid; grid-template-columns: 56px minmax(0, 1fr); align-items: start; gap: var(--s-2) var(--s-3); padding: var(--s-4); }
  .who > * { min-width: 0; }
  .who__face { width: 56px; height: 56px; grid-row: 1 / 3; }
  .who__text { display: contents; }
  .who .eyebrow { display: none; }
  .who__name { grid-column: 2; grid-row: 1; align-self: end; font-size: 22px; }
  .who__id { grid-column: 2; grid-row: 2; margin: 0; }
  .who > .who__text > :deep(.who__worn), .who__bio, .who__tips { grid-column: 1 / -1; }
  .who__bio { margin: 0; }
  .who > .library-toggle { grid-column: 1 / -1; }
  .who > .library-toggle :deep(.btn) { width: 100%; }
  .who__stats { grid-column: 1 / -1; justify-content: space-between; gap: var(--s-3); }
}
</style>
