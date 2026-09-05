<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import CardGrid from "@/components/CardGrid.vue";
import CommentPanel from "@/components/CommentPanel.vue";
import NotFoundPage from "@/pages/NotFoundPage.vue";
import PreviewDoc from "@/components/preview/PreviewDoc.vue";
import { UPSTREAM_API } from "@/lib/config";
import { ApiError, fetchBoard, fetchCard, fetchPreviewPage, fetchRoleDetail } from "@/lib/api";
import { contentLang, pageTitle, zoneLabel } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { compact, hueFrom, plainText, relativeTime } from "@/lib/format";
import { confirmDialog } from "@/lib/confirm";
import { track } from "@/lib/track";
import type { CommunityCard } from "@/lib/types";

const route = useRoute();
const { locale, lp } = useLocalePath();
const { t } = useI18n();

const card = ref<CommunityCard | null>(null);
const loading = ref(true);
/** 手上有卡、在背景換語言重抓：舊卡留著變淡，不退回骨架 */
const revalidating = ref(false);
const missing = ref(false);
const error = ref("");

/** 來源端的公開詳情：開場白、有沒有裝修主頁、作者有沒有關掉評論。 */
const welcome = ref("");
const showComments = ref(true);
const previewDoc = ref<unknown>(null);
const previewSkin = ref("");
const commentCount = ref<number | null>(null);
/** 同一位作者的其他作品：看完一張想接著看，不必先繞去作者頁 */
const more = ref<CommunityCard[]>([]);
const copied = ref(false);

type Tab = "home" | "comments";
const tab = ref<Tab>("home");
/** tab 的鍵盤慣例：左右鍵切換並把焦點帶過去 */
function onTabKey(e: KeyboardEvent) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  tab.value = tab.value === "home" && showComments.value ? "comments" : "home";
  (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`#tab-${tab.value}`)?.focus();
}

const hue = computed(() => hueFrom(card.value?.name ?? ""));
const broken = ref(false);
const hasArt = computed(() => !!card.value?.avatarUrl && !broken.value);
const playUrl = computed(() => (card.value ? `${UPSTREAM_API.replace("api.", "")}/role/${card.value.roleId}` : "#"));

async function load() {
  // 換語言時手上還有卡：留著，資料到了再換，不退回骨架
  revalidating.value = !!card.value;
  loading.value = !card.value;
  missing.value = false;
  error.value = "";
  const id = route.params.id as string;
  const lang = contentLang(locale.value);
  try {
    card.value = await fetchCard(id, lang);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) missing.value = true;
    else error.value = err instanceof Error ? err.message : t("state.loadFailed");
    loading.value = false;
    revalidating.value = false;
    return;
  }
  loading.value = false;
  revalidating.value = false;
  document.title = pageTitle(card.value.name);
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", card.value.summary);

  const roleId = card.value.roleId;
  const authorId = card.value.author.accountNumId;
  // 主頁的其餘資料在卡片之後補上：讀不到只是少一塊，不擋整頁。
  void fetchRoleDetail(roleId, undefined, lang)
    .then((raw) => {
      welcome.value = plainText(String(raw.roleWelcome ?? ""), card.value?.name ?? "", t("card.you"));
      showComments.value = raw.previewShowComments !== false;
      if (raw.hasPreviewPage === true) {
        return fetchPreviewPage(roleId).then((p) => {
          previewDoc.value = p.doc ?? null;
          previewSkin.value = p.skinId ?? "";
        });
      }
    })
    .catch(() => { /* 預設版面照樣能看 */ });
  void fetchBoard({ author: authorId, sort: "top", limit: 9, lang })
    .then((b) => { more.value = b.items.filter((c) => c.roleId !== roleId).slice(0, 8); })
    .catch(() => { more.value = []; });
}

