<script setup lang="ts">
/**
 * 名字旁的展示徽章列＋「全部徽章（N）」。作者公開頁與「我的」頭部共用。
 *
 * 一排、不折行、不擠名字：量每枚標籤的實際寬度（隱形的量測列），從最後一枚往回藏，
 * 直到「顯示的標籤＋「+N」」放得進一排，至少留一枚；寬度、字體、語系變了就重算。
 * 點標籤開詳情（桌機錨在標籤下方、手機從底部拉起）；「+N」開同一層，列出被藏起來的那幾枚。
 * 作者關掉公開、或沒有對外可見的徽章時，整列連同連結都不出現，不留空位。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { communityRequest } from "@/lib/community";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { wrapTab } from "@/lib/focus-trap";
import { fitWorn, honorName, parseHonorKey, periodLabel, type Honor } from "@/lib/honors";
import { badgeText, type BadgeCollection, type CollectedBadge } from "../../../shared/community-badges";
import BadgeLabel from "./BadgeLabel.vue";
import CommunityIcon from "./CommunityIcon.vue";
import RankBadge from "./RankBadge.vue";

/** collection：呼叫端已經讀好的徽章（「我的」頁）就直接用，不再讀一次 */
const props = defineProps<{ handle: string; own?: boolean; collection?: BadgeCollection | null }>();
const { t, locale } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

const data = ref<BadgeCollection | null>(null);
let generation = 0;
async function load() {
  const n = ++generation;
  data.value = null;
  if (props.collection !== undefined) { data.value = props.collection; return; }
  try {
    const token = props.own ? await session.accessToken() : undefined;
    if (props.own && !token) return;
    const result = await communityRequest<BadgeCollection>(props.own ? "/me/community/badges" : `/community/members/${encodeURIComponent(props.handle)}/badges`, token);
    if (n === generation) data.value = result;
  } catch { /* 徽章讀不到時頭部照常顯示，只是沒有這一列 */ }
}
watch(() => [props.handle, props.own, props.collection], load, { immediate: true });

const earned = computed(() => data.value?.items.filter(b => b.state === "earned") ?? []);
const worn = computed(() => (data.value?.featured ?? []).map(key => earned.value.find(b => b.key === key)).filter((b): b is CollectedBadge => !!b));
const allPath = computed(() => props.own ? lp("/me/badges") : lp(`/authors/${props.handle}/badges`));

/** lastPeriod：榜單榮譽最近一次那一組的起始日（後端契約），其他徽章沒有 */
type Worn = CollectedBadge & { lastPeriod?: string | null };
const honorOf = (b: CollectedBadge): Honor | null => parseHonorKey(b.key);
const nameOf = (b: CollectedBadge) => { const h = honorOf(b); return h ? honorName(t, h) : badgeText(b.titles, locale.value); };
const dateOf = (at: number) => new Intl.DateTimeFormat(locale.value, { dateStyle: "medium" }).format(at);
function whenOf(b: Worn): string {
  const h = honorOf(b);
  if (h && b.lastPeriod) {
    const period = periodLabel(h.window, b.lastPeriod, locale.value);
    return (b.count ?? 1) > 1 ? t("honor.recentMany", { n: b.count, period }) : t("honor.periodSingle", { period });
  }
  const at = b.lastAt ?? b.earnedAt;
  return at === null || at === undefined ? "" : t("badgeWall.earnedAt", { date: dateOf(at) });
}

// ---- 一排放幾枚 ----
const row = ref<HTMLElement | null>(null);
const measure = ref<HTMLElement | null>(null);
const shown = ref(Infinity);
const GAP = 8;
function fit() {
  const box = row.value, mirror = measure.value;
  if (!box || !mirror) return;
  const widths = [...mirror.querySelectorAll<HTMLElement>("[data-measure-item]")].map(el => el.offsetWidth + (Number(el.dataset.layers) || 0) * 4);
  const plus = mirror.querySelector<HTMLElement>("[data-measure-plus]")?.offsetWidth ?? 36;
  shown.value = fitWorn(widths, box.clientWidth, GAP, () => plus);
}
const hidden = computed(() => worn.value.slice(Math.min(shown.value, worn.value.length)));
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(() => fit()); }
  void document.fonts?.ready.then(() => fit());
});
watch(row, (el, before) => { if (before) observer?.unobserve(before); if (el) observer?.observe(el); });
watch([worn, locale], async () => { shown.value = Infinity; await nextTick(); fit(); }, { flush: "post" });

