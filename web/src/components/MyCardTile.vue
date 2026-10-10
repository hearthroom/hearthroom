<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { platformPath } from "@/lib/distribution";
import { compact } from "@/lib/format";
import { zoneLabel } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { can, currentProvider } from "@/lib/provider";
import { cardThumb } from "@/lib/card-thumb";
import type { MyCard } from "@/lib/api";
import RatingMark from "./RatingMark.vue";
import { ratingName } from "@/lib/rating";

/** eager：首屏那幾張，封面不等捲到才載（最大內容繪製就是它們） */
const props = defineProps<{ card: MyCard & {sourceAvailable?:boolean}; busy: boolean; eager?: boolean }>();
const emit = defineEmits<{ toggle: [] }>();

const { lp } = useLocalePath();
const source=computed(()=>props.card.sourceProvider??props.card.provider??currentProvider());
const sourceId=computed(()=>props.card.sourceRoleId??props.card.roleId);
const detailHref=computed(()=>lp(`/cards/${props.card.num ?? props.card.detailId ?? props.card.workId ?? sourceId.value}`));
const hasDetails = computed(() =>
  !!props.card.draftChanged ||
  ['pending', 'rejected', 'superseded'].includes(props.card.updateStatus ?? '') ||
  (props.card.status === 'rejected' && !!props.card.note) ||
  props.card.sourceAvailable === false
);

/*
 * 封面角上一個狀態標，四種主要狀態（owner 2026-10-05）：同一個深色底，靠字前面的燈號分——
 * 已發布＝綠、審核中（含需重審）＝琥珀、審核未通過（含授權收回）＝紅、未提交審核＝空心圈。
 * 不用整塊底色分：主色跟警示色都是紅，「已發布」和「未通過」會看成同一種。
 * 跟首頁卡片一樣把狀態放在圖上，名字那兩行才不用跟標籤搶寬度。
 */
const status = computed<{ key: string; tone: "on" | "wait" | "alert" | "muted" }>(() => {
  const c = props.card;
  if (!c.registered) return { key: c.sourceAvailable === false ? "workspace.unknown" : "workspace.draft", tone: "muted" };
  if (!c.status || c.status === "approved") return { key: "mine.badge.listed", tone: "on" };
  if (c.status === "rejected" || c.status === "unshared") return { key: `mine.badge.${c.status}`, tone: "alert" };
  return { key: `mine.badge.${c.status}`, tone: "wait" };
});

const initial = computed(() => [...props.card.name][0] ?? "?");
/*
 * 直式封面，沒有才用頭像。先用首頁同一個縮圖網址（同一個尺寸，Cloudflare 不會多轉一份，見 card-thumb）；
 * 縮圖拿不到就用原圖；原圖也掛了就當沒圖，退回首字佔位。
 */
const failedArt = ref<string[]>([]);
const artwork = computed(() => [props.card.backgroundUrl, props.card.avatarUrl]
  .find((url): url is string => !!url && !failedArt.value.includes(url)));
const thumbFailed = ref(false);
const artSrc = computed(() => artwork.value && !thumbFailed.value ? cardThumb(artwork.value) : artwork.value);
watch(() => [props.card.roleId, props.card.backgroundUrl, props.card.avatarUrl], () => { failedArt.value = []; thumbFailed.value = false; });
function onArtError() {
  if (!artwork.value) return;
  if (!thumbFailed.value && artSrc.value !== artwork.value) thumbFailed.value = true;
  else { failedArt.value.push(artwork.value); thumbFailed.value = false; }
}

/*
 * 「⋯」裡收撤回：一週只能登記幾張，撤回不該跟試玩、編輯並排、一碰就走（確認窗在頁面那層）。
 * 選單從名字旁往下開，落在同一張卡的簡介上，不會被卡片的圓角裁掉、也不蓋到下一排。
 */
const menuOpen = ref(false);
const more = ref<HTMLElement | null>(null);
function onDown(e: PointerEvent) { if (!more.value?.contains(e.target as Node)) closeMenu(); }
function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeMenu(); }
function listen(on: boolean) {
  const method = on ? "addEventListener" : "removeEventListener";
  document[method]("pointerdown", onDown as EventListener);
  document[method]("keydown", onKey as EventListener);
}
function toggleMenu() { menuOpen.value = !menuOpen.value; listen(menuOpen.value); }
function closeMenu() { if (!menuOpen.value) return; menuOpen.value = false; listen(false); }
function withdraw() { closeMenu(); emit("toggle"); }
onBeforeUnmount(() => listen(false));
</script>