async function share() {
  const url = location.href;
  const title = card.value?.name ?? "";
  const subject = card.value?.roleId ?? "";
  if (typeof navigator.share === "function") {
    try { await navigator.share({ title, url }); track("share", { detail: "share_web", subject }); return; }
    catch (e) {
      // 使用者按了取消：什麼都不做。其他錯誤（這個環境其實不能分享）才退回複製
      if ((e as DOMException).name === "AbortError") { track("share", { detail: "share_abort", subject }); return; }
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    copied.value = true;
    track("share", { detail: "share_clipboard", subject });
    setTimeout(() => { copied.value = false; }, 1800);
  } catch {
    // 拿不到剪貼簿：把網址攤在使用者面前讓他自己複製，總比按了沒反應好
    // 這條分支的出現頻率就是「分享按鈕在多少環境下是壞的」，值得單獨記一個值
    track("share", { detail: "share_manual", subject, ok: false });
    await confirmDialog({ title: t("card.share"), message: t("card.copyLink"), detail: url, single: true });
  }
}

watch(() => route.params.id, () => {
  card.value = null; welcome.value = ""; previewDoc.value = null; more.value = []; broken.value = false; tab.value = "home";
  commentCount.value = null; showComments.value = true;
  load();
}, { immediate: true });
watch(locale, load);
</script>

<template>
  <NotFoundPage v-if="missing" :title="$t('card.notFound.title')" :hint="$t('card.notFound.hint')" />

  <div v-else class="page role">
    <!-- 骨架照著真的版面畫：左邊一張身分證、右邊一塊面板，資料來了不跳版 -->
    <div v-if="loading" class="role__layout" aria-hidden="true">
      <div class="role__side role__side--ghost">
        <div class="ghost role__art" />
        <div class="ghost" style="height: 26px; width: 60%" />
        <div class="ghost" style="height: 48px" />
        <div class="ghost" style="height: 44px" />
      </div>
      <div class="role__main">
        <div class="ghost" style="height: 36px; width: 140px; border-radius: 999px" />
        <div class="ghost" style="height: 220px; border-radius: 16px" />
      </div>
    </div>
    <p v-else-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <template v-else-if="card">
      <!-- 背景圖只當氛圍：糊掉、壓淡，讓整頁有這張卡自己的色調 -->
      <div class="role__ambient" :style="{ backgroundImage: `url(${card.backgroundUrl || card.avatarUrl || ''})` }" aria-hidden="true" />

      <div class="role__layout" :aria-busy="revalidating || undefined">
        <aside class="role__side panel rise">
          <div class="role__art">
            <img v-if="hasArt" :src="card.avatarUrl!" alt="" fetchpriority="high" @error="broken = true" />
            <div v-else class="role__void" :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }">
              <span>{{ [...card.name][0] }}</span>
            </div>
          </div>

          <div class="role__id">
            <h1 class="role__name display">{{ card.name }}</h1>
            <!-- 作者是一張可點的名片，不只是一行灰字 -->
            <RouterLink :to="lp(`/authors/${card.author.accountNumId}`)" class="role__by">
              <img v-if="card.author.avatar" :src="card.author.avatar" alt="" />
              <span v-else class="role__by-void mono" :style="{ '--h': hueFrom(card.author.name) }">{{ [...card.author.name][0] }}</span>
              <span class="role__by-text">
                <strong>{{ card.author.name }}</strong>
                <span class="subtle">{{ $t("card.authorPage") }}</span>
              </span>
              <svg class="role__by-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </RouterLink>
          </div>

          <dl class="role__stats">
            <div class="stat"><dt>{{ $t("card.stat.talk") }}</dt><dd>{{ compact(card.talkNum) }}</dd></div>
            <div class="stat"><dt>{{ $t("card.stat.follow") }}</dt><dd>{{ compact(card.followNum) }}</dd></div>
            <div class="stat"><dt>{{ $t("card.stat.trending") }}</dt><dd :class="{ up: card.trending > 0 }">{{ card.trending > 0 ? `+${compact(card.trending)}` : "—" }}</dd></div>
          </dl>

          <ul v-if="card.tags.length" class="role__tags">
            <li v-for="tag in card.tags" :key="tag">
              <RouterLink :to="{ path: lp('/'), query: { tag } }" class="chip">#{{ tag }}</RouterLink>
            </li>
          </ul>

          <div class="role__actions">
            <!-- 對話目前發生在作品所在的服務上；chat-core 接進來之後換成站內入口。 -->
            <a class="btn btn--primary btn--lg role__cta" :href="playUrl" target="_blank" rel="noopener" :title="$t('card.opensNew')" @click="track('cta', { subject: card.roleId })">
              {{ $t("card.play") }} ↗<span class="sr-only">（{{ $t("card.opensNew") }}）</span>
            </a>
            <button class="btn btn--lg btn--icon role__share" :aria-label="$t('card.share')" :title="$t('card.share')" @click="share">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 12.5V3.5M6.5 7 10 3.5 13.5 7M4 11v4.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>

          <p class="subtle role__foot">
            {{ zoneLabel(card.zone) }} · {{ $t("card.meta", { registered: relativeTime(card.registeredAt), synced: relativeTime(card.syncedAt) }) }}
          </p>
        </aside>

        <section class="role__main">
          <div class="seg role__tabs" role="tablist" @keydown="onTabKey">
            <button id="tab-home" class="seg__item" :class="{ 'seg__item--on': tab === 'home' }" role="tab" aria-controls="panel-home" :aria-selected="tab === 'home'" :tabindex="tab === 'home' ? 0 : -1" @click="tab = 'home'">{{ $t("card.tab.home") }}</button>
            <button v-if="showComments" id="tab-comments" class="seg__item" :class="{ 'seg__item--on': tab === 'comments' }" role="tab" aria-controls="panel-comments" :aria-selected="tab === 'comments'" :tabindex="tab === 'comments' ? 0 : -1" @click="tab = 'comments'; track('comment_tab', { subject: card.roleId })">
              {{ $t("card.tab.comments") }}<span v-if="commentCount" class="role__tab-n">{{ commentCount }}</span>
            </button>
          </div>

          <!-- 主頁：作者裝修過就照他的版面；沒有就是簡介＋開場白 -->
          <div v-show="tab === 'home'" id="panel-home" class="panel role__home rise" role="tabpanel" aria-labelledby="tab-home">
            <PreviewDoc v-if="previewDoc" :doc="previewDoc" :skin-id="previewSkin" @fallback="previewDoc = null" />
            <template v-else>
              <section class="role__block">
                <h2 class="eyebrow">{{ $t("card.about") }}</h2>
                <p class="role__text">{{ card.summary || $t("card.noSummary") }}</p>
              </section>
              <section v-if="welcome" class="role__block">
                <h2 class="eyebrow">{{ $t("card.welcome") }}</h2>
                <!-- 開場白是角色開口說的第一句：畫成它在說話，跟作者裝修頁的氣泡同一種語言 -->
                <div class="role__welcome">
                  <img v-if="hasArt" :src="card.avatarUrl!" alt="" class="role__welcome-face" />
                  <span v-else class="role__welcome-face mono" :style="{ '--h': hue }">{{ [...card.name][0] }}</span>
                  <blockquote class="role__bubble">{{ welcome }}</blockquote>
                </div>
              </section>
            </template>
          </div>

          <!-- 評論面板常駐（v-show），切回來不必重載；作者關掉評論就整個不掛 -->
          <div v-if="showComments" v-show="tab === 'comments'" id="panel-comments" class="panel role__comments" role="tabpanel" aria-labelledby="tab-comments">
            <CommentPanel :role-id="card.roleId" @count="commentCount = $event" />
          </div>

          <section v-if="more.length" class="role__more">
            <h2 class="role__more-title">
              <RouterLink :to="lp(`/authors/${card.author.accountNumId}`)">{{ $t("card.moreBy", { name: card.author.name }) }}</RouterLink>
            </h2>
            <CardGrid :cards="more" show-zone />
          </section>
        </section>
      </div>
    </template>

    <!-- live region 要先存在再改內容，讀屏器才會唸；所以常駐、用 hidden 切 -->
    <div class="toast" role="status" :hidden="!copied">{{ copied ? $t("card.copied") : "" }}</div>
  </div>
