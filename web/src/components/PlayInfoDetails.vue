<script setup lang="ts">
/**
 * 卡片資訊面板的「資訊」分頁（PlayInfoPanel）。內容只取卡片頁已公開的：封面與榜單徽章、卡名、作者、評分、分級、
 * 一句話簡介、原作與標籤、對話／熱度／收藏、作者寫的介紹、卡號、語言。開場白與設定內容卡片頁不放，這裡也不放。
 * 卡名與封面來自開卡時讀到的那份，一打開就畫；評分各自讀，到了再補。
 * 這一頁不能換掉遊玩頁（會卸載沙盒）：標籤、原作、作者都是不可點的字，連結只有兩個，都開新分頁。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import CommunityAvatar from "@/components/CommunityAvatar.vue";
import RankBadge from "@/components/RankBadge.vue";
import RatingMark from "@/components/RatingMark.vue";
import ReadmeView from "@/components/ReadmeView.vue";
import { fetchCardScore, type CardScore } from "@/lib/api";
import { thumbChain } from "@/lib/card-thumb";
import { renderReadme } from "@/lib/card-readme";
import { confirmDialog } from "@/lib/confirm";
import { displayHtml, displayName } from "@/lib/display-name";
import { cardFandom } from "@/lib/fandom";
import { compact, hueFrom } from "@/lib/format";
import { coverHonors } from "@/lib/honors";
import { zoneLabel } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { mainSiteLinks } from "@/lib/site";
import { useLocalePath } from "@/lib/use-locale";
import type { CommunityCard } from "@/lib/types";

const props = defineProps<{ card: CommunityCard; readme: string }>();
const { t } = useI18n();
const { locale, lp } = useLocalePath();
const session = useSession();

const name = computed(() => displayName(props.card.name, locale.value));
const summary = computed(() => displayName(props.card.summary ?? "", locale.value));
const fandom = computed(() => cardFandom(props.card, locale.value));
const honors = computed(() => coverHonors(props.card.honors ?? []));
const hue = computed(() => hueFrom(props.card.name));
const artStep = ref(0);
const art = computed(() => (props.card.avatarUrl ? thumbChain(props.card.avatarUrl) : [])[artStep.value] ?? "");
watch(() => props.card.avatarUrl, () => { artStep.value = 0; });

/** 介紹：作者寫的 Markdown；沒寫就整塊不畫（簡介已在上面）。超過約九行先收起來 */
const readmeHtml = computed(() => (props.readme.trim() ? displayHtml(renderReadme(props.readme), locale.value) : ""));
const introBox = ref<HTMLElement | null>(null);
const introLong = ref(false);
const introOpen = ref(false);
const INTRO_MAX = 240;
let introObserver: ResizeObserver | null = null;
watch(introBox, (el) => {
  introObserver?.disconnect();
  introObserver = null;
  if (!el || typeof ResizeObserver === "undefined") return;
  introObserver = new ResizeObserver(() => { introLong.value = el.scrollHeight > INTRO_MAX + 40; });
  introObserver.observe(el);
});

// 評分：卡片頁同一份；讀不到只是少那一段
const score = ref<CardScore | null>(null);
async function loadScore() {
  const id = props.card.id;
  try {
    const token = session.me ? (await session.accessToken()) ?? undefined : undefined;
    const got = await fetchCardScore(id, token);
    if (props.card.id === id) score.value = Array.isArray(got?.histogram) && typeof got.count === "number" ? got : null;
  } catch { /* 沒有評分也能看 */ }
}
watch(() => props.card, () => { void loadScore(); }, { immediate: true });

/** 兩個連結都回主站（卡片 App 網域上只有對話頁），開新分頁 */
const links = computed(() => mainSiteLinks({ locale: String(locale.value), lp }));
const cardRef = computed(() => String(props.card.num ?? props.card.id));
const cardPageUrl = computed(() => `${links.value.origin}${links.value.lp(`/cards/${encodeURIComponent(cardRef.value)}`)}`);
const reportUrl = computed(() => `${links.value.origin}${links.value.lp(`/me?reportCard=${encodeURIComponent(cardRef.value)}`)}`);