// ---- 詳情層 ----
const detail = ref<{ items: CollectedBadge[]; sheet: boolean; top: number; left: number } | null>(null);
const layer = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;
function openDetail(items: CollectedBadge[], e: Event) {
  opener = e.currentTarget as HTMLElement;
  const sheet = matchMedia("(max-width: 480px)").matches;
  const box = opener.getBoundingClientRect();
  const width = 300;
  detail.value = { items, sheet, top: box.bottom + 8, left: Math.max(12, Math.min(box.left, document.documentElement.clientWidth - width - 12)) };
  document.addEventListener("keydown", onKey);
  void nextTick(() => layer.value?.querySelector<HTMLElement>("a,button")?.focus({ preventScroll: true }));
}
function closeDetail() {
  if (!detail.value) return;
  detail.value = null;
  document.removeEventListener("keydown", onKey);
  if (opener?.isConnected) opener.focus({ preventScroll: true });
  opener = null;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") return void closeDetail();
  if (detail.value?.sheet) wrapTab(e, layer.value);
}
function onScroll() { if (detail.value && !detail.value.sheet) closeDetail(); }
onMounted(() => addEventListener("scroll", onScroll, { passive: true }));
onBeforeUnmount(() => { observer?.disconnect(); removeEventListener("scroll", onScroll); document.removeEventListener("keydown", onKey); });
</script>

<template>
  <div v-if="earned.length" class="worn">
    <ul v-if="worn.length" ref="row" class="worn__row" :aria-label="t('community.badgeLabel')">
      <li v-for="(badge, i) in worn" :key="badge.key" v-show="i < shown">
        <BadgeLabel as="button" :honor="honorOf(badge)" :icon="badge.icon" :text="nameOf(badge)" :count="badge.count" aria-haspopup="dialog" @click="openDetail([badge], $event)" />
      </li>
      <li v-if="hidden.length">
        <button type="button" class="worn__more" aria-haspopup="dialog" :aria-label="t('badges.moreAria', { n: hidden.length }, hidden.length)" @click="openDetail(hidden, $event)">+{{ hidden.length }}</button>
      </li>
    </ul>
    <RouterLink class="worn__all" :to="allPath">{{ t("badges.viewAll", { n: earned.length }) }}</RouterLink>
    <!-- 量測列：和展示列同樣的標籤，看不見、不佔位，只拿來量寬度 -->
    <div ref="measure" class="worn__measure" aria-hidden="true">
      <BadgeLabel v-for="badge in worn" :key="badge.key" data-measure-item :honor="honorOf(badge)" :icon="badge.icon" :text="nameOf(badge)" :count="badge.count" />
      <span class="worn__more" data-measure-plus>+9</span>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="detail?.sheet" class="worn-scrim" @click="closeDetail" />
    <div
      v-if="detail"
      ref="layer"
      class="worn-detail panel"
      :class="{ 'worn-detail--sheet': detail.sheet }"
      :style="detail.sheet ? undefined : { top: detail.top + 'px', left: detail.left + 'px' }"
      role="dialog"
      :aria-modal="detail.sheet || undefined"
      :aria-label="detail.items.length === 1 ? nameOf(detail.items[0]) : t('badges.viewAll', { n: earned.length })"
    >
      <div v-for="badge in detail.items" :key="badge.key" class="worn-detail__item">
        <span class="worn-detail__tile" :class="{ 'worn-detail__tile--honor': honorOf(badge) }">
          <RankBadge v-if="honorOf(badge)" :honor="honorOf(badge)!" decorative />
          <CommunityIcon v-else :name="badge.icon" />
        </span>
        <div class="worn-detail__text">
          <h3>{{ nameOf(badge) }}</h3>
          <p v-if="whenOf(badge)" class="worn-detail__when">{{ whenOf(badge) }}</p>
          <p class="worn-detail__condition">{{ badgeText(badge.descriptions, locale) }}</p>
        </div>
      </div>
      <RouterLink class="worn__all" :to="allPath" @click="closeDetail">{{ t("badges.viewAll", { n: earned.length }) }}</RouterLink>
    </div>
  </Teleport>
  <!-- 桌機的浮層點外面就關 -->
  <Teleport to="body"><div v-if="detail && !detail.sheet" class="worn-catcher" @click="closeDetail" /></Teleport>