</template>

<style scoped>
.role { position: relative; }

.role__ambient {
  position: absolute; inset: 0 -50vw auto -50vw; height: 50vh; z-index: 0;
  background-size: cover; background-position: center 30%;
  opacity: 0.28; filter: blur(64px) saturate(1.2);
  mask-image: linear-gradient(to bottom, #000 20%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, #000 20%, transparent);
  pointer-events: none;
}

.role__layout {
  position: relative; z-index: 1;
  display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: var(--s-5);
  align-items: start;
}

/* 左欄：這張卡的「身分證」——貼著頁首捲動時留在原地 */
.role__side {
  position: sticky; top: calc(var(--header-h) + var(--s-4));
  display: grid; gap: var(--s-4); padding: var(--s-4);
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
}
.role__side--ghost { background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
.role__art { aspect-ratio: 3 / 4; border-radius: var(--r-md); overflow: hidden; background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); }
.role__art img { width: 100%; height: 100%; object-fit: cover; }
.role__void { display: grid; place-items: center; height: 100%; }
.role__void span { font-size: 80px; font-weight: 600; color: rgba(255, 255, 255, 0.9); }

.role__id { display: grid; gap: 6px; }
.role__name { font-size: 22px; line-height: 1.25; }
.role__by {
  display: flex; align-items: center; gap: 10px;
  margin-top: 4px; padding: 8px 10px; border-radius: var(--r-md);
  background: var(--surface-2);
  transition: background var(--dur) var(--ease);
}
.role__by:hover { background: var(--accent-soft); }
.role__by img, .role__by-void { width: 32px; height: 32px; border-radius: var(--r-pill); object-fit: cover; flex: none; font-size: 13px; }
.role__by-text { display: grid; line-height: 1.3; min-width: 0; }
.role__by-text strong { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.role__by-arrow { width: 16px; height: 16px; margin-left: auto; color: var(--text-3); flex: none; transition: transform var(--dur) var(--ease), color var(--dur) var(--ease); }
.role__by:hover .role__by-arrow { transform: translateX(3px); color: var(--accent-text); }

.role__stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-2); padding: var(--s-3) 0; box-shadow: 0 1px 0 var(--line), 0 -1px 0 var(--line); }
.role__stats .stat dd { font-size: 16px; }
.role__stats .stat dd.up { color: var(--accent-text); }