// 卡號：跟卡片頁一樣按了就複製；拿不到剪貼簿就攤開讓人自己選
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copyId() {
  const id = props.card.num ? String(props.card.num) : "";
  if (!id) return;
  try {
    await navigator.clipboard.writeText(id);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied.value = false; }, 1800);
  } catch {
    await confirmDialog({ title: t("card.id"), message: t("card.copyIdManual"), detail: id, single: true });
  }
}
onBeforeUnmount(() => { introObserver?.disconnect(); clearTimeout(copiedTimer); });
</script>

<template>
  <div class="pip-info">
    <header class="pip-info__head">
      <div class="pip-info__art">
        <img v-if="art" :key="art" :src="art" alt="" @error="artStep += 1" />
        <div v-else class="pip-info__void" :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }"><span>{{ [...name][0] }}</span></div>
        <div v-if="honors.length" class="pip-info__marks">
          <RankBadge v-for="honor in honors" :key="honor.window" :honor="honor" class="pip-info__honor" />
        </div>
      </div>
      <div class="pip-info__id">
        <h2 class="pip-info__name">{{ name }}</h2>
        <span class="pip-info__by">
          <CommunityAvatar :handle="card.author.handle ?? undefined" :src="card.author.avatar" :name="card.author.name" class="pip-info__avatar" />
          <span class="pip-info__author">{{ card.author.name }}</span>
        </span>
        <div class="pip-info__meta">
          <span v-if="score && score.count" class="pip-info__score">
            <span class="pip-info__star" aria-hidden="true">★</span>
            <strong>{{ score.average?.toFixed(1) }}</strong>
            <span class="subtle">{{ t("score.count", { n: score.count }) }}</span>
          </span>
          <RatingMark v-if="card.rating" :rating="card.rating" variant="chip" />
        </div>
      </div>
    </header>

    <p v-if="summary" class="pip-info__summary" :title="summary">{{ summary }}</p>

    <ul v-if="fandom || card.tags.length" class="pip-info__chips">
      <li v-if="fandom" class="chip pip-info__fandom">{{ t("card.fandom") }} {{ fandom }}</li>
      <li v-for="tag in card.tags" :key="tag" class="chip">#{{ tag }}</li>
    </ul>

    <dl class="pip-info__stats">
      <div class="stat"><dt>{{ t("card.stat.talk") }}</dt><dd>{{ compact(card.talkNum) }}</dd></div>
      <div class="stat" :title="t('card.stat.heatHint')"><dt>{{ t("card.stat.heat") }}</dt><dd>{{ (card.heat ?? 0) > 0 ? compact(card.heat!) : "—" }}</dd></div>
      <div class="stat"><dt>{{ t("card.stat.follow") }}</dt><dd>{{ compact(card.favoriteCount ?? 0) }}</dd></div>
    </dl>

    <section v-if="readmeHtml" class="pip-info__intro-wrap" aria-labelledby="pip-intro-h">
      <h3 id="pip-intro-h" class="pip-info__h">{{ t("card.about") }}</h3>
      <div ref="introBox" class="pip-info__intro" :class="{ 'pip-info__intro--clamped': introLong && !introOpen }" :style="{ '--intro-max': `${INTRO_MAX}px` }">
        <ReadmeView :html="readmeHtml" />
      </div>
      <button v-if="introLong && !introOpen" type="button" class="btn btn--sm pip-info__more" @click="introOpen = true">{{ t("card.aboutMore") }}</button>
    </section>

    <dl class="pip-info__kv">
      <template v-if="card.num">
        <dt>{{ t("card.id") }}</dt>
        <dd>
          <button type="button" class="pip-info__cid" :title="t('card.copyId')" :aria-label="`${t('card.copyId')} #${card.num}`" @click="copyId">
            <code class="mono">#{{ card.num }}</code>
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
          </button>
          <!-- 回饋寫在卡號旁：面板蓋在 toast 層之上，toast 會被擋住 -->
          <span class="pip-info__copied" role="status">{{ copied ? t("card.idCopied") : "" }}</span>
        </dd>
      </template>
      <dt>{{ t("card.language") }}</dt><dd>{{ zoneLabel(card.zone) }}</dd>
    </dl>

    <footer class="pip-info__foot">
      <a class="pip-info__report" :href="reportUrl" target="_blank" rel="noopener noreferrer">{{ t("community.reportCard") }}<span class="sr-only">（{{ t("play.info.newTab") }}）</span></a>
      <a class="btn pip-info__open" :href="cardPageUrl" target="_blank" rel="noopener noreferrer">{{ t("play.info.openCardPage") }}<span aria-hidden="true">↗</span><span class="sr-only">（{{ t("play.info.newTab") }}）</span></a>
    </footer>
  </div>