<template>
  <!-- 進場用 settle 不用 rise：卡片就是首屏最大的內容，要一出現就看得見（見 base.css） -->
  <article class="card settle">
    <!-- 封面連到卡片頁：編輯有自己的鍵在下面（作者回報 2026-09-16：點自己的卡跳進編輯頁） -->
    <a :href="detailHref" class="card__art" tabindex="-1" aria-hidden="true">
      <img v-if="artSrc" :key="artSrc" :src="artSrc" alt="" :loading="eager ? 'eager' : 'lazy'" :fetchpriority="eager ? 'high' : undefined" decoding="async" @error="onArtError" />
      <div v-else class="card__void"><span>{{ initial }}</span></div>
      <!-- 已發布但改過沒送審：狀態標下面再一個琥珀燈（owner 2026-10-05：改了忘記提交，自己都不知道） -->
      <span class="card__badges">
        <span class="card__status" :class="`card__status--${status.tone}`">{{ $t(status.key) }}</span>
        <span v-if="card.draftChanged" class="card__status card__status--wait">{{ $t("mine.badge.draftChanged") }}</span>
      </span>
      <RatingMark v-if="card.registered && card.rating === 'R'" rating="R" variant="chip" class="card__flag" />
    </a>

    <div class="card__content">
      <div class="card__title">
        <h3 class="card__name"><a :href="detailHref" class="card__link">{{ card.name }}</a></h3>
        <!-- 封面那層對讀屏隱藏（跟名字是同一個連結），狀態標在這裡再念一次 -->
        <span class="sr-only">{{ $t(status.key) }}<template v-if="card.draftChanged"> · {{ $t("mine.badge.draftChanged") }}</template><template v-if="card.registered && card.rating === 'R'"> · {{ ratingName("R", String($i18n.locale)) }}</template></span>
        <!-- 送審、重新送審都在編輯頁；這裡只留已登記卡的「撤回」（別處沒有這個入口）。
             放在名字旁邊而不是操作列：每張卡的操作列都是同樣兩顆鍵，排起來才整齊 -->
        <div v-if="card.registered" ref="more" class="card__more">
          <button
            type="button" class="btn btn--ghost btn--icon btn--sm card__more-btn" :aria-label="$t('mine.action.more')"
            aria-haspopup="menu" :aria-expanded="menuOpen" :disabled="busy || card.sourceAvailable===false" @click="toggleMenu"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="15.5" cy="10" r="1.5" /></svg>
          </button>
          <div v-if="menuOpen" class="card__menu" role="menu">
            <button type="button" role="menuitem" class="card__menu-item" @click="withdraw">{{ $t("mine.action.unregister") }}</button>
          </div>
        </div>
      </div>
      <p class="card__hook">{{ card.summary || $t("card.noSummary") }}</p>
      <p class="card__meta">
        <span class="card__zone">{{ zoneLabel(card.zone) }}</span>
        <span class="card__talks" :title="$t('card.talkCount', { n: compact(card.talkNum) })">
          <span class="sr-only">{{ $t("card.talkCount", { n: compact(card.talkNum) }) }}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5z" /></svg>
          <span aria-hidden="true">{{ compact(card.talkNum) }}</span>
        </span>
      </p>

      <div v-if="hasDetails" class="card__body">
        <p v-if="card.draftChanged" class="card__note card__note--wait">{{ $t("workspace.draftChanged") }}</p>
        <p v-if="card.updateStatus==='pending'" class="card__note">{{ $t("workspace.updatePending") }}</p>
        <p v-if="card.updateStatus==='rejected'" class="card__note card__note--alert">{{ $t("workspace.updateRejected") }}</p>
        <p v-if="card.updateStatus==='superseded'" class="card__note card__note--alert">{{ $t("workspace.reviewSaveRetry") }}</p>
        <p v-if="(card.status === 'rejected' || card.updateStatus==='rejected') && card.note" class="card__note card__note--alert">{{ $t("mine.note.rejected", { note: card.note }) }}</p>
        <p v-if="card.sourceAvailable===false" class="card__note">{{ $t('workspace.sourceLoading') }}</p>
      </div>

      <!-- 工作區的操作不能藏在 hover 底下：觸控裝置根本碰不到 -->
      <div class="card__actions">
        <!-- 自己的卡不用登記也能玩：登記是上榜，不是能不能對話的門檻 -->
        <a class="btn card__act" :href="platformPath(lp(`/play/${card.num ?? card.detailId ?? sourceId}?mode=source`),source)">{{ $t("mine.action.play") }}</a>
        <!-- 有修改沒送審時「編輯」換成主色：送審就在編輯頁 -->
        <a v-if="can('editor',source)" class="btn card__act" :class="{ 'btn--primary': card.draftChanged }" :href="platformPath(lp(`/cards/${card.num ?? card.detailId ?? sourceId}/edit`),source)">{{ $t("mine.action.edit") }}</a>
      </div>
    </div>
  </article>
</template>

<style scoped>
/* 跟首頁卡片同一副骨架（CardTile）：3:4 封面、兩行名字、兩行簡介、一行資訊；多一列操作 */
.card {
  position: relative; display: flex; flex-direction: column; min-width: 0;
  background: var(--surface); border-radius: var(--r-md);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-sm); overflow: hidden;
  transition: box-shadow var(--dur) var(--ease);
}
.card:hover { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-md); }