</template>

<style scoped>
/* 列吃掉剩下的寬度（1fr 與內容無關，量出來的寬度才不會跟著藏幾枚來回跳）；窄螢幕連結自成一行 */
.worn { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: var(--s-3); min-width: 0; max-width: 100%; position: relative; }
.worn:not(:has(.worn__row)) { grid-template-columns: auto; }
@media (max-width: 640px) { .worn { grid-template-columns: minmax(0, 1fr); } }
/* 疊層往右上露出 8px，列的上方與右邊要留出這段，不然被裁掉 */
.worn__row { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; min-width: 0; margin: 0; padding: 8px 8px 2px 0; list-style: none; overflow: hidden; }
.worn__row > li { flex: none; display: flex; min-width: 0; }
.worn__more {
  display: inline-flex; align-items: center; height: 28px; padding: 0 10px; flex: none;
  border: 0; border-radius: var(--r-pill); background: var(--surface-2); color: var(--text-2);
  box-shadow: inset 0 0 0 1px var(--line-strong); font: inherit; font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer;
}
button.worn__more:hover { background: var(--surface); }
.worn__all { display: inline-flex; align-items: center; min-height: 28px; font-size: 13px; font-weight: 600; color: var(--accent-text); white-space: nowrap; }
.worn__all:hover { text-decoration: underline; }
.worn__measure { position: absolute; left: 0; top: 0; display: flex; gap: 8px; visibility: hidden; pointer-events: none; height: 0; overflow: hidden; white-space: nowrap; }
.worn-catcher { position: fixed; inset: 0; z-index: 39; }
.worn-scrim { position: fixed; inset: 0; z-index: 100; background: rgba(16, 16, 24, 0.45); }
.worn-detail { position: fixed; z-index: 40; width: 300px; max-height: min(420px, 70dvh); overflow-y: auto; padding: var(--s-4); border-radius: var(--r-md); box-shadow: 0 0 0 1px var(--line), var(--shadow-md); display: grid; gap: var(--s-3); }
.worn-detail--sheet {
  z-index: 101; left: 0; right: 0; bottom: 0; top: auto; width: auto; max-height: 80dvh;
  border-radius: 24px 24px 0 0; padding: var(--s-4) var(--s-4) calc(var(--s-4) + env(safe-area-inset-bottom));
}
.worn-detail__item { display: flex; gap: var(--s-3); align-items: flex-start; min-width: 0; }
.worn-detail__tile { display: flex; align-items: center; justify-content: center; flex: none; width: 56px; height: 56px; border-radius: var(--r-md); background: var(--accent-tint); color: var(--accent-text); }
.worn-detail__tile svg { width: 28px; height: 28px; }
.worn-detail__tile--honor { background: var(--surface-2); --rank-badge-h: 43px; }
.worn-detail__tile--honor svg { width: auto; height: auto; }
.worn-detail__text { min-width: 0; display: grid; gap: 2px; }
.worn-detail h3 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.worn-detail p { margin: 0; line-height: 1.5; overflow-wrap: anywhere; }
.worn-detail__when { font-size: 13px; color: var(--text-2); }
.worn-detail__condition { font-size: 13px; color: var(--text-2); white-space: pre-line; }
@media (prefers-reduced-motion: no-preference) { .worn-detail--sheet { animation: settle var(--dur-slow) var(--ease); } }
</style>
