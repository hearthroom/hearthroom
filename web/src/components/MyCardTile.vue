<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { platformPath } from "@/lib/distribution";
import { compact } from "@/lib/format";
import { zoneLabel } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { can, currentProvider } from "@/lib/provider";
import { cardThumb } from "@/lib/card-thumb";
import type { MyCard } from "@/lib/api";

/** eager：首屏那幾張，封面不等捲到才載（最大內容繪製就是它們） */
const props = defineProps<{ card: MyCard & {sourceAvailable?:boolean}; busy: boolean; eager?: boolean }>();
defineEmits<{ toggle: [] }>();

const { lp } = useLocalePath();
const source=computed(()=>props.card.sourceProvider??props.card.provider??currentProvider());
const sourceId=computed(()=>props.card.sourceRoleId??props.card.roleId);
const hasDetails = computed(() =>
  ['pending', 'rejected', 'superseded'].includes(props.card.updateStatus ?? '') ||
  (props.card.status === 'rejected' && !!props.card.note) ||
  props.card.sourceAvailable === false
);

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
</script>

<template>
  <!-- 進場用 settle 不用 rise：卡片就是首屏最大的內容，要一出現就看得見（見 base.css） -->
  <article class="card settle">
    <div class="card__poster">
      <!-- 封面連到卡片頁：編輯有自己的鍵在下面（作者回報 2026-09-16：點自己的卡跳進編輯頁） -->
      <a :href="lp(`/cards/${card.num ?? card.detailId ?? card.workId ?? sourceId}`)" class="card__art">
        <img v-if="artSrc" :key="artSrc" :src="artSrc" :alt="card.name" :loading="eager ? 'eager' : 'lazy'" :fetchpriority="eager ? 'high' : undefined" decoding="async" @error="onArtError" />
        <div v-else class="card__void">
          <span :aria-label="card.name">{{ initial }}</span>
        </div>
      </a>

      <div class="card__badges">
        <span v-if="card.registered && (!card.status || card.status === 'approved')" class="card__badge">{{ $t("mine.badge.listed") }}</span>
        <span v-else-if="card.registered && card.status" class="card__badge card__badge--muted">{{ $t(`mine.badge.${card.status}`) }}</span>
        <span v-if="!card.registered" class="card__badge card__badge--muted">{{ $t(card.sourceAvailable===false ? "workspace.unknown" : "workspace.draft") }}</span>
        <span v-if="card.registered && card.nsfw" class="card__badge card__badge--muted">{{ $t("card.nsfw") }}</span>
      </div>
      <div class="card__content">
        <div class="card__intro">
          <h3 class="card__name">{{ card.name }}</h3>
          <p class="card__hook">{{ card.summary || $t("card.noSummary") }}</p>
          <p class="card__meta">{{ zoneLabel(card.zone) }} · {{ $t("card.talkCount", { n: compact(card.talkNum) }) }}</p>
        </div>
        <!-- 工作區的操作不能藏在 hover 底下：觸控裝置根本碰不到 -->
        <div class="card__actions">
          <!-- 自己的卡不用登記也能玩：登記是上榜，不是能不能對話的門檻 -->
          <a class="btn btn--sm" :href="platformPath(lp(`/play/${card.num ?? card.detailId ?? sourceId}?mode=source`),source)">{{ $t("mine.action.play") }}</a>
          <a v-if="can('editor',source)" class="btn btn--sm" :href="platformPath(lp(`/cards/${card.num ?? card.detailId ?? sourceId}/edit`),source)">{{ $t("mine.action.edit") }}</a>
          <!-- 送審、重新送審都在編輯頁；這裡只留已上架卡的「取消登記」（別處沒有這個入口） -->
          <button
            v-if="card.registered"
            class="btn btn--sm card__withdraw"
            :disabled="busy || card.sourceAvailable===false"
            @click="$emit('toggle')"
          >
            {{ busy ? "…" : $t("mine.action.unregister") }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="hasDetails" class="card__body">
      <p v-if="card.updateStatus==='pending'" class="card__note">{{ $t("workspace.updatePending") }}</p>
      <p v-if="card.updateStatus==='rejected'" class="card__note">{{ $t("workspace.updateRejected") }}</p>
      <p v-if="card.updateStatus==='superseded'" class="card__note">{{ $t("workspace.reviewSaveRetry") }}</p>
      <p v-if="(card.status === 'rejected' || card.updateStatus==='rejected') && card.note" class="card__note">{{ $t("mine.note.rejected", { note: card.note }) }}</p>
      <p v-if="card.sourceAvailable===false" class="subtle">{{ $t('workspace.sourceLoading') }}</p>
    </div>
  </article>
</template>

<style scoped>
.card {
  min-width: 0; background: var(--surface); border-radius: var(--r-md);
  box-shadow: 0 0 0 1px var(--line), var(--shadow-sm); overflow: hidden;
  transition: box-shadow var(--dur) var(--ease);
}
.card:hover { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-md); }
/* 封面與操作共同構成直式卡片；內容較長時自然長高，不裁掉按鈕。 */
.card__poster { position: relative; isolation: isolate; display: flex; flex-direction: column; justify-content: space-between; aspect-ratio: 2 / 3; color: var(--poster-text); background: #17171c; --poster-text: #fff; --poster-muted: rgba(255,255,255,.85); --poster-meta: rgba(255,255,255,.75); --poster-button: rgba(255,255,255,.12); --poster-button-hover: rgba(255,255,255,.22); --poster-border: rgba(255,255,255,.24); }
.card__art { position: absolute; inset: 0; display: block; z-index: -1; }
.card__art img { width: 100%; height: 100%; display: block; object-fit: cover; object-position: center top; }
/* 單一遮罩跨越整張封面，避免各內容區的漸層接出亮帶。 */
.card__art:has(img)::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgba(16,16,24,.1) 0%, rgba(16,16,24,.32) 20%, rgba(16,16,24,.57) 40%, rgba(16,16,24,.8) 60%, rgba(16,16,24,.93) 80%, rgba(16,16,24,.98) 100%); }
.card__art:focus-visible { outline-offset: -4px; }
.card__void { display: grid; place-items: center; width: 100%; height: 100%; padding-bottom: 55%; background: var(--surface-2); }
.card__void span { display: grid; place-items: center; width: 72px; height: 88px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); color: var(--text-3); font-size: 36px; font-weight: 500; box-shadow: var(--shadow-sm); }
.card__poster:has(.card__void) { --poster-text: var(--text); --poster-muted: var(--text-2); --poster-meta: var(--text-3); --poster-button: var(--surface); --poster-button-hover: var(--border); --poster-border: var(--border-strong); background: var(--surface-2); }
.card__poster:has(.card__void) .card__badge--muted { background: var(--surface); color: var(--text-2); box-shadow: 0 0 0 1px var(--line); }
.card__badges { display: flex; flex-wrap: wrap; gap: var(--s-1); padding: var(--s-3) var(--s-3) var(--s-6); pointer-events: none; }
.card__badge {
  min-height: 22px; max-width: 100%; padding: 2px var(--s-2); display: inline-flex; align-items: center;
  overflow-wrap: anywhere; border-radius: var(--r-pill);
  background: var(--accent-btn); color: var(--on-accent); font-size: 11.5px; font-weight: 600;
}
.card__badge--muted { background: rgba(16,16,24,.7); }
.card__content { position: relative; display: grid; gap: var(--s-3); padding: var(--s-3); margin-top: var(--s-7); }
.card__intro { display: grid; min-width: 0; gap: var(--s-1); pointer-events: none; }
.card__name { font-size: 18px; font-weight: 600; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.card__hook { font-size: 13px; line-height: 1.5; color: var(--poster-muted); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.card__meta { font-size: 12px; color: var(--poster-meta); font-variant-numeric: tabular-nums; }
.card__actions { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: var(--s-2); }
.card__actions > .btn { min-height: 44px; height: auto; white-space: normal; min-width: 0; padding-inline: var(--s-2); overflow-wrap: anywhere; }
.card__actions > .btn:not(.btn--primary) { color: var(--poster-text); background: var(--poster-button); border-color: var(--poster-border); }
.card__actions > .btn:not(.btn--primary):hover { background: var(--poster-button-hover); }
.card__actions > .btn:last-child:nth-child(odd) { grid-column: 1 / -1; }
.card__actions > .card__withdraw { background: transparent; }
.card__body { display: grid; min-width: 0; gap: var(--s-2); padding: var(--s-3); }
.card__note { font-size: 12px; color: var(--danger); line-height: 1.5; overflow-wrap: anywhere; }
</style>