.card__art { position: relative; display: block; aspect-ratio: 3 / 4; background: var(--surface-2); overflow: hidden; }
.card__art img { width: 100%; height: 100%; display: block; object-fit: cover; transition: transform var(--dur-slow) var(--ease); }
.card:hover .card__art img { transform: scale(1.04); }
/* 圖片內緣一道極淡的線：淺色立繪的邊緣才不會跟白卡糊在一起 */
.card__art::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 0 1px rgba(16, 16, 24, 0.05); pointer-events: none; }
.card__void { display: grid; place-items: center; width: 100%; height: 100%; }
.card__void span { display: grid; place-items: center; width: 56px; height: 68px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); color: var(--text-3); font-size: 28px; font-weight: 500; box-shadow: var(--shadow-sm); }

/* 左上一疊狀態標、右上限制級；兩邊都不吃點擊，點下去就是點封面 */
.card__badges, .card__flag { position: absolute; top: 8px; z-index: 1; pointer-events: none; }
.card__badges { left: 8px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: calc(100% - 16px); }
.card__badges:has(~ .card__flag) { max-width: calc(100% - 56px); }
.card__status {
  display: inline-flex; align-items: center; height: 20px; padding: 0 7px; max-width: 100%;
  border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; line-height: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.card__status { gap: 5px; background: rgba(16, 16, 24, 0.74); color: #fff; }
.card__status::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dot, transparent); box-shadow: var(--dot-ring, none); }
/* 標的底永遠是深色，燈號用深色主題那組成功／警示色（tokens.css 的 dark 值），淺色主題下也看得清 */
.card__status--on { --dot: #3ddc84; }
.card__status--wait { --dot: var(--gold-light); }
.card__status--alert { --dot: #ff6b66; }
.card__status--muted { --dot-ring: inset 0 0 0 1.5px rgba(255, 255, 255, 0.7); }
.card__flag { right: 8px; }

.card__content { flex: 1; display: flex; flex-direction: column; gap: 5px; min-width: 0; padding: 10px 10px 10px 12px; container-type: inline-size; }
/* 名字最多兩行、固定兩行高：短名字的卡不該讓整排的簡介與按鈕參差 */
.card__name {
  font-size: 14px; font-weight: 600; line-height: 1.35; letter-spacing: -0.01em; margin: 0;
  overflow-wrap: break-word; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  min-height: calc(14px * 1.35 * 2);
}
/* 名字的連結撐滿整張卡（封面也是它）；操作列有 z-index，疊在它上面 */
.card__link::after { content: ""; position: absolute; inset: 0; }
.card__link:hover { color: var(--accent-text); }
.card__link:focus-visible { outline: none; }
.card:has(.card__link:focus-visible) { box-shadow: 0 0 0 2px var(--accent); }
.card__hook {
  margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-2);
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  overflow-wrap: anywhere; min-height: calc(12.5px * 1.5 * 2);
}
.card__meta { margin: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); min-width: 0; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.card__zone { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__talks { display: inline-flex; align-items: center; gap: 3px; flex: none; }
.card__talks svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round; }

.card__body { display: grid; gap: 2px; min-width: 0; }
.card__note {
  margin: 0; font-size: 11.5px; line-height: 1.45; color: var(--text-2); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.card__note--alert { color: var(--danger); }
/* 有修改沒送審：琥珀燈開頭，跟封面上那盞同一個意思 */
.card__note--wait { color: var(--text); }
.card__note--wait::before { content: ""; display: inline-block; width: 6px; height: 6px; margin: 0 6px 1px 0; border-radius: 50%; background: var(--gold); vertical-align: middle; }

/* 操作列貼底：同一排的卡不管名字幾行，按鈕都在同一條線上 */
.card__actions { position: relative; z-index: 1; margin-top: auto; padding-top: 5px; display: flex; gap: 6px; }
.card__act { flex: 1 1 0; min-width: 0; padding-inline: var(--s-2); font-size: 13px; }
/* 「⋯」疊在整張卡的連結上面（z-index），右緣往外推一點，視覺上跟卡片內距對齊 */
.card__title { display: flex; align-items: flex-start; gap: 2px; min-width: 0; }
.card__title .card__name { flex: 1; min-width: 0; }
.card__more { position: relative; z-index: 1; flex: none; margin: -5px -6px 0 0; }
.card__more-btn { color: var(--text-3); }
.card__more-btn svg { width: 16px; height: 16px; fill: currentColor; }
.card__menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 2;
  min-width: 120px; padding: 4px; display: grid;
  background: var(--surface); border-radius: var(--r-sm);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
}
.card__menu-item {
  height: var(--h-md); padding: 0 var(--s-3); border: 0; border-radius: 6px; background: transparent;
  text-align: left; font: inherit; font-size: 13px; font-weight: 500; color: var(--danger); cursor: pointer; white-space: nowrap;
}
.card__menu-item:hover, .card__menu-item:focus-visible { background: color-mix(in srgb, var(--danger) 10%, var(--surface)); }
/* 手指點的裝置：按鈕撐到 44px */
@media (pointer: coarse) {
  .card__act { height: var(--h-lg); }
  /* 「⋯」看起來小、點起來 44px：用負邊距把多出來的點擊範圍吃回去，不撐高名字那一列 */
  .card__more-btn { width: var(--h-lg); height: var(--h-lg); margin: -7px -7px -7px 0; }
  .card__menu-item { height: var(--h-lg); }
}
</style>