</template>

<style scoped>
.pip-info { display: grid; gap: var(--s-4); min-width: 0; }
.pip-info__head { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: var(--s-3); align-items: start; }
.pip-info__art { position: relative; width: 84px; aspect-ratio: 3 / 4; border-radius: var(--r-md); overflow: hidden; background: var(--surface-2); box-shadow: 0 0 0 1px var(--line); }
.pip-info__art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pip-info__void { display: grid; place-items: center; height: 100%; }
.pip-info__void span { font-size: 32px; font-weight: 600; color: rgba(255, 255, 255, 0.9); }
.pip-info__marks { position: absolute; left: 4px; top: 4px; right: 4px; display: flex; gap: 1px; pointer-events: none; --rank-badge-h: 22px; }
.pip-info__honor { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)); }
.pip-info__id { display: grid; gap: var(--s-2); min-width: 0; align-content: start; }
.pip-info__name {
  margin: 0; font-size: 18px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.pip-info__by { display: inline-flex; align-items: center; gap: var(--s-2); min-width: 0; font-size: 13px; font-weight: 600; }
.pip-info__by :deep(img), .pip-info__by :deep(.pip-info__avatar) { width: 22px; height: 22px; border-radius: var(--r-pill); object-fit: cover; flex: none; font-size: 11px; }
.pip-info__author { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pip-info__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); font-size: 13px; }
.pip-info__score { display: inline-flex; align-items: center; gap: 5px; }
.pip-info__star { color: var(--gold); }
.pip-info__summary {
  margin: 0; font-size: 14px; line-height: 1.65; color: var(--text-2); white-space: pre-line; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.pip-info__chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; padding: 0; list-style: none; }
.pip-info__chips .chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pip-info__fandom { color: var(--text); box-shadow: inset 0 0 0 1px var(--line-strong); background: transparent; }
.pip-info__stats { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: auto auto; align-items: baseline; gap: 0 var(--s-2); margin: 0; padding: var(--s-3) 0; box-shadow: 0 -1px 0 var(--line), 0 1px 0 var(--line); text-align: center; }
.pip-info__stats .stat { display: grid; grid-row: span 2; grid-template-rows: subgrid; }
.pip-info__stats .stat dd { font-size: 17px; font-weight: 600; }
.pip-info__h { margin: 0 0 var(--s-2); font-size: 14px; font-weight: 600; }
.pip-info__intro { position: relative; overflow: hidden; }
.pip-info__intro :deep(.readme) { font-size: 14px; line-height: 1.7; }
.pip-info__intro--clamped { max-height: var(--intro-max); }
.pip-info__intro--clamped::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 64px; background: linear-gradient(to bottom, transparent, var(--surface)); pointer-events: none; }
.pip-info__more { margin-top: var(--s-2); }
.pip-info__kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px var(--s-4); margin: 0; font-size: 13px; }
.pip-info__kv dt { color: var(--text-3); }
.pip-info__kv dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
.pip-info__cid { display: inline-flex; align-items: center; gap: 6px; min-height: var(--h-sm); padding: 0; border: 0; background: none; color: var(--text); font: inherit; cursor: pointer; }
.pip-info__cid code { font-size: 12px; }
.pip-info__cid svg { width: 14px; height: 14px; color: var(--text-3); }
.pip-info__cid:hover svg { color: var(--accent-text); }
.pip-info__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2) var(--s-3); padding-top: var(--s-3); box-shadow: 0 -1px 0 var(--line); font-size: 13px; }
.pip-info__report { color: var(--text-2); }
.pip-info__report:hover { color: var(--accent-text); }
.pip-info__open { gap: 4px; }
.pip-info__copied { display: block; font-size: 12px; color: var(--text-2); }
.pip-info__copied:empty { display: none; }
.pip-info__summary:lang(ko), .pip-info__name:lang(ko) { word-break: keep-all; }
</style>
