<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import CommentPanel from "@/components/CommentPanel.vue";
import PreviewDoc from "@/components/preview/PreviewDoc.vue";
import { UPSTREAM_API } from "@/lib/config";
import { fetchCard, fetchPreviewPage, fetchRoleDetail } from "@/lib/api";
import { contentLang, pageTitle, zoneLabel } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { compact, hueFrom, plainText, relativeTime } from "@/lib/format";
import type { CommunityCard } from "@/lib/types";

const route = useRoute();
const { locale, lp } = useLocalePath();
const { t } = useI18n();

const card = ref<CommunityCard | null>(null);
const loading = ref(true);
const error = ref("");

/** 來源端的公開詳情：開場白、有沒有裝修主頁、作者有沒有關掉評論。 */
const welcome = ref("");
const showComments = ref(true);
const previewDoc = ref<unknown>(null);
const previewSkin = ref("");
const commentCount = ref<number | null>(null);

type Tab = "home" | "comments";
const tab = ref<Tab>("home");

const hue = computed(() => hueFrom(card.value?.name ?? ""));
const playUrl = computed(() => (card.value ? `${UPSTREAM_API.replace("api.", "")}/role/${card.value.roleId}` : "#"));

async function load() {
  loading.value = true;
  error.value = "";
  previewDoc.value = null;
  tab.value = "home";
  const id = route.params.id as string;
  const lang = contentLang(locale.value);
  try {
    card.value = await fetchCard(id, lang);
    document.title = pageTitle(card.value.name);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
    loading.value = false;
    return;
  }
  loading.value = false;

  // 主頁的其餘資料在卡片之後補上：讀不到只是少一塊，不擋整頁。
  const roleId = card.value.roleId;
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
}
watch([() => route.params.id, locale], load, { immediate: true });
</script>

<template>
  <div class="page role">
    <div v-if="loading" class="ghost role__ghost" />
    <p v-else-if="error" class="notice notice--error">{{ error }}</p>

    <template v-else-if="card">
      <!-- 背景圖只當氛圍：糊掉、壓淡，讓整頁有這張卡自己的色調 -->
      <div class="role__ambient" :style="{ backgroundImage: `url(${card.backgroundUrl || card.avatarUrl || ''})` }" aria-hidden="true" />

      <div class="role__layout">
        <aside class="role__side panel rise">
          <div class="role__art">
            <img v-if="card.avatarUrl" :src="card.avatarUrl" :alt="card.name" />
            <div v-else class="role__void" :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }">
              <span>{{ [...card.name][0] }}</span>
            </div>
          </div>

          <div class="role__id">
            <h1 class="role__name display">{{ card.name }}</h1>
            <!-- 作者是一張可點的名片，不只是一行灰字 -->
            <RouterLink :to="lp(`/authors/${card.author.accountNumId}`)" class="role__by">
              <img v-if="card.author.avatar" :src="card.author.avatar" alt="" />
              <span v-else class="role__by-void">{{ [...card.author.name][0] }}</span>
              <span class="role__by-text">
                <strong>{{ card.author.name }}</strong>
                <span class="subtle">{{ $t("card.authorPage") }}</span>
              </span>
              <span class="role__by-arrow" aria-hidden="true">→</span>
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

          <!-- 對話目前發生在作品所在的服務上；chat-core 接進來之後換成站內入口。 -->
          <a class="btn btn--primary role__cta" :href="playUrl" target="_blank" rel="noopener">{{ $t("card.play") }} ↗</a>

          <p class="subtle role__foot">
            {{ zoneLabel(card.zone) }} · {{ $t("card.meta", { registered: relativeTime(card.registeredAt), synced: relativeTime(card.syncedAt) }) }}
          </p>
        </aside>

        <section class="role__main">
          <div class="seg role__tabs" role="tablist">
            <button class="seg__item" :class="{ 'seg__item--on': tab === 'home' }" role="tab" :aria-selected="tab === 'home'" @click="tab = 'home'">{{ $t("card.tab.home") }}</button>
            <button v-if="showComments" class="seg__item" :class="{ 'seg__item--on': tab === 'comments' }" role="tab" :aria-selected="tab === 'comments'" @click="tab = 'comments'">
              {{ $t("card.tab.comments") }}<span v-if="commentCount" class="role__tab-n">{{ commentCount }}</span>
            </button>
          </div>

          <!-- 主頁：作者裝修過就照他的版面；沒有就是簡介＋開場白 -->
          <div v-show="tab === 'home'" class="panel role__home rise">
            <PreviewDoc v-if="previewDoc" :doc="previewDoc" :skin-id="previewSkin" @fallback="previewDoc = null" />
            <template v-else>
              <section class="role__block">
                <h2 class="eyebrow">{{ $t("card.about") }}</h2>
                <p class="role__text">{{ card.summary || $t("card.noSummary") }}</p>
              </section>
              <section v-if="welcome" class="role__block">
                <h2 class="eyebrow">{{ $t("card.welcome") }}</h2>
                <blockquote class="role__welcome">{{ welcome }}</blockquote>
              </section>
            </template>
          </div>


          <!-- 評論面板常駐（v-show），切回來不必重載；作者關掉評論就整個不掛 -->
          <div v-if="showComments" v-show="tab === 'comments'" class="panel role__comments">
            <CommentPanel :role-id="card.roleId" @count="commentCount = $event" />
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.role { position: relative; }
.role__ghost { height: 520px; border-radius: var(--r-lg); }

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
.role__by img, .role__by-void { width: 32px; height: 32px; border-radius: 999px; object-fit: cover; flex: none; }
.role__by-void { display: grid; place-items: center; background: var(--surface); font-size: 13px; font-weight: 600; color: var(--text-2); }
.role__by-text { display: grid; line-height: 1.3; min-width: 0; }
.role__by-text strong { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.role__by-arrow { margin-left: auto; color: var(--text-3); transition: transform var(--dur) var(--ease), color var(--dur) var(--ease); }
.role__by:hover .role__by-arrow { transform: translateX(3px); color: var(--accent); }

.role__stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-2); padding: var(--s-3) 0; box-shadow: 0 1px 0 var(--line), 0 -1px 0 var(--line); }
.role__stats .stat dd { font-size: 16px; }
.role__stats .stat dd.up { color: var(--accent); }

.role__tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.role__cta { height: 42px; font-size: 15px; }
.role__foot { line-height: 1.5; }

.role__main { display: grid; gap: var(--s-3); min-width: 0; }
.role__tabs { width: fit-content; }
.role__tab-n { margin-left: 5px; font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }

.role__home { display: grid; gap: var(--s-5); padding: var(--s-5); }
.role__block { display: grid; gap: var(--s-2); }
.role__text { max-width: 64ch; font-size: 14.5px; line-height: 1.8; white-space: pre-wrap; }
.role__welcome {
  margin: 0; padding: var(--s-3) var(--s-4); max-width: 64ch;
  border-radius: 4px 16px 16px 16px; background: var(--surface-2);
  font-size: 14.5px; line-height: 1.8; white-space: pre-wrap;
}
.role__comments { padding: var(--s-5); }


@media (max-width: 820px) {
  .role__layout { grid-template-columns: 1fr; }
  .role__side { position: static; grid-template-columns: 132px minmax(0, 1fr); align-items: start; column-gap: var(--s-4); }
  .role__art { grid-row: 1 / span 3; }
  .role__stats, .role__tags, .role__cta, .role__foot { grid-column: 1 / -1; }
  .role__home, .role__comments { padding: var(--s-4); }
}
</style>