.role__tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.role__actions { display: flex; gap: var(--s-2); }
.role__cta { flex: 1; min-width: 0; }
.role__share { width: var(--h-lg); flex: none; }
.role__share svg { width: 18px; height: 18px; }
.role__foot { line-height: 1.5; }

.role__main { display: grid; gap: var(--s-3); min-width: 0; align-content: start; }
.role__tabs { width: fit-content; }
.role__tab-n { margin-left: 5px; font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }

.role__home { display: grid; gap: var(--s-5); padding: var(--s-5); }
.role__block { display: grid; gap: var(--s-2); }
.role__text { max-width: 64ch; font-size: 14.5px; line-height: 1.8; white-space: pre-wrap; }
.role__welcome { display: flex; gap: 10px; align-items: flex-start; max-width: 64ch; }
.role__welcome-face { width: 34px; height: 34px; border-radius: var(--r-pill); object-fit: cover; flex: none; font-size: 14px; }
.role__bubble {
  margin: 0; padding: var(--s-3) var(--s-4); min-width: 0;
  border-radius: 4px 16px 16px 16px; background: var(--surface-2);
  font-size: 14.5px; line-height: 1.8; white-space: pre-wrap;
}
.role__comments { padding: var(--s-5); }

.role__more { display: grid; gap: var(--s-3); margin-top: var(--s-3); }
.role__more-title { font-size: 14px; font-weight: 600; }
.role__more-title a:hover { color: var(--accent-text); }

@media (max-width: 820px) {
  .role__layout { grid-template-columns: 1fr; }
  .role__side { position: static; grid-template-columns: 132px minmax(0, 1fr); align-items: start; column-gap: var(--s-4); }
  .role__art { grid-row: 1 / span 3; }
  .role__stats, .role__tags, .role__actions, .role__foot { grid-column: 1 / -1; }
  .role__home, .role__comments { padding: var(--s-4); }
}
</style>
